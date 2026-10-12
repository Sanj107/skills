'use strict';
// Local-network link for 1v1 duels.
//  - On Android: TCP + UDP-broadcast discovery implemented in GameBridge.java (window.AndroidBridge).
//  - In a desktop browser: a BroadcastChannel emulation so two tabs can duel (used for testing).
// Both expose the same API and emit: hosting{ips} found{ip,name} connected{ip} msg{data} closed error{message}
(function (VC) {
  const listeners = {};
  const Net = {
    kind: window.AndroidBridge ? 'android' : (window.BroadcastChannel ? 'browser' : 'none'),
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    off(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter(f => f !== fn); },
    emit(ev, data) { for (const fn of (listeners[ev] || []).slice()) fn(data || {}); },
    connected: false,
  };
  VC.Net = Net;

  // Called by GameBridge.java through evaluateJavascript.
  window.VCNet = {
    onNative(str) {
      let o;
      try { o = JSON.parse(str); } catch (e) { return; }
      if (o.ev === 'connected') Net.connected = true;
      if (o.ev === 'closed') Net.connected = false;
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
    Net.host = name => A.lanHost(name);
    Net.discover = on => A.lanDiscover(!!on);
    Net.connect = ip => A.lanConnect(ip);
    Net.send = obj => { if (Net.connected) A.lanSend(JSON.stringify(obj)); };
    Net.close = () => { Net.connected = false; A.lanClose(); };
    Net.localIps = () => { try { return A.getLocalIps(); } catch (e) { return ''; } };
  } else if (Net.kind === 'browser') {
    // Two browser tabs on the same origin play the role of two phones.
    const ch = new BroadcastChannel('vc-lan');
    const me = 'tab-' + Math.random().toString(36).slice(2, 7);
    let hosting = false, discovering = false, peer = null, beaconT = null, name = '';
    ch.onmessage = ev => {
      const m = ev.data;
      if (m.to && m.to !== me) return;
      if (m.type === 'beacon' && discovering) Net.emit('found', { ip: m.from, name: m.name });
      if (m.type === 'connect' && hosting && !peer) {
        peer = m.from; hosting = false; clearInterval(beaconT);
        ch.postMessage({ type: 'accept', to: peer, from: me });
        Net.connected = true;
        Net.emit('connected', { ip: peer });
      }
      if (m.type === 'accept' && m.from === Net._want) {
        peer = m.from; Net.connected = true;
        Net.emit('connected', { ip: peer });
      }
      if (m.type === 'msg' && m.from === peer) Net.emit('msg', { data: m.data });
      if (m.type === 'close' && m.from === peer) { peer = null; Net.connected = false; Net.emit('closed', {}); }
    };
    Net.host = n => {
      Net.close();
      name = n; hosting = true;
      Net.emit('hosting', { ips: me });
      const beacon = () => ch.postMessage({ type: 'beacon', from: me, name });
      beacon();
      beaconT = setInterval(beacon, 1000);
    };
    Net.discover = on => { discovering = !!on; };
    Net.connect = ip => {
      Net.close();
      Net._want = ip;
      ch.postMessage({ type: 'connect', to: ip, from: me });
      setTimeout(() => { if (!Net.connected && Net._want === ip) Net.emit('error', { message: 'нет ответа' }); }, 3000);
    };
    Net.send = obj => { if (peer) ch.postMessage({ type: 'msg', to: peer, from: me, data: obj }); };
    Net.close = () => {
      if (peer) ch.postMessage({ type: 'close', to: peer, from: me });
      peer = null; hosting = false; Net.connected = false; Net._want = null; clearInterval(beaconT);
    };
    Net.localIps = () => me;
  } else {
    Net.host = Net.discover = Net.connect = Net.send = Net.close = () => {};
    Net.localIps = () => '';
  }
})(window.VC);
