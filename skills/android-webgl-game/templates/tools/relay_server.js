#!/usr/bin/env node
// Tiny WebSocket relay for online 1v1 duels (no dependencies, Node 14+).
// One player creates a room and gets a 4-letter code, the other joins with it; after that the
// server just forwards messages between the two. The game logic stays on the players' phones.
//
// Usage: node tools/relay_server.js [port]        (default 8080)
// Clients: VC.Net.onlineHost(url) / VC.Net.onlineJoin(url, code) from templates/assets/js/net.js
'use strict';
const http = require('http');
const crypto = require('crypto');

const PORT = +(process.argv[2] || process.env.PORT || 8080);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL = 30 * 60 * 1000;
const MAX_FRAME = 64 * 1024;
const rooms = new Map(); // code -> { host, guest, t }

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

// ------------------------------------------------------------------ minimal RFC 6455
function send(sock, obj) {
  if (sock.destroyed) return;
  const data = Buffer.from(JSON.stringify(obj));
  let head;
  if (data.length < 126) head = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  sock.write(Buffer.concat([head, data]));
}

function attach(sock, onText, onClose) {
  let buf = Buffer.alloc(0);
  let closed = false;
  const close = () => { if (!closed) { closed = true; onClose(); } sock.destroy(); };
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f;
      const masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_FRAME || !masked) { close(); return; } // clients must mask; cap frame size
      if (buf.length < off + 4 + len) return;
      const mask = buf.slice(off, off + 4);
      const payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) payload[i] = buf[off + 4 + i] ^ mask[i & 3];
      buf = buf.slice(off + 4 + len);
      if (op === 0x8) { close(); return; }
      if (op === 0x9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 0x1) onText(payload.toString('utf8'));
    }
  });
  sock.on('close', close);
  sock.on('error', close);
}

// ------------------------------------------------------------------ rooms
function peerOf(sock) {
  const r = rooms.get(sock.room);
  if (!r) return null;
  return r.host === sock ? r.guest : r.host;
}

function onMessage(sock, text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (m.t === 'create') {
    const code = newCode();
    rooms.set(code, { host: sock, guest: null, t: Date.now() });
    sock.room = code;
    send(sock, { t: 'room', code });
  } else if (m.t === 'join') {
    const code = String(m.code || '').toUpperCase().trim();
    const r = rooms.get(code);
    if (!r || r.guest) { send(sock, { t: 'err', m: r ? 'room is full' : 'room not found' }); return; }
    r.guest = sock;
    sock.room = code;
    send(r.host, { t: 'paired' });
    send(sock, { t: 'paired' });
  } else if (m.t === 'relay') {
    const p = peerOf(sock);
    if (p) send(p, { t: 'msg', d: m.d });
  }
}

function onClose(sock) {
  const r = rooms.get(sock.room);
  if (!r) return;
  const p = r.host === sock ? r.guest : r.host;
  rooms.delete(sock.room);
  if (p) { send(p, { t: 'peerleft' }); p.room = null; }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Game relay: ok, rooms ${rooms.size}\n`);
});
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  attach(sock, text => onMessage(sock, text), () => onClose(sock));
});
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (!r.guest && now - r.t > ROOM_TTL) { rooms.delete(code); r.host.destroy(); }
}, 60000).unref();
server.listen(PORT, () => console.log(`Relay listening on :${PORT}`));
