'use strict';
// Network link for 1v1 duels. Two transports behind one API:
//  - 'lan':    on Android, TCP + UDP-broadcast discovery in GameBridge.java (window.AndroidBridge);
//              in a desktop browser, a BroadcastChannel emulation so two tabs can duel (tests).
//  - 'online': WebSocket to a relay server (tools/relay_server.js) with 4-letter room codes.
// Events: hosting{ips|code} found{ip,name} connected{ip} msg{data} closed error{message}
(function (VC) {
  const listeners = {};
  const Net = {
    kind: window.AndroidBridge ? 'android' : (window.BroadcastChannel ? 'browser' : 'none'),
    mode: 'lan',
    connected: false,
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    off(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter(f => f !== fn); },
    emit(ev, data) {
      if (ev === 'connected') Net.connected = true;
      if (ev === 'closed') Net.connected = false;
      for (const fn of (listeners[ev] || []).slice()) fn(data || {});
    },
  };
  VC.Net = Net;

  // ------------------------------------------------------------------ LAN
  const lan = {};
  // Called by GameBridge.java through evaluateJavascript.
  window.VCNet = {
    onNative(str) {
      let o;
      try { o = JSON.parse(str); } catch (e) { return; }
      if (Net.mode !== 'lan') return;
      if (o.ev === 'msg') {
        let data;
        try { data = JSON.parse(o.data); } catch (e) { return; }
        Net.emit('msg', { data });
        return;
      }
      Net.emit(o.ev, o);
    },
  };

  if (Net.kind === 'android') {
    const A = window.AndroidBridge;
    lan.host = name => A.lanHost(name);
    lan.discover = on => A.lanDiscover(!!on);
    lan.connect = ip => A.lanConnect(ip);
    lan.send = obj => { if (Net.connected) A.lanSend(JSON.stringify(obj)); };
    lan.close = () => { Net.connected = false; A.lanClose(); };
    lan.localIps = () => { try { return A.getLocalIps(); } catch (e) { return ''; } };
  } else if (Net.kind === 'browser') {
    // Two browser tabs on the same origin play the role of two phones.
    const ch = new BroadcastChannel('vc-lan');
    const me = 'tab-' + Math.random().toString(36).slice(2, 7);
    let hosting = false, discovering = false, peer = null, beaconT = null, name = '', want = null;
    ch.onmessage = ev => {
      const m = ev.data;
      if (Net.mode !== 'lan' || (m.to && m.to !== me)) return;
      if (m.type === 'beacon' && discovering) Net.emit('found', { ip: m.from, name: m.name });
      if (m.type === 'connect' && hosting && !peer) {
        peer = m.from; hosting = false; clearInterval(beaconT);
        ch.postMessage({ type: 'accept', to: peer, from: me });
        Net.emit('connected', { ip: peer });
      }
      if (m.type === 'accept' && m.from === want) { peer = m.from; Net.emit('connected', { ip: peer }); }
      if (m.type === 'msg' && m.from === peer) Net.emit('msg', { data: m.data });
      if (m.type === 'close' && m.from === peer) { peer = null; Net.emit('closed', {}); }
    };
    lan.host = n => {
      lan.close();
      name = n; hosting = true;
      Net.emit('hosting', { ips: me });
      const beacon = () => ch.postMessage({ type: 'beacon', from: me, name });
      beacon();
      beaconT = setInterval(beacon, 1000);
    };
    lan.discover = on => { discovering = !!on; };
    lan.connect = ip => {
      lan.close();
      want = ip;
      ch.postMessage({ type: 'connect', to: ip, from: me });
      setTimeout(() => { if (!Net.connected && want === ip) Net.emit('error', { message: 'no answer' }); }, 3000);
    };
    lan.send = obj => { if (peer) ch.postMessage({ type: 'msg', to: peer, from: me, data: obj }); };
    lan.close = () => {
      if (peer) ch.postMessage({ type: 'close', to: peer, from: me });
      peer = null; hosting = false; Net.connected = false; want = null; clearInterval(beaconT);
    };
    lan.localIps = () => me;
  } else {
    lan.host = lan.discover = lan.connect = lan.send = lan.close = () => {};
    lan.localIps = () => '';
  }

  // ------------------------------------------------------------------ online (relay)
  const online = { ws: null, gen: 0 };
  online.open = function (url, first) {
    online.close();
    const gen = ++online.gen;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { Net.emit('error', { message: 'bad server address' }); return; }
    online.ws = ws;
    const timer = setTimeout(() => { if (ws.readyState !== 1 && gen === online.gen) { ws.close(); Net.emit('error', { message: 'server timeout' }); } }, 7000);
    ws.onopen = () => { clearTimeout(timer); ws.send(JSON.stringify(first)); };
    ws.onmessage = ev => {
      if (gen !== online.gen) return;
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'room') Net.emit('hosting', { code: m.code });
      else if (m.t === 'paired') Net.emit('connected', { ip: 'online' });
      else if (m.t === 'msg') Net.emit('msg', { data: m.d });
      else if (m.t === 'peerleft') Net.emit('closed', {});
      else if (m.t === 'err') Net.emit('error', { message: m.m });
    };
    ws.onerror = () => { if (gen === online.gen && !Net.connected) Net.emit('error', { message: 'cannot reach server' }); };
    ws.onclose = () => { clearTimeout(timer); if (gen === online.gen && Net.connected) Net.emit('closed', {}); };
  };
  online.close = function () {
    online.gen++;
    if (online.ws) { try { online.ws.close(); } catch (e) { /* ignore */ } }
    online.ws = null;
    Net.connected = false;
  };

  // ------------------------------------------------------------------ facade
  Net.host = name => { Net.mode = 'lan'; online.close(); lan.host(name); };
  Net.discover = on => { if (on) { Net.mode = 'lan'; online.close(); } lan.discover(on); };
  Net.connect = ip => { Net.mode = 'lan'; online.close(); lan.connect(ip); };
  Net.localIps = () => lan.localIps();
  Net.onlineHost = url => { lan.close(); lan.discover(false); Net.mode = 'online'; online.open(url, { t: 'create' }); };
  Net.onlineJoin = (url, code) => { lan.close(); lan.discover(false); Net.mode = 'online'; online.open(url, { t: 'join', code }); };
  Net.send = obj => {
    if (Net.mode === 'online') { if (online.ws && online.ws.readyState === 1) online.ws.send(JSON.stringify({ t: 'relay', d: obj })); }
    else lan.send(obj);
  };
  Net.close = () => { if (Net.mode === 'online') online.close(); else lan.close(); Net.connected = false; };
})(window.VC);
