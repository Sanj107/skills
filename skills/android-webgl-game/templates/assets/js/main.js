'use strict';
// Starter game: a voxel island on an animated sea. Tap to earn coins (saved), Back/pause hooks
// for the Android shell, and a LAN ping between two phones (or two browser tabs) via VC.Net.
(function (VC) {
  const SAVE_KEY = 'game_save_v1';
  const state = load() || { coins: 0, lastSave: Date.now() };
  const awaySec = (Date.now() - state.lastSave) / 1000; // measure before the first autosave

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { /* storage blocked */ }
    if (!raw && window.AndroidBridge) { try { raw = AndroidBridge.loadBackup(); } catch (e) { /* none */ } }
    try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function save() {
    state.lastSave = Date.now();
    const raw = JSON.stringify(state);
    try { localStorage.setItem(SAVE_KEY, raw); } catch (e) { /* ignore */ }
    if (window.AndroidBridge) AndroidBridge.saveBackup(raw);
  }

  // ------------------------------------------------------------------ scene
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd3f5);
  scene.fog = new THREE.Fog(0x8fd3f5, 40, 120);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
  scene.add(new THREE.HemisphereLight(0xdff3ff, 0x7a6a4a, 0.75));
  const sun = new THREE.DirectionalLight(0xfff2d6, 0.85);
  sun.position.set(-20, 40, 25);
  scene.add(sun);

  const seaGeo = new THREE.PlaneGeometry(200, 200, 60, 60);
  seaGeo.rotateX(-Math.PI / 2);
  const seaBase = seaGeo.attributes.position.array.slice();
  scene.add(new THREE.Mesh(seaGeo, new THREE.MeshPhongMaterial({ color: 0x1a78a8, specular: 0x9fe3ff, shininess: 70, flatShading: true })));

  // Voxel island: sand ring, grass top, one palm.
  const v = new VC.Voxel.Vox();
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) {
    const d = Math.hypot(x, z) / 14;
    if (d > 1) continue;
    const h = d > 0.8 ? 0 : 2;
    for (let y = -2; y <= h; y++) v.set(x, y, z, y === h ? (h ? '#5fae46' : '#e3cc8e') : '#d8c389');
  }
  for (let y = 3; y < 11; y++) v.set(Math.round((y - 3) * 0.3), y, 0, '#8a6238');
  for (let a = 0; a < 6; a++) for (let k = 1; k <= 4; k++) {
    const ang = a / 6 * Math.PI * 2;
    v.set(2 + Math.cos(ang) * k, 11 - Math.floor(k * k / 6), Math.sin(ang) * k, '#2f9e44');
  }
  const island = VC.Voxel.toMesh(v, { scale: 0.25, center: [0, 0, 0] });
  island.position.y = -0.3;
  scene.add(island);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.7 ? 62 : 50; // portrait screens need a wider vertical FOV
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------------ input
  const scoreEl = document.getElementById('score');
  canvas.addEventListener('pointerdown', e => {
    unlockAudio();
    state.coins += 1;
    scoreEl.textContent = state.coins;
    const p = document.createElement('div');
    p.className = 'pop';
    p.textContent = '+1';
    p.style.left = e.clientX + 'px';
    p.style.top = e.clientY + 'px';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 800);
    beep(1320, 0.06);
    if (window.AndroidBridge) AndroidBridge.vibrate(8);
  });

  let actx = null;
  function unlockAudio() {
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
    if (actx && actx.state === 'suspended') actx.resume();
  }
  function beep(f, d) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(0.05, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
  }

  // ------------------------------------------------------------------ LAN demo
  const log = t => { document.getElementById('lan-log').textContent = t; };
  const N = VC.Net;
  N.on('hosting', o => log('Hosting… ' + (o.ips || '')));
  N.on('found', o => { log('Found ' + o.name + ' @ ' + o.ip + ' — connecting'); N.discover(false); N.connect(o.ip); });
  // Internet play instead: run tools/relay_server.js somewhere and call
  // N.onlineHost('ws://host:8080') (emits hosting{code}) / N.onlineJoin('ws://host:8080', code).
  N.on('hosting', o => { if (o.code) log('Room code: ' + o.code); });
  N.on('connected', o => { log('Connected to ' + o.ip); N.send({ t: 'hello', coins: state.coins }); });
  N.on('msg', o => log('Peer says: ' + JSON.stringify(o.data)));
  N.on('closed', () => log('Disconnected'));
  N.on('error', o => log('Error: ' + o.message));
  document.getElementById('lan').addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (act === 'host') N.host('Player');
    if (act === 'find') { N.discover(true); log('Searching…'); }
    if (act === 'ping') N.send({ t: 'ping', at: Date.now(), coins: state.coins });
  });

  // ------------------------------------------------------------------ loop & lifecycle
  let last = performance.now(), lastWall = Date.now(), saveT = 10, t = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now; t += dt;
    // Frames stop in the background: treat a long gap as time away (idle income goes here).
    const wall = Date.now();
    if (wall - lastWall > 60000) log('Welcome back after ' + Math.round((wall - lastWall) / 1000) + ' s');
    lastWall = wall;
    const a = seaGeo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) a[i + 1] = Math.sin(seaBase[i] * 0.18 + t * 1.1) * 0.16 + Math.sin(seaBase[i + 2] * 0.23 + t * 1.4) * 0.12;
    seaGeo.attributes.position.needsUpdate = true;
    camera.position.set(Math.sin(t * 0.1) * 3, 9, 13);
    camera.lookAt(0, 0.5, 0);
    renderer.render(scene, camera);
    saveT -= dt;
    if (saveT <= 0) { saveT = 10; save(); }
  }
  scoreEl.textContent = state.coins;
  if (awaySec > 60) log('You were away ' + Math.round(awaySec) + ' s');
  requestAnimationFrame(frame);

  // Hooks called by MainActivity.
  VC.onBack = () => false; // return true when the page consumed Back (closed a panel)
  VC.onPause = () => { save(); if (actx) actx.suspend(); };
  VC.onResume = () => { if (actx) actx.resume(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
})(window.VC);
