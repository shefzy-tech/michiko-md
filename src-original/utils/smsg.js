const { downloadMediaMessage, getContentType } = require('@whiskeysockets/baileys');
const pino = require('pino');

function decodeJid(jid) {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
        const decoded = jid.split(':')[0] + '@s.whatsapp.net';
        return decoded;
    }
    return jid;
}

const smsg = async (conn, m) => {
    if (!m) return m;

    // --- Key Information ---
    if (m.key) {
        m.id = m.key.id;
        m.isBaileys = m.id && m.id.startsWith('BAE5') && m.id.length === 16;
        m.from = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.from && m.from.endsWith('@g.us');
        m.sender = decodeJid(
            m.fromMe && conn.user.id ||
            m.participant ||
            m.key.participant ||
            m.from ||
            ''
        );
    }

    // --- Message Content & Type ---
    if (m.message) {
        m.mtype = getContentType(m.message);
        m.msg = m.mtype === 'viewOnceMessageV2'
            ? m.message.viewOnceMessageV2.message[getContentType(m.message.viewOnceMessageV2.message)]
            : m.message[m.mtype];

        m.body = (
            m.mtype === "conversation" ? m.message.conversation :
            m.mtype === "imageMessage" ? m.msg?.caption :
            m.mtype === "videoMessage" ? m.msg?.caption :
            m.mtype === "extendedTextMessage" ? m.msg?.text :
            m.mtype === "buttonsResponseMessage" ? m.msg?.selectedButtonId :
            m.mtype === "listResponseMessage" ? m.msg?.singleSelectReply?.selectedRowId :
            m.mtype === "templateButtonReplyMessage" ? m.msg?.selectedId :
            (m.mtype === "interactiveResponseMessage" && m.msg?.nativeFlowResponseMessage)
                ? (() => {
                    try {
                        return JSON.parse(m.msg.nativeFlowResponseMessage.paramsJson).id;
                    } catch {
                        return "";
                    }
                })()
                : ""
        );

        // Push name
        m.pushName = m.message.extendedTextMessage?.contextInfo?.pushName || 
                     m.pushName || 
                     m.msg?.contextInfo?.pushName || 
                     'User';

        // --- QUOTED MESSAGE HANDLER ---
        let rawQuoted = m.msg?.contextInfo?.quotedMessage || null;
        
        if (rawQuoted) {
            let quotedType = getContentType(rawQuoted);
            m.quoted = rawQuoted[quotedType];

            if (typeof m.quoted === 'string') {
                m.quoted = { text: m.quoted };
            }

            m.quoted.mtype = quotedType;
            m.quoted.id = m.msg.contextInfo.stanzaId;
            m.quoted.chat = m.msg.contextInfo.remoteJid || m.from;
            m.quoted.sender = decodeJid(m.msg.contextInfo.participant);
            m.quoted.fromMe = m.quoted.sender === decodeJid(conn.user.id);
            m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || '';

            // Create fakeObj using RAW quoted message
            m.quoted.fakeObj = {
                key: {
                    remoteJid: m.quoted.chat,
                    fromMe: m.quoted.fromMe,
                    id: m.quoted.id
                },
                message: rawQuoted,
                ...(m.isGroup ? { participant: m.quoted.sender } : {})
            };

            // Delete quoted message
            m.quoted.delete = () => conn.sendMessage(m.quoted.chat, { delete: m.quoted.fakeObj.key });

            // Copy & Forward quoted message
            m.quoted.copyNForward = (jid, forceForward = false, options = {}) => conn.copyNForward(jid, m.quoted.fakeObj, forceForward, options);

            // Media download for quoted message - USING RAW QUOTED
            m.quoted.download = async () => await downloadMediaMessage(
                {
                    key: {
                        remoteJid: m.from,
                        id: m.quoted.id,
                        fromMe: m.quoted.fromMe,
                        participant: m.quoted.sender
                    },
                    message: rawQuoted
                },
                'buffer',
                {},
                { logger: pino({ level: 'silent' }) }
            );
        }
    }

    // Direct Media Download for main message
    m.download = async () => await downloadMediaMessage(
        m,
        'buffer',
        {},
        { logger: pino({ level: 'silent' }) }
    );

    // Media type detection helper
    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
    if (m.mtype && mediaTypes.includes(m.mtype)) {
        m.mediaType = m.mtype;
    }

    // Reply function
    m.reply = (text, chatId = m.from, options = {}) => {
        return conn.sendMessage(chatId, { text: text }, { quoted: m, ...options });
    };

    // Copy forward for main message
    m.copyNForward = (jid = m.from, forceForward = false, options = {}) => conn.copyNForward(jid, m, forceForward, options);

    return m;
};

module.exports = { smsg };