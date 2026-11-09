// ============================================================================
// utils/statusAck.js — fixes the "Connection closed | Code: 500 | Stream Errored (ack)" drop that repeats about every
// 50 minutes (WhiskeySockets/Baileys issue #2858).
//
// Cause: for some accounts WhatsApp delivers contacts' status updates as a top-level <status> stanza. Baileys
// has no handler for it, so it is never acknowledged; ~50 minutes later WhatsApp closes the stream with
// stream:error <ack class="status" .../>, Baileys reports it as code 500 and the bot has to reconnect. After the
// reconnect WhatsApp resends the same pending status, so it happens again and again.
//
// Fix: acknowledge those stanzas ourselves, exactly like Baileys acknowledges every other stanza
// (same attributes as Baileys' own buildAckStanza). If the library already listens for <status> (a newer
// Baileys with the fix), this does nothing, so it can never ack twice.
// ============================================================================
function buildAck(node) {
  const a = node.attrs || {};
  const ack = { tag: 'ack', attrs: { id: a.id, to: a.from, class: node.tag || 'status' } };
  if (a.participant) ack.attrs.participant = a.participant;
  if (a.recipient) ack.attrs.recipient = a.recipient;
  if (a.type) ack.attrs.type = a.type;
  return ack;
}

function attach(sock, log) {
  try {
    const ws = sock && sock.ws;
    if (!ws || typeof ws.on !== 'function' || typeof sock.sendNode !== 'function') return false;
    if (typeof ws.listenerCount === 'function' && ws.listenerCount('CB:status') > 0) return false;   // library already handles it
    const acked = new Set();
    let announced = false;
    ws.on('CB:status', (node) => {
      try {
        const id = node && node.attrs && node.attrs.id;
        if (!id || acked.has(id)) return;
        acked.add(id);
        if (acked.size > 500) acked.delete(acked.values().next().value);
        Promise.resolve(sock.sendNode(buildAck(node))).then(() => {
          if (!announced && typeof log === 'function') { announced = true; log('Acknowledged a WhatsApp status stanza (prevents the 50-minute "Stream Errored (ack)" disconnect)', 'info'); }
        }).catch(() => { acked.delete(id); });
      } catch { /* never let an ack problem touch the connection */ }
    });
    return true;
  } catch { return false; }
}

module.exports = { attach, buildAck };
