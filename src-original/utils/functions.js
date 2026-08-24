
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const util  = require('util');
const execPromise = util.promisify(exec);
const sharp = require('sharp');
const FormData = require('form-data');
const ffmpegPath = require('ffmpeg-static');

//===================
// Runtime
//===================
function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    return (d > 0 ? d + (d === 1 ? ' day, ' : ' days, ') : '') +
           (h > 0 ? h + (h === 1 ? ' hour, ' : ' hours, ') : '') +
           (m > 0 ? m + (m === 1 ? ' minute, ' : ' minutes, ') : '') +
           (s > 0 ? s + (s === 1 ? ' second' : ' seconds') : '');
}

function formatRuntime(seconds) {
    const days    = Math.floor(seconds / 86400);
    const hours   = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs    = Math.floor(seconds % 60);
    const parts   = [];
    if (days)    parts.push(days    + 'd');
    if (hours)   parts.push(hours   + 'h');
    if (minutes) parts.push(minutes + 'm');
    if (secs)    parts.push(secs    + 's');
    return parts.join(' ') || '0s';
}

function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, sizes = ['Bytes','KB','MB','GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function decodeJid(jid) {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) return jid.split(':')[0] + '@s.whatsapp.net';
    return jid;
}

//===================
// addExifToWebp
//===================
// Injects sticker pack name / author into a WebP buffer as EXIF metadata.
// WhatsApp reads this to display pack name and author in the sticker tray.
function addExifToWebp(webpBuffer, packname = 'Michiko MD', author = 'Bot') {
    try {
        const jsonStr   = JSON.stringify({ 'sticker-pack-name': packname, 'sticker-pack-publisher': author, emojis: ['🤖'] });
        const jsonBuf   = Buffer.from(jsonStr, 'utf-8');
        const ifdOffset = 8;
        const jsonOffset = ifdOffset + 2 + 1 * 12 + 4;
        const tiff = Buffer.alloc(jsonOffset + jsonBuf.length);
        tiff.writeUInt16LE(0x4949, 0);
        tiff.writeUInt16LE(42, 2);
        tiff.writeUInt32LE(ifdOffset, 4);
        tiff.writeUInt16LE(1, ifdOffset);
        const e = ifdOffset + 2;
        tiff.writeUInt16LE(0x8741, e);
        tiff.writeUInt16LE(7, e + 2);
        tiff.writeUInt32LE(jsonBuf.length, e + 4);
        tiff.writeUInt32LE(jsonOffset, e + 8);
        tiff.writeUInt32LE(0, e + 12);
        jsonBuf.copy(tiff, jsonOffset);
        const paddedLen = tiff.length + (tiff.length % 2);
        const exifChunk = Buffer.alloc(8 + paddedLen);
        exifChunk.write('EXIF', 0, 'ascii');
        exifChunk.writeUInt32LE(tiff.length, 4);
        tiff.copy(exifChunk, 8);
        const out = Buffer.concat([webpBuffer, exifChunk]);
        out.writeUInt32LE(out.length - 8, 4);
        return out;
    } catch {
        return webpBuffer;
    }
}

//===================
// imageToSticker
//===================
async function imageToSticker(buffer, packname = 'Michiko MD', author = 'Bot') {
    const webp = await sharp(buffer)
        .resize(512, 512, { fit: 'contain', background: { r:0, g:0, b:0, alpha:0 } })
        .webp({ quality: 80 })
        .toBuffer();
    return addExifToWebp(webp, packname, author);
}

//===================
// videoToSticker
//===================
//===================
// videoToSticker
//===================
async function videoToSticker(buffer, packname = 'Michiko MD', author = 'Bot') {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const ts = Date.now();
    const inp = path.join(tempDir, 'vstkr_in_' + ts + '.mp4');
    const out = path.join(tempDir, 'vstkr_out_' + ts + '.webp');
    fs.writeFileSync(inp, buffer);
    try {
        // Removed -t 6 (no more truncation). Added max duration 15s (WhatsApp limit).
        await execPromise(
            '"' + ffmpegPath + '" -y -i "' + inp + '" ' +
            '-vf "fps=12,scale=512:512:force_original_aspect_ratio=decrease,' +
            'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black,setpts=PTS-STARTPTS" ' +
            '-vcodec libwebp_anim -lossless 0 -q:v 60 -loop 0 -vsync 0 -t 15 "' + out + '"'
        );
        return addExifToWebp(fs.readFileSync(out), packname, author);
    } finally {
        try { fs.unlinkSync(inp); } catch {}
        try { fs.unlinkSync(out); } catch {}
    }
}

//===================
// videoToAudio
//===================
async function videoToAudio(buffer) {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const ts = Date.now();
    const inp = path.join(tempDir, 'vtoa_in_' + ts + '.mp4');
    const out = path.join(tempDir, 'vtoa_out_' + ts + '.mp3');
    fs.writeFileSync(inp, buffer);
    try {
        await execPromise('"' + ffmpegPath + '" -y -i "' + inp + '" -vn -acodec libmp3lame "' + out + '"');
        return fs.readFileSync(out);
    } finally {
        try { fs.unlinkSync(inp); } catch {}
        try { fs.unlinkSync(out); } catch {}
    }
}

//===================
// gifToMp4
//===================

async function gifToMp4(buffer) {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const ts  = Date.now();
    const inp = path.join(tempDir, 'gif_in_'  + ts + '.gif');
    const out = path.join(tempDir, 'gif_out_' + ts + '.mp4');
    fs.writeFileSync(inp, buffer);
    try {
        await execPromise(
            '"' + ffmpegPath + '" -y -i "' + inp + '" ' +
            '-movflags +faststart -pix_fmt yuv420p ' +
            '-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ' +
            '-c:v libx264 -crf 23 "' + out + '"'
        );
        return fs.readFileSync(out);
    } finally {
        try { fs.unlinkSync(inp); } catch {}
        try { fs.unlinkSync(out); } catch {}
    }
}

//===================
// sendAnimatedGif
//===================

async function sendAnimatedGif(sock, jid, gifBuffer, caption, quotedMsg) {
    let mp4;
    try { mp4 = await gifToMp4(gifBuffer); } catch { mp4 = gifBuffer; }
    const opts = quotedMsg ? { quoted: quotedMsg } : {};
    return sock.sendMessage(jid, { video: mp4, mimetype: 'video/mp4', gifPlayback: true, caption: caption || undefined }, opts);
}

//===================
// sendGifFromUrl
//===================
// Downloads a GIF/MP4 URL and sends as auto-playing WhatsApp gif
async function sendGifFromUrl(sock, jid, url, caption, quotedMsg) {
    const res  = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    const buf  = Buffer.from(res.data);
    const mime = (res.headers['content-type'] || '').toLowerCase();
    const opts = quotedMsg ? { quoted: quotedMsg } : {};

    if (mime.includes('mp4') || url.toLowerCase().endsWith('.mp4')) {
        // Already MP4 — send directly
        return sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4', gifPlayback: true, caption: caption || undefined }, opts);
    }
    // GIF/WebP — convert first
    return sendAnimatedGif(sock, jid, buf, caption, quotedMsg);
}

//===================
// uploadToCatbox
//===================
async function uploadToCatbox(buffer, mimetype = 'image/jpeg') {
    try {
        const ext  = mimetype.split('/')[1]?.split(';')[0] || 'jpg';
        const form = new FormData();
        form.append('reqtype',      'fileupload');
        form.append('fileToUpload', buffer, { filename: 'upload_' + Date.now() + '.' + ext, contentType: mimetype });
        const r = await axios.post('https://catbox.moe/user.php', form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 });
        const url = typeof r.data === 'string' ? r.data.trim() : null;
        return url && url.startsWith('http') ? url : null;
    } catch (e) { console.error('[uploadToCatbox]', e.message); return null; }
}

async function uploadToTmpfiles(buffer, filename = 'upload.jpg') {
    try {
        const form = new FormData();
        form.append('file', buffer, { filename });
        const r    = await axios.post('https://tmpfiles.org/api/v1/upload', form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 });
        const link = r.data?.data?.url;
        return link ? link.replace('tmpfiles.org/', 'tmpfiles.org/dl/') : null;
    } catch { return null; }
}

async function uploadToUguu(buffer, filename = 'upload') {
    try {
        const form = new FormData();
        form.append('files[]', buffer, { filename });
        const r = await axios.post('https://uguu.se/upload', form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 30000 });
        return r.data?.files?.[0]?.url || null;
    } catch { return null; }
}


//===================
// easyGifReply
//===================
// Usage inside any case: await easyGifReply(sock, from, gifUrlOrBuffer, caption, m);
async function easyGifReply(sock, to, gif, caption, quotedMsg) {
    if (typeof gif === 'string' && gif.startsWith('http')) {
        return sendGifFromUrl(sock, to, gif, caption, quotedMsg);
    }
    return sendAnimatedGif(sock, to, gif, caption, quotedMsg);
}

module.exports = {
    runtime,
    formatRuntime,
    formatSize,
    formatBytes,
    decodeJid,
    addExifToWebp,
    imageToSticker,
    videoToSticker,
    videoToAudio,
    gifToMp4,
    sendAnimatedGif,
    sendGifFromUrl,
    easyGifReply,          // <-- add this
    uploadToCatbox,
    uploadToTmpfiles,
    uploadToUguu,
};