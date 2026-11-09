// ============================================================================
// whatsapp.js — Michiko MD (single user) connection layer
//
// One WhatsApp account, one socket. Rebuilt on the lifecycle that runs the hosted
// multi-user bot, minus everything multi-user (no MongoDB, no session registry).
//
// Why the old single-user bot kept disconnecting, and what replaces it:
//   * Reconnects used to die silently: connect() could throw, the heartbeat that
//     would have retried it was already cleared, and the error was swallowed.
//     -> ONE reconnect path (_scheduleReconnect) that always re-arms itself.
//   * Two sockets could run on the same login (a late 515 retry + the watchdog),
//     which makes WhatsApp kick both (440). -> every socket belongs to a
//     generation (_gen); events from an older socket are ignored.
//   * A connect that never opened or closed hung forever. -> 90s connect timeout.
//   * 405 (WhatsApp refused the client version) and 440 (replaced by another
//     device using the same login) were retried as if nothing had happened.
//     -> live WhatsApp Web version lookup, 405 hold, 440 back-off.
//   * SESSION_ID was re-written over the saved login on EVERY restart, replacing
//     newer keys with the stale ones inside the ID. -> it is only restored when
//     there is no saved login for that account (see restoreFromSessionId).
//   * A close before pairing finished looped forever on half-made credentials.
//     -> the unfinished pairing is discarded.
// ============================================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');
const pino = require('pino');
const chalk = require('chalk');
const axios = require('axios');
const baileys = require('@whiskeysockets/baileys');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    jidDecode,
    DisconnectReason
} = baileys;

const config = require('./config');
const handleMessage = require('./main');
const { smsg } = require('./utils/smsg');
const { getStore, destroyStore } = require('./store');

const DB_DIR          = path.join(__dirname, 'database');
const SESSION_DIR     = path.join(DB_DIR, 'session');
const FRESH_PAIR_FLAG = path.join(DB_DIR, '.fresh_pair');
const SESSION_STATE   = path.join(DB_DIR, '.session_state.json');
fs.mkdirSync(SESSION_DIR, { recursive: true });

//===================
// Tunables (all overridable through environment variables)
//===================
const envMs = (k, d) => { const v = parseInt(process.env[k] || '', 10); return v > 0 ? v : d; };
const CONNECT_TIMEOUT_MS = envMs('CONNECT_TIMEOUT_MS', 90 * 1000);   // a connect that neither opens nor closes is declared dead
const PAIRING_WINDOW_MS  = envMs('PAIRING_WINDOW_MS', 5 * 60 * 1000); // an unfinished pairing is discarded after this
const MAINTENANCE_MS     = envMs('MAINTENANCE_MS', 60 * 1000);        // liveness timer
const PROBE_EVERY_TICKS  = 5;                                         // active presence probe every 5 ticks (5 min)
const PROBE_TIMEOUT_MS   = envMs('PROBE_TIMEOUT_MS', 10000);
const BACKOFF_BASE_MS    = envMs('BACKOFF_BASE_MS', 5000);
const BACKOFF_MAX_MS     = envMs('BACKOFF_MAX_MS', 120 * 1000);
const FORCE_RECONNECT_MS = envMs('FORCE_RECONNECT_MS', 3000);
const RESTART_DELAY_MS   = envMs('RESTART_DELAY_MS', 1000);           // after the 515 that follows a successful pairing
const WELCOME_DELAY_MS   = envMs('WELCOME_DELAY_MS', 3000);
const QR_WAIT_MS         = envMs('QR_WAIT_MS', 15000);                // how long to wait for the handshake before asking for a pair code

const SILENT_LOGGER = pino({ level: 'silent' });
const stats = { reconnects: 0, versionRejections: 0, connectTimeouts: 0, replaced: 0, forced: 0 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

//===================
// WhatsApp Web version  (the "405 / client too old" problem)
//
// WhatsApp raises the minimum client version it accepts from time to time. A socket announcing an
// older one is refused with close code 405. The version is therefore read LIVE (web.whatsapp.com
// sw.js) and only falls back to stale sources, loudly, when the live lookup fails.
//===================
const WA_VERSION_TTL_MS           = envMs('WA_VERSION_TTL_MS', 60 * 1000);
const WA_VERSION_FRESH_MS         = envMs('WA_VERSION_FRESH_MS', 5 * 1000);
const WA_VERSION_RETRY_MS         = envMs('WA_VERSION_RETRY_MS', 15 * 1000);
const WA_VERSION_FETCH_TIMEOUT_MS = envMs('WA_VERSION_FETCH_TIMEOUT_MS', 10 * 1000);
const WA_405_HOLD_BASE_MS         = envMs('WA_405_HOLD_BASE_MS', 5 * 60 * 1000);
const WA_405_HOLD_MAX_MS          = envMs('WA_405_HOLD_MAX_MS', 30 * 60 * 1000);
const VERSION_REJECTED            = 405;

const wv = { cur: null, lastGood: null, inflight: null, refresh: null, lastFailAt: 0, lastWarnAt: 0, rejectedKey: null, holdLevel: 0, holdUntil: 0 };
const vKey = (v) => (Array.isArray(v) ? v.join('.') : 'bundled-default');
const validVersion = (v) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isInteger(n) && n >= 0) && v[2] > 0;

function withTimeout(promise, ms, label) {
    let t;
    return Promise.race([
        promise,
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out`)), ms); })
    ]).finally(() => clearTimeout(t));
}

async function fetchWaWebVersionFromSw() {
    const res = await axios.get('https://web.whatsapp.com/sw.js', {
        timeout: WA_VERSION_FETCH_TIMEOUT_MS, responseType: 'text', transformResponse: [(d) => d]
    });
    const m = String(res.data || '').match(/\\?"client_revision\\?":\s*(\d+)/);
    const v = m ? [2, 3000, parseInt(m[1], 10)] : null;
    return validVersion(v) ? v : null;
}

async function fetchLiveWaVersion() {
    const fn = baileys.fetchLatestWaWebVersion;           // feature-detected: not every Baileys build exports it
    if (typeof fn === 'function') {
        try {
            const r = await withTimeout(Promise.resolve(fn({ timeout: WA_VERSION_FETCH_TIMEOUT_MS })), WA_VERSION_FETCH_TIMEOUT_MS + 2000, 'fetchLatestWaWebVersion');
            if (r && !r.error && r.isLatest !== false && validVersion(r.version)) return { version: r.version, source: 'baileys.fetchLatestWaWebVersion' };
        } catch { /* fall through to our own lookup */ }
    }
    try {
        const v = await withTimeout(fetchWaWebVersionFromSw(), WA_VERSION_FETCH_TIMEOUT_MS + 2000, 'sw.js lookup');
        if (v) return { version: v, source: 'sw.js' };
    } catch { /* nothing live available */ }
    return null;
}

function warnVersion(msg) {
    if (Date.now() - wv.lastWarnAt < 60 * 1000) return;
    wv.lastWarnAt = Date.now();
    console.log(chalk.yellow(`[WA VERSION] ${msg}`));
}

function adoptLive(r) {
    const prev = wv.cur || wv.lastGood;
    const cur = { version: r.version, key: vKey(r.version), source: r.source, at: Date.now() };
    wv.cur = wv.lastGood = cur;
    wv.lastFailAt = 0;
    if (!prev || prev.key !== cur.key) console.log(chalk.green(`[WA VERSION] WhatsApp Web version ${cur.key} (via ${cur.source})${prev ? ` — was ${prev.key}` : ''}`));
    return cur;
}

async function fallbackWaVersion() {
    if (wv.lastGood) {
        warnVersion(`live lookup failed — using last known live version ${wv.lastGood.key}.`);
        return { ...wv.lastGood, source: 'last-known-live', stale: true };
    }
    try {
        const r = await withTimeout(Promise.resolve(baileys.fetchLatestBaileysVersion && baileys.fetchLatestBaileysVersion()), WA_VERSION_FETCH_TIMEOUT_MS, 'fetchLatestBaileysVersion');
        if (r && !r.error && r.isLatest !== false && validVersion(r.version)) {
            warnVersion(`live lookup failed — using Baileys-reported version ${vKey(r.version)} (NOT live; may be outdated)`);
            return { version: r.version, key: vKey(r.version), source: 'baileys-github', stale: true, at: Date.now() };
        }
    } catch { /* use the library default */ }
    warnVersion('live lookup failed and no other version source is available — using the library default. EXPECT 405 if it is outdated.');
    return { version: undefined, key: 'bundled-default', source: 'bundled-default', stale: true, at: Date.now() };
}

async function getWaVersion({ fresh = false } = {}) {
    const maxAge = fresh ? WA_VERSION_FRESH_MS : WA_VERSION_TTL_MS;
    if (wv.cur && Date.now() - wv.cur.at <= maxAge) return wv.cur;
    if (!wv.inflight && Date.now() - wv.lastFailAt >= WA_VERSION_RETRY_MS) {
        wv.inflight = (async () => {
            const r = await fetchLiveWaVersion();
            if (r) adoptLive(r); else wv.lastFailAt = Date.now();
        })().finally(() => { wv.inflight = null; });
    }
    if (wv.inflight) await wv.inflight;
    if (wv.cur && Date.now() - wv.cur.at <= maxAge) return wv.cur;
    return fallbackWaVersion();
}

function noteVersionAccepted() {
    if (!wv.holdUntil && !wv.holdLevel) return;
    console.log(chalk.green('[WA VERSION] A connection succeeded — 405 hold released.'));
    wv.holdUntil = 0; wv.holdLevel = 0; wv.rejectedKey = null;
}
function versionHoldRemaining(key) {
    return (Date.now() < wv.holdUntil && key === wv.rejectedKey) ? wv.holdUntil - Date.now() : 0;
}

// Called when a socket is closed with 405. The version is refused, not the login: refresh it once;
// a newer one -> retry on the normal back-off, the same one -> escalating hold (5 .. 30 min).
async function noteVersionRejected(usedKey) {
    stats.versionRejections++;
    const now = Date.now();
    if (now < wv.holdUntil) return wv.holdUntil - now;
    if (wv.cur && usedKey && wv.cur.key !== usedKey) return 0;
    if (!wv.refresh) {
        wv.refresh = (async () => {
            wv.cur = null;                                  // never serve the rejected version from cache again
            const r = await fetchLiveWaVersion();
            const adopted = r ? adoptLive(r) : null;
            if (adopted && adopted.key !== usedKey) {
                wv.holdLevel = 0; wv.holdUntil = 0; wv.rejectedKey = null;
                console.log(chalk.green(`[WA VERSION] WhatsApp rejected ${usedKey} (405); newer version ${adopted.key} found — reconnecting with it.`));
            } else {
                wv.holdLevel = Math.min(wv.holdLevel + 1, 10);
                const holdMs = Math.min(WA_405_HOLD_BASE_MS * Math.pow(2, wv.holdLevel - 1), WA_405_HOLD_MAX_MS);
                wv.holdUntil = Date.now() + holdMs; wv.rejectedKey = usedKey;
                console.log(chalk.red(`[WA VERSION] WhatsApp rejected ${usedKey} (405) and ${adopted ? 'no newer version exists' : 'the live lookup failed'}. `
                    + `Waiting ${Math.round(holdMs / 1000)}s before the next attempt. A persistent 405 means the installed Baileys build itself is outdated: run "npm update @whiskeysockets/baileys".`));
            }
        })().finally(() => { wv.refresh = null; });
    }
    await wv.refresh;
    return Math.max(0, wv.holdUntil - Date.now());
}

//===================
// Session helpers
//===================
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const phoneOfJid = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

function readState() { try { return JSON.parse(fs.readFileSync(SESSION_STATE, 'utf8')) || {}; } catch { return {}; } }
function writeState(patch) {
    try { fs.writeFileSync(SESSION_STATE, JSON.stringify({ ...readState(), ...patch })); } catch { /* best effort */ }
}

function readDiskCreds() {
    try { return JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'creds.json'), 'utf-8')); } catch { return null; }
}
function hasExistingSession() {
    const c = readDiskCreds();
    return !!(c && (c.registered || c.me));
}
function wipeSessionDir() {
    try {
        for (const f of fs.readdirSync(SESSION_DIR)) { try { fs.rmSync(path.join(SESSION_DIR, f), { recursive: true, force: true }); } catch {} }
    } catch {}
    try { if (fs.existsSync(FRESH_PAIR_FLAG)) fs.unlinkSync(FRESH_PAIR_FLAG); } catch {}
}

function getSessionId() {
    if (process.env.SESSION_ID?.trim()) { console.log(chalk.blue('[SESSION] Using SESSION_ID from environment')); return process.env.SESSION_ID.trim(); }
    if (config.SESSION_ID?.trim())      { console.log(chalk.blue('[SESSION] Using SESSION_ID from config.js'));   return config.SESSION_ID.trim(); }
    return null;
}

// Decode a Session ID into { files: {name: text}, account }. Returns null when it is not a session ID.
function decodeSessionId(sessionId) {
    let raw;
    try { raw = Buffer.from(sessionId, 'base64'); } catch { return null; }
    // new format: base64(gzip(JSON({ "creds.json": "...", "<key>.json": "..." })))
    try {
        const bundle = JSON.parse(zlib.gunzipSync(raw).toString('utf-8'));
        if (bundle && typeof bundle === 'object' && bundle['creds.json']) {
            const files = {};
            for (const [name, content] of Object.entries(bundle)) {
                if (typeof content === 'string' && name.endsWith('.json') && !name.includes('/') && !name.includes('\\') && !name.includes('..')) files[name] = content;
            }
            let account = '';
            try { account = phoneOfJid(JSON.parse(files['creds.json'])?.me?.id); } catch {}
            return { files, account, format: 'new' };
        }
    } catch {}
    // old format: base64(JSON(creds))
    try {
        const text = raw.toString('utf-8');
        const creds = JSON.parse(text);
        const files = { 'creds.json': text };
        if (creds.keys && typeof creds.keys === 'object') {
            for (const [keyName, keyData] of Object.entries(creds.keys)) {
                if (/^[\w.-]+$/.test(keyName)) files[`${keyName}.json`] = JSON.stringify(keyData, null, 2);
            }
        }
        return { files, account: phoneOfJid(creds?.me?.id), format: 'old' };
    } catch {}
    return null;
}

// Restore the saved login from a SESSION_ID. The ID is a SNAPSHOT taken when it was generated; while the
// bot runs, WhatsApp keeps rotating keys and the bot saves the new ones to disk. Writing the snapshot over
// them on every restart replaces fresh keys with stale ones, which is a classic cause of "bot disconnects /
// stops answering after a restart". So it is only written when there is no saved login for that account.
// Returns true when a usable login exists on disk afterwards.
function restoreFromSessionId(sessionId) {
    if (!sessionId) return false;
    const h = sha(sessionId);
    const st = readState();
    if (st.deadHash === h) {
        console.log(chalk.red('[SESSION] ❌ This SESSION_ID was logged out from WhatsApp (Linked Devices) and can no longer be used.'));
        console.log(chalk.yellow('[SESSION]    Generate a NEW session ID, or remove SESSION_ID to link with a pair code.'));
        return false;
    }
    const decoded = decodeSessionId(sessionId);
    if (!decoded) { console.log(chalk.red('[SESSION] ❌ SESSION_ID is not valid (not a base64 session bundle).')); return false; }

    if (hasExistingSession()) {
        const diskAccount = phoneOfJid(readDiskCreds()?.me?.id);
        if (!decoded.account || !diskAccount || diskAccount === decoded.account) {
            console.log(chalk.green('[SESSION] ✅ Saved login found on disk — keeping it (SESSION_ID is only used the first time).'));
            writeState({ loadedHash: h });
            return true;
        }
        console.log(chalk.yellow('[SESSION] SESSION_ID belongs to a different WhatsApp number than the saved login — replacing the saved login.'));
        wipeSessionDir();
    }

    let count = 0;
    for (const [name, content] of Object.entries(decoded.files)) {
        try { fs.writeFileSync(path.join(SESSION_DIR, name), content, 'utf-8'); count++; } catch (e) { console.log(chalk.red(`[SESSION] Could not write ${name}: ${e.message}`)); }
    }
    if (!count) return false;
    if (decoded.format === 'old') {
        console.log(chalk.yellow('[SESSION] ✅ Session restored — old format (creds only)'));
        console.log(chalk.yellow('[SESSION] ⚠️  Old format may not have the full signal keys. Generate a new session ID if the bot does not respond.'));
    } else {
        console.log(chalk.green(`[SESSION] ✅ Full session restored (${count} files)`));
    }
    writeState({ loadedHash: h, deadHash: null });
    return true;
}

function askPhoneNumber() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log(chalk.yellow('─────────────────────────────────────────'));
        console.log(chalk.cyan('  No session found! Starting pair code setup'));
        console.log(chalk.yellow('─────────────────────────────────────────'));
        rl.question(
            chalk.cyan('\n📱 Enter your WhatsApp number\n') +
            chalk.gray('   (with country code, no + or spaces)\n') +
            chalk.white('   Example: 2348012345678\n\n> '),
            (answer) => { rl.close(); resolve(answer.trim().replace(/[^0-9]/g, '')); }
        );
        rl.on('close', () => resolve(''));
    });
}

//===================
// WhatsAppBot
//
//   _destroyed : once set, this instance can never connect again.
//   _gen       : bumped on every connect() and destroy(). Every listener and timer captures the
//                generation it belongs to and ignores events when stale.
//   Reconnects : ONE entry point, _scheduleReconnect(). Close events, the liveness timer, connect
//                timeouts and failed connects all go through it, and it refuses to schedule when a
//                reconnect is already pending or a connect is in progress.
//===================
class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.store = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.hasAutoJoined = false;
        this.hasSentOnlineMessage = false;
        this.reconnectAttempts = 0;
        this.groupSettings = new Map();

        this._destroyed = false;
        this._gen = 0;
        this._reconnectTimer = null;
        this._reconnectQueued = false;
        this._connectTimeoutTimer = null;
        this._pairingTimer = null;
        this._maintTimer = null;
        this._maintTick = 0;
        this._unpaired = false;
        this._pendingWelcome = false;
        this._replacedStreak = 0;
        this._versionKey = null;
        this._versionRejects = 0;
        this._lastCloseCode = null;
        this._pairNumber = null;

        this._badMacCount = 0;
        this._badMacTimer = null;
        this._sessionResetCooldown = false;

        this.log = (msg, type = 'info') => {
            const colors = { success: chalk.green, error: chalk.red, warning: chalk.yellow, info: chalk.blue };
            console.log(chalk.magenta(`[${config.botName || 'MICHIKO-MD'}]`), (colors[type] || chalk.white)(msg));
        };
    }

    get state() {
        if (this._destroyed) return 'stopped';
        if (this.isConnected) return 'open';
        if (this.isConnecting) return 'connecting';
        if (this._reconnectTimer || this._reconnectQueued) return 'backoff';
        return 'idle';
    }

    _handleSessionError() {
        this._badMacCount++;
        if (this._badMacTimer) clearTimeout(this._badMacTimer);
        if (this._badMacCount >= 2 && !this._sessionResetCooldown) {
            this._sessionResetCooldown = true;
            this.log('Signal session reset — pausing 5s', 'warning');
            setTimeout(() => {
                this._sessionResetCooldown = false;
                this._badMacCount = 0;
                this.log('Session reset cooldown lifted', 'info');
            }, 5000);
        }
        this._badMacTimer = setTimeout(() => { this._badMacCount = 0; }, 10000);
    }

    decodeJid(jid) {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const decoded = jidDecode(jid) || {};
            return decoded.user && decoded.server ? `${decoded.user}@${decoded.server}` : jid;
        }
        return jid;
    }

    async sendOnlineMessage() {
        try {
            if (!this.sock?.user) return;
            const botNumber   = this.decodeJid(this.sock.user.id);
            const phoneNumber = botNumber.split('@')[0];
            const userJid     = `${phoneNumber}@s.whatsapp.net`;
            await this.sock.sendMessage(userJid, {
                text:
                    `╭─❏ *${config.botName} ONLINE* ❏─⬣\n│\n` +
                    `│ ✅ Connected & Online\n` +
                    `│ 📱 Bot: ${botNumber}\n` +
                    `│ 💾 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n` +
                    `│ 🕐 ${new Date().toLocaleString()}\n│\n` +
                    `╰─❏\n› Type *${config.prefix || '.'}menu* to start\n\n${config.productBrand || ''}`.trim()
            });
            this.log('Online message sent!', 'success');
            try { fs.writeFileSync(FRESH_PAIR_FLAG, Date.now().toString()); } catch {}
            this.checkAndNotifyUpdate(userJid).catch(() => {});
        } catch (e) {
            this.log(`Failed to send online message: ${e.message}`, 'error');
        }
    }

    async checkAndNotifyUpdate(userJid) {
        try {
            const { checkForUpdate } = require('./updater');
            const result = await checkForUpdate();
            if (result.hasUpdate) {
                await this.sock.sendMessage(userJid, {
                    text:
                        `╭─❏ *UPDATE AVAILABLE* ❏─⬣\n│\n` +
                        `│ 🆕 New version: v${result.remote}\n` +
                        `│ 📦 Current version: v${result.local}\n│\n` +
                        `│ Type *${config.prefix || '.'}update* to install it now.\n` +
                        `╰─❏`
                });
                this.log(`Update available: v${result.local} → v${result.remote}`, 'info');
            }
        } catch (e) {
            this.log(`Update check failed: ${e.message}`, 'warning');
        }
    }

    async autoJoinGroup() {
        if (!config.autoJoinGroup) return;
        const groups = Array.isArray(config.groupInviteLink)
            ? config.groupInviteLink
            : (config.groupInviteLink || '').split(',').map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < groups.length; i++) {
            const match = groups[i].match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
            if (!match) continue;
            try {
                const info = await this.sock.groupGetInviteInfo(match[1]);
                this.log(`Attempting to join: ${info.subject}`, 'info');
                const jid = await this.sock.groupAcceptInvite(match[1]);
                this.log(`Auto-joined group: ${jid}`, 'success');
                if (i < groups.length - 1) await sleep(2000);
            } catch (e) {
                this.log(`Group join failed ${groups[i]}: ${e.message}`, 'warning');
            }
        }
    }

    async autoJoinChannel() {
        if (!config.autoJoinChannel) return;
        const channels = Array.isArray(config.channelJid)
            ? config.channelJid
            : (config.channelJid || '').split(',').map(j => j.trim()).filter(Boolean);
        for (let i = 0; i < channels.length; i++) {
            if (!channels[i]?.includes('@newsletter')) continue;
            try {
                await this.sock.newsletterFollow(channels[i]);
                this.log(`Auto-joined channel: ${channels[i]}`, 'success');
                if (i < channels.length - 1) await sleep(2000);
            } catch (e) { this.log(`Channel join failed: ${e.message}`, 'warning'); }
        }
    }

    //===================
    // Timers
    //===================
    _clearReconnectTimer()  { if (this._reconnectTimer)      { clearTimeout(this._reconnectTimer);      this._reconnectTimer = null; } }
    _clearConnectTimeout()  { if (this._connectTimeoutTimer) { clearTimeout(this._connectTimeoutTimer); this._connectTimeoutTimer = null; } }
    _clearPairingTimer()    { if (this._pairingTimer)        { clearTimeout(this._pairingTimer);        this._pairingTimer = null; } }
    _stopMaintenance()      { if (this._maintTimer)          { clearInterval(this._maintTimer);         this._maintTimer = null; } }

    _backoffDelay() {
        const exp = Math.min(BACKOFF_BASE_MS * Math.pow(2, Math.min(this.reconnectAttempts, 6)), BACKOFF_MAX_MS);
        return Math.round(exp * (0.75 + Math.random() * 0.5));
    }

    // THE one reconnect entry point. Safe to call from anywhere, any number of times.
    _scheduleReconnect(reason, forcedDelayMs) {
        if (this._destroyed) return;
        if (this._reconnectTimer || this._reconnectQueued) return;   // already pending: collapses races
        if (this.isConnecting) return;
        const delay = forcedDelayMs != null ? forcedDelayMs : this._backoffDelay();
        this.reconnectAttempts++;
        this.log(`Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts}, ${reason})`, 'info');
        const gen = this._gen;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (this._destroyed || gen !== this._gen) return;
            if (reason !== 'restartRequired') stats.reconnects++;
            this.connect().catch((e) => {
                // This is the line the old bot lacked: a failed connect always schedules the next attempt.
                this.log(`Reconnect failed: ${e.message}`, 'error');
                this._scheduleReconnect('connect-error');
            });
        }, delay);
    }

    _armConnectTimeout(gen) {
        this._clearConnectTimeout();
        this._connectTimeoutTimer = setTimeout(() => {
            this._connectTimeoutTimer = null;
            if (this._destroyed || gen !== this._gen || !this.isConnecting) return;
            stats.connectTimeouts++;
            this.log(`Connect attempt produced no open/close within ${CONNECT_TIMEOUT_MS / 1000}s — discarding socket`, 'warning');
            this._gen++;
            this.isConnecting = false;
            this.cleanupSocketOnly();
            this._scheduleReconnect('connect-timeout');
        }, CONNECT_TIMEOUT_MS);
    }

    // One liveness timer (replaces the old 45s heartbeat AND 10-min watchdog, which each reconnected on their own).
    _startMaintenance() {
        this._stopMaintenance();
        const gen = this._gen;
        this._maintTick = 0;
        const interval = MAINTENANCE_MS + Math.floor(Math.random() * Math.min(15000, MAINTENANCE_MS / 4));
        this._maintTimer = setInterval(async () => {
            if (this._destroyed || gen !== this._gen) return this._stopMaintenance();
            this._maintTick++;
            if (!this.isConnected) {
                if (!this.isConnecting) this._scheduleReconnect('maintenance-dead');
                return;
            }
            const ws = this.sock?.ws;
            if (ws && (ws.isClosed === true || ws.isClosing === true)) {
                return this._forceReconnect(gen, 'socket-closed-without-event');
            }
            if (this._maintTick % PROBE_EVERY_TICKS === 0) {
                let probeTimer;
                try {
                    await Promise.race([
                        this.sock.sendPresenceUpdate('available'),
                        new Promise((_, rej) => { probeTimer = setTimeout(() => rej(new Error('timeout')), PROBE_TIMEOUT_MS); })
                    ]);
                } catch (e) {
                    if (this._destroyed || gen !== this._gen) return;
                    this._forceReconnect(gen, `probe-failed:${e.message}`);
                } finally {
                    clearTimeout(probeTimer);
                }
            }
        }, interval);
        if (this._maintTimer.unref) this._maintTimer.unref();
    }

    _forceReconnect(gen, reason) {
        if (this._destroyed || gen !== this._gen) return;
        stats.forced++;
        this.log(`Liveness check failed (${reason}) — forcing reconnect`, 'warning');
        this._gen++;
        this.isConnected = false;
        this._stopMaintenance();
        this.cleanupSocketOnly();
        this._scheduleReconnect(reason, FORCE_RECONNECT_MS + Math.floor(Math.random() * FORCE_RECONNECT_MS * 0.6));
    }

    //===================
    // connect(pairNumber): pairNumber is only given on the very first start, when there is no login yet.
    //===================
    async connect(pairNumber = null) {
        if (this._destroyed) { this.log('connect() ignored — instance was destroyed', 'warning'); return null; }
        if (this.isConnecting) { this.log('Connection already in progress', 'warning'); return null; }
        if (this.isConnected && this.sock && !pairNumber) { this.log('Already connected', 'warning'); return this.sock; }

        this._clearReconnectTimer();
        this.cleanupSocketOnly();
        this.isConnected = false;
        this.isConnecting = true;
        const gen = ++this._gen;
        const stale = () => gen !== this._gen || this._destroyed;
        if (pairNumber) this._pairNumber = pairNumber;

        try {
            const vInfo = await getWaVersion({ fresh: !!pairNumber });
            if (stale()) return null;
            const heldMs = pairNumber ? 0 : versionHoldRemaining(vInfo.key);
            if (heldMs > 0) {
                this.isConnecting = false;
                this._scheduleReconnect('version-hold', heldMs + Math.floor(Math.random() * Math.min(60000, heldMs / 2)));
                return null;
            }
            this._versionKey = vInfo.key;

            // creds are read from disk on every connect, so a reconnect always uses the newest saved keys
            const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
            if (stale()) return null;

            const sockOpts = {
                auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, SILENT_LOGGER) },
                logger: SILENT_LOGGER,
                printQRInTerminal: false,
                markOnlineOnConnect: true,
                syncFullHistory: false,
                browser: ['Ubuntu', 'Edge', '20.0.04'],
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                connectTimeoutMs: 60000,
                generateHighQualityLinkPreview: true,
                retryRequestDelayMs: 2000,
                maxMsgRetryCount: 5,
            };
            if (vInfo.version) sockOpts.version = vInfo.version;   // never pass version:undefined
            const sock = makeWASocket(sockOpts);
            this.sock = sock;

            sock.decodeJid = this.decodeJid.bind(this);
            sock.groupSettings = this.groupSettings;
            handleMessage.registerGroupEvents(sock);
            sock.ev.on('creds.update', () => { saveCreds().catch((e) => this.log(`Could not save credentials: ${e.message}`, 'error')); });
            if (!this.store) this.store = getStore('main');
            this.store.bind(sock.ev);
            if (typeof handleMessage.registerAntiDelete === 'function') handleMessage.registerAntiDelete(sock, this.store);
            try { require('./utils/statusAck').attach(sock, (m, l) => this.log(m, l)); } catch { /* optional safety net */ }   // stops the ~50 min "Stream Errored (ack)" drop

            const alreadyRegistered = !!(state.creds?.registered);
            const isPaired = () => !!(state.creds?.registered || state.creds?.me?.id);
            const wantPairing = !!pairNumber && !alreadyRegistered;
            if (!wantPairing) this._armConnectTimeout(gen);

            // resolves on the first 'qr' (= handshake finished, WhatsApp is ready for a pairing request)
            let qrSeen;
            const qrReady = new Promise((resolve) => { qrSeen = resolve; });

            //===================
            // Connection lifecycle
            //===================
            sock.ev.on('connection.update', async (update) => {
                if (stale()) return;
                const { connection, lastDisconnect } = update;
                if (update.qr && qrSeen) qrSeen(true);

                if (connection === 'open') {
                    if (this.isConnected) return;
                    this.isConnected = true;
                    this.isConnecting = false;
                    this._clearConnectTimeout();
                    this._clearPairingTimer();
                    this._unpaired = false;
                    this.reconnectAttempts = 0;
                    this._replacedStreak = 0;
                    this._versionRejects = 0;
                    this._lastCloseCode = null;
                    this._sessionResetCooldown = false;
                    this._badMacCount = 0;
                    noteVersionAccepted();
                    this.log('WhatsApp connected! ✅', 'success');
                    this._startMaintenance();

                    if (!this.hasSentOnlineMessage && !fs.existsSync(FRESH_PAIR_FLAG)) {
                        this.hasSentOnlineMessage = true;
                        setTimeout(() => { if (!stale()) this.sendOnlineMessage().catch(() => {}); }, WELCOME_DELAY_MS);
                    }

                    setTimeout(async () => {
                        if (stale() || this.hasAutoJoined) return;
                        this.hasAutoJoined = true;
                        await this.autoJoinGroup().catch(() => {});
                        await this.autoJoinChannel().catch(() => {});
                    }, 5000);

                    await this.sock?.sendPresenceUpdate('available').catch(() => {});

                } else if (connection === 'close') {
                    this.isConnected = false;
                    this.isConnecting = false;
                    this._clearConnectTimeout();
                    this._stopMaintenance();

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = lastDisconnect?.error?.message || 'Unknown';
                    this.log(`Connection closed | Code: ${statusCode} | ${reason}`, 'warning');

                    // 515: normal right after pairing succeeds. Reconnect with the same (now saved) login.
                    if (statusCode === DisconnectReason.restartRequired) {
                        this.log('Restart required (515) — reconnecting', 'info');
                        this._scheduleReconnect('restartRequired', RESTART_DELAY_MS);
                        return;
                    }

                    // 401: the phone removed this device (or the account logged it out). Credentials are dead.
                    if (statusCode === DisconnectReason.loggedOut) {
                        this._handleLoggedOut();
                        return;
                    }

                    // 405: WhatsApp refused the client VERSION, not the login.
                    if (statusCode === VERSION_REJECTED) {
                        this._lastCloseCode = VERSION_REJECTED;
                        this._reconnectQueued = true;       // collapse other reconnect triggers while the refresh runs
                        let holdMs = 0;
                        try { holdMs = await noteVersionRejected(this._versionKey); } finally { this._reconnectQueued = false; }
                        if (stale()) return;
                        if (!isPaired()) { this._abandonUnpaired('version-rejected-405'); return; }
                        this._versionRejects++;
                        const delay = Math.max(this._backoffDelay(), holdMs > 0 ? holdMs + Math.floor(Math.random() * Math.min(60000, holdMs / 2)) : 0);
                        this.log(`WhatsApp rejected client version ${this._versionKey} (405) — ${holdMs > 0 ? 'holding' : 'refreshed, retrying'} (x${this._versionRejects})`, 'warning');
                        this._scheduleReconnect('close:405', delay);
                        return;
                    }

                    // closed before pairing finished: the pair code is dead. Never loop on half-made credentials.
                    if (!isPaired()) { this._abandonUnpaired(`closed-before-pairing:${statusCode}`); return; }

                    // 440: another client is using these exact credentials. Fighting it makes both drop, forever.
                    if (statusCode === DisconnectReason.connectionReplaced) {
                        this._replacedStreak++;
                        stats.replaced++;
                        const delay = Math.min(60000 * this._replacedStreak, 600000);
                        this.log(`Replaced by another connection using the same login (x${this._replacedStreak}). Is the bot running somewhere else too (another host, a second deploy, or a local copy)? Only ONE copy may run per session. Waiting ${delay / 1000}s.`, 'error');
                        this._scheduleReconnect('connectionReplaced', delay);
                        return;
                    }

                    this._scheduleReconnect(`close:${statusCode}`);
                }
            });

            //===================
            // Messages
            //===================
            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (stale() || !this.isConnected) return;
                if (type !== 'notify') return;

                for (const m of messages) {
                    if (stale()) break;
                    try {
                        if (!m || !m.message) continue;

                        if (m.key?.remoteJid === 'status@broadcast') {
                            if (m.key.fromMe) continue;
                            const sender = m.key.participant || m.key.remoteJid;
                            await sock.readMessages([m.key]);
                            await sock.sendMessage('status@broadcast', { react: { text: '❤️', key: m.key } }, { statusJidList: [sender, sock.user.id] }).catch(() => {});
                            this.log(`Auto viewed & liked status from ${sender}`, 'info');
                            continue;
                        }

                        if (m.key.fromMe && m.key.id?.startsWith('BAE')) continue;

                        if (this._sessionResetCooldown) {
                            this.log(`Message queued during session reset (${m.key.id})`, 'warning');
                            await sleep(6000);
                            if (this._sessionResetCooldown) { this.log(`Message dropped after cooldown wait (${m.key.id})`, 'warning'); continue; }
                        }

                        const enhanced = await smsg(sock, m);
                        await handleMessage(sock, enhanced, null, this.store);

                    } catch (e) {
                        const errMsg = e.message || '';
                        if (/Bad MAC|bad mac|decryptWithSessions|SessionEntry|prekey bundle/.test(errMsg)) { this._handleSessionError(); continue; }
                        this.log(`Message error: ${errMsg}`, 'error');
                    }
                }
            });

            //===================
            // Pairing code (first start only)
            //===================
            if (wantPairing) {
                this._unpaired = true;
                this._pendingWelcome = true;
                this._clearPairingTimer();
                this._pairingTimer = setTimeout(() => {
                    this._pairingTimer = null;
                    if (this._destroyed || !this._unpaired) return;
                    this._abandonUnpaired('pairing-window-expired');
                }, PAIRING_WINDOW_MS);

                this.log(`Requesting pairing code for ${pairNumber}...`, 'info');
                await Promise.race([qrReady, sleep(QR_WAIT_MS)]);       // handshake first, then ask (a request sent too early is dropped)
                await sleep(500);
                if (stale()) return null;
                try {
                    const code = await sock.requestPairingCode(pairNumber);
                    if (stale()) return null;
                    console.log('\n' + chalk.bgGreen.black('  ✅ PAIRING CODE READY  ') + '\n');
                    console.log(chalk.white('┌─────────────────────────┐'));
                    console.log(chalk.white('│  Code: ') + chalk.bold.yellow(code) + chalk.white('         │'));
                    console.log(chalk.white('└─────────────────────────┘'));
                    console.log(chalk.gray('\nWhatsApp → Linked Devices → Link a Device → Link with phone number instead\n'));
                    return code;
                } catch (e) {
                    if (!stale()) this.log(`Pairing code error: ${e.message}`, 'error');
                    throw e;
                }
            }
            return null;

        } catch (e) {
            if (gen === this._gen) { this.isConnecting = false; this._clearConnectTimeout(); }
            this.log(`Connect error: ${e.message}`, 'error');
            throw e;
        }
    }

    _handleLoggedOut() {
        this.log('Logged out from WhatsApp — the saved login is no longer valid', 'error');
        const id = getSessionId_quiet();
        if (id) writeState({ deadHash: sha(id) });      // never restore this exact SESSION_ID again
        this.destroy('logged-out');
        wipeSessionDir();
        destroyStore('main');
        console.log(chalk.red('\n❌ Bot was logged out. Generate a new session ID (or link again with a pair code), then restart.\n'));
        process.exit(1);
    }

    // A pairing that never completed: remove its leftover credentials, otherwise every restart would loop on them.
    _abandonUnpaired(reason) {
        if (this._destroyed) return;
        this.log(`Pairing did not complete (${reason}) — discarding the unfinished login`, 'warning');
        this.destroy(`abandoned:${reason}`);
        destroyStore('main');
        if (!hasExistingSession() || !readDiskCreds()?.registered) wipeSessionDir();
        console.log(chalk.yellow('\n⚠️  Pairing was not completed. Restart the bot to get a new pair code.\n'));
        process.exit(1);
    }

    cleanupSocketOnly() {
        if (this.sock) {
            try { this.sock.ev.removeAllListeners(); } catch {}
            try { this.sock.ws?.close(); } catch {}
            try { this.sock.end(); } catch {}
            this.sock = null;
        }
    }

    // End of life. Idempotent. Nothing can reconnect this instance afterwards.
    destroy(reason = 'cleanup') {
        if (this._destroyed) return;
        this._destroyed = true;
        this._gen++;
        this._clearReconnectTimer();
        this._clearConnectTimeout();
        this._clearPairingTimer();
        this._stopMaintenance();
        if (this._badMacTimer) clearTimeout(this._badMacTimer);
        this.cleanupSocketOnly();
        this.isConnected = false;
        this.isConnecting = false;
        this._reconnectQueued = false;
        this.log(`Instance stopped (${reason})`, 'info');
    }

    cleanup() { this.destroy('cleanup'); }
    getGroupSettings() { return this.groupSettings; }
    getClient() { return this.sock; }
    isOnline() { return this.isConnected; }
}

function getSessionId_quiet() {
    return process.env.SESSION_ID?.trim() || config.SESSION_ID?.trim() || null;
}

const bot = new WhatsAppBot();

//===================
// Start-up flow: SESSION_ID -> saved login -> pair code
//===================
async function startBot() {
    const sessionId = getSessionId();
    if (sessionId && restoreFromSessionId(sessionId)) {
        console.log(chalk.green('[SESSION] ✅ Connecting...'));
        await bot.connect();
        return;
    }
    if (sessionId) console.log(chalk.yellow('[SESSION] ⚠️ SESSION_ID could not be used — checking disk...'));

    if (hasExistingSession()) {
        console.log(chalk.green('[SESSION] ✅ Found session on disk — connecting...'));
        await bot.connect();
        return;
    }

    // Nothing usable: a half-made login from an earlier unfinished pairing must not be reused.
    wipeSessionDir();
    console.log(chalk.yellow('\n[SESSION] No session found.\n'));
    let phoneNumber = String(process.env.PAIR_NUMBER || process.env.PHONE_NUMBER || '').replace(/[^0-9]/g, '');
    if (phoneNumber) console.log(chalk.cyan(`[SESSION] Using number from PAIR_NUMBER / PHONE_NUMBER: ${phoneNumber.slice(0, 4)}******`));
    else phoneNumber = await askPhoneNumber();
    if (!phoneNumber || phoneNumber.length < 7) {
        console.log(chalk.red('❌ Invalid phone number. Restart and try again (or set PAIR_NUMBER, or use a SESSION_ID).'));
        process.exit(1);
    }
    await bot.connect(phoneNumber);
}

//===================
// Small helpers other modules use
//===================
function getStats() {
    const cur = wv.cur || wv.lastGood;
    return {
        total: 1, connected: bot.isConnected ? 1 : 0, connecting: bot.isConnecting ? 1 : 0,
        backoff: bot.state === 'backoff' ? 1 : 0, reconnectAttempts: bot.reconnectAttempts,
        waVersion: cur ? cur.key : null, versionHoldMs: Math.max(0, wv.holdUntil - Date.now()),
        ...stats
    };
}

// Kept for main.js (.reactch uses getAllSessions); a single-user bot has exactly one session.
function getAllSessions() {
    const sock = bot.getClient();
    const num = sock?.user?.id ? phoneOfJid(sock.user.id) : '';
    return sock ? [{ phoneNumber: num, isOnline: bot.isOnline(), sock }] : [];
}
function getWhatsAppClient() { return bot.getClient(); }
function getGroupSettings() { return bot.getGroupSettings(); }
function isOnline() { return bot.isOnline(); }

module.exports = {
    startBot, bot, getStats, getAllSessions, getWhatsAppClient, getGroupSettings, isOnline,
    // exported for tests
    _internal: { restoreFromSessionId, decodeSessionId, hasExistingSession, wipeSessionDir, readState, writeState, SESSION_DIR, SESSION_STATE }
};
