import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildReactor, buildNode, buildCore, orbitPosition, C, SCALE } from './reactor.js';
import { AGENTS } from './data.js';

// One scene for the whole path login -> Arc Core. `p` is the only phase variable:
// 0 = login, 1 = core. Every visual is a pure function of p, so the same code plays
// forward (login) and backward (logout) and the DOM never jumps between two renderers.

const OS_REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const shot = location.hash === '#shot';
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (p, a, b) => clamp((p - a) / (b - a));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;

// Motion budget. HUD becomes clickable at P_LIVE, long before the animation ends.
const DUR = { full: 2.4, short: 0.9, min: 0.4 };
const P_LIVE = 0.58;
let eff = OS_REDUCE ? 'min' : 'full';
const reduced = () => eff === 'min';

function start() {
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('#scene'), antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: shot });
  } catch (e) { root.classList.add('no-webgl'); }
  const gl = !!renderer;

  const mobile = innerWidth < 760;
  let dpr = Math.min(devicePixelRatio, mobile ? 1.5 : 1.75);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 1, 7000);
  let composer, bloom, R, core, coreLight, rings = [], nodes = [], spokes = [], dust, dustMat, controls;
  const labels = [];

  if (gl) {
    renderer.setPixelRatio(dpr); renderer.toneMapping = THREE.NoToneMapping;
    scene.background = new THREE.Color(C.void);
    scene.fog = new THREE.Fog(C.void, 1500, 3400);
    scene.add(new THREE.AmbientLight(0x66e8ff, .5));
    const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(300, 500, 500); scene.add(key);
    R = buildReactor(); scene.add(R.root); R.hull.visible = false;

    nodes = AGENTS.map((a, i) => { const n = buildNode(); n.userData.home = orbitPosition(i, AGENTS.length); n.visible = false; scene.add(n); return n; });
    const spokeMat = new THREE.LineBasicMaterial({ color: 0x0aa6b8, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false });
    spokes = nodes.map((n) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), spokeMat); l.visible = false; scene.add(l); return l; });

    const dustN = 800, dp = new Float32Array(dustN * 3);
    for (let i = 0; i < dustN; i++) {
      const r = (3 + Math.random() * 5.5) * SCALE, th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1);
      dp.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * .4, r * Math.cos(ph)], i * 3);
    }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dustMat = new THREE.PointsMaterial({ color: C.primary, size: 2.4, transparent: true, opacity: .3, depthWrite: false, blending: THREE.AdditiveBlending });
    dust = new THREE.Points(dg, dustMat); scene.add(dust);

    core = buildCore(); core.visible = false; scene.add(core);
    coreLight = new THREE.PointLight(C.reactor, 0, 1400, 1.7); scene.add(coreLight);
    const torus = (r, tube, color, opacity) => new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 180), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    rings = [
      { m: torus(1.55 * SCALE, 1.1, C.reactor, .75), rot: [Math.PI / 2.3, 0, 0], v: [.25, 0, 0] },
      { m: torus(1.85 * SCALE, .8, C.primary, .55), rot: [Math.PI / 3.1, Math.PI / 5, 0], v: [0, .18, 0] },
      { m: torus(2.1 * SCALE, .7, C.reactor, .45), rot: [0, Math.PI / 2.4, Math.PI / 6], v: [0, 0, .32] },
    ];
    rings.forEach((r) => { r.m.visible = false; scene.add(r.m); });

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .3, .45, .5);
    composer.addPass(bloom); composer.addPass(new OutputPass());

    controls = new OrbitControls(camera, $('#core-hit'));
    controls.enablePan = false; controls.enableDamping = true; controls.enabled = false;
    controls.maxPolarAngle = Math.PI / 1.6; controls.minPolarAngle = Math.PI / 4; controls.autoRotateSpeed = .35;
  }

  // labels
  const labelHost = $('#labels');
  const mk = (name, role, id) => { const d = document.createElement('div'); d.className = 'nl'; d.id = id; d.innerHTML = `<b>${name}</b><span>${role}</span>`; labelHost.append(d); return d; };
  labels.push({ el: mk('J.A.R.V.I.S.', 'Primary Brain / Core', 'l-core') });
  AGENTS.forEach((a, i) => labels.push({ el: mk(a.name, a.role.replace('&', '&amp;'), `l-a${i}`), node: nodes[i] }));

  // ---- state ----
  const st = { mode: 'login', p: 0, dir: 0, elapsed: 0, dur: DUR.full, skip: false, boot: shot ? 1 : 0, liveAt: null, lastDur: 0, lastLive: 0, focus: -1, focusE: 0, idle: 0, shake: 0, fps: 60, lowQ: false };
  const L = new THREE.Vector3(), Lbase = new THREE.Vector3(), Lm = new THREE.Vector3(), Llook = new THREE.Vector3();
  const coreCam = new THREE.Vector3(0, 2.2 * SCALE, 8.5 * SCALE), coreLook = new THREE.Vector3();
  const endCam = coreCam.clone(), endLook = coreLook.clone();
  const cam = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3(), v = new THREE.Vector3(), tgt = new THREE.Vector3();
  const colA = new THREE.Color(C.primary), colB = new THREE.Color(C.reactor), colR = new THREE.Color(0xff4a3a), colT = new THREE.Color();
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  let time = 0, last = performance.now(), frames = 0, slow = 0, skipOdd = false;

  // reactor goes where the DOM slot is, so the 3D reactor and the layout always agree
  function fitCamera(rect, fov = 32) {
    const h = innerHeight, tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const ppu = rect.width / 200, d = h / (2 * tan * ppu);
    return { d, x: -(rect.left + rect.width / 2 - innerWidth / 2) / ppu, y: (rect.top + rect.height / 2 - h / 2) / ppu };
  }
  function layout() {
    const w = innerWidth, h = innerHeight, asp = w / h;
    if (gl) { renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = asp; camera.updateProjectionMatrix(); }
    coreCam.set(0, 2.2 * SCALE, 8.5 * SCALE).multiplyScalar(clamp(1.3 / asp, 1, 2.3));
    const f = fitCamera($('#slot').getBoundingClientRect());
    Lbase.set(f.x, f.y, f.d); Llook.set(f.x, f.y, 0); Lm.set(f.x * .3, f.y * .3, f.d * .42);
    if (st.mode !== 'trans') endCam.copy(coreCam);
  }

  function applyReactor(a, fade) {
    R.parts.forEach((q) => {
      const o = q.obj, off = 1 - a;
      o.position.z = q.z * off; o.scale.z = lerp(q.depth, 1, a); o.rotation.x = q.tilt * off;
      o.rotation.z = q.spin * off * (reduced() ? 4 : time * 2 + 4);
    });
    const wall = lerp(.3, 1, a * a);
    R.mats.line.opacity = fade * wall; R.mats.lineSoft.opacity = .6 * fade * wall; R.mats.lineFaint.opacity = .42 * fade * lerp(.5, 1, a);
    R.disc.material.opacity = fade * lerp(.14, 1, a); R.d14.material.opacity = fade; R.d6.material.opacity = fade;
  }

  function placeLabels(show) {
    labels.forEach((l) => {
      if (l.node) { v.copy(l.node.position); v.y -= .62 * SCALE; } else v.set(0, -1.32 * SCALE, 0);
      v.project(camera);
      const vis = show > .01 && v.z < 1;
      l.el.style.opacity = vis ? show : 0;
      if (vis) l.el.style.transform = `translate(-50%,-50%) translate(${(v.x * .5 + .5) * innerWidth}px,${(-v.y * .5 + .5) * innerHeight}px)`;
    });
  }

  // ---- every visual as a function of p ----
  function scenePhase(p, dt) {
    const boot = ease(st.boot);
    // camera: bezier login -> dive -> core. In minimal-motion mode it is a cut hidden by a fade to black.
    L.copy(Lbase); L.z *= lerp(1.5, 1, boot);
    if (st.mode === 'core') { controls.update(); }
    else {
      const k = reduced() ? (p > .5 ? 1 : 0) : ease(seg(p, .04, .9));
      const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
      Lm.z = L.z * .42;
      cam.set(L.x * a + Lm.x * b + endCam.x * c, L.y * a + Lm.y * b + endCam.y * c, L.z * a + Lm.z * b + endCam.z * c);
      look.set(Llook.x * a + Llook.x * .4 * b + endLook.x * c, Llook.y * a + Llook.y * .4 * b + endLook.y * c, endLook.z * c);
      const w = 1 - seg(p, 0, .25);
      if (!reduced() && w > 0) { cam.x += ptr.sx * 16 * w; cam.y -= ptr.sy * 10 * w; }
      camera.position.copy(cam); camera.fov = lerp(32, 45, k); camera.updateProjectionMatrix(); camera.lookAt(look);
    }

    // reactor: front-on with a little depth at login, then it comes apart and fades
    const aBase = .6 * (1 - ease(seg(p, .04, .5)));
    applyReactor(aBase * lerp(.15, 1, boot), (1 - seg(p, .16, .5)) * ease(seg(st.boot, 0, .5)));
    colT.copy(colA).lerp(colB, seg(p, .08, .3));
    if (st.shake > 0) { const s = st.shake * st.shake; colT.lerp(colR, s * .85); R.root.position.x = Math.sin(time * 70) * 5 * s; R.root.rotation.z = Math.sin(time * 53) * .035 * s; }
    else { R.root.position.x = 0; R.root.rotation.z = 0; }
    R.mats.line.color.copy(colT); R.mats.lineSoft.color.copy(colT); R.mats.lineFaint.color.copy(colT);
    R.root.visible = p < .55;

    // Arc Core
    const g = ease(seg(p, .12, .5));
    core.visible = g > 0;
    core.scale.setScalar(lerp(.9, 1, g) * (1 + Math.sin(time * 1.4) * .03)); core.rotation.y += dt * .15;
    core.material.uniforms.t.value = time; core.material.uniforms.heat.value = seg(p, .1, .32); core.material.uniforms.op.value = g;
    coreLight.intensity = 70000 * g;
    const u = ease(seg(p, .2, .78));
    rings.forEach((r) => {
      r.m.visible = u > 0;
      const s = lerp(96 / r.m.geometry.parameters.radius, 1, u); r.m.scale.set(s, s, s);
      r.spin = r.spin || [0, 0, 0];
      if (!reduced()) r.v.forEach((wv, i) => (r.spin[i] += wv * dt));
      r.m.rotation.set(lerp(0, r.rot[0], u) + r.spin[0], lerp(0, r.rot[1], u) + r.spin[1], lerp(0, r.rot[2], u) + r.spin[2]);
    });
    nodes.forEach((n, i) => {
      const q = ease(seg(p, .34 + i * .04, .78 + i * .03));
      n.visible = spokes[i].visible = q > 0;
      n.position.copy(n.userData.home).multiplyScalar(q);
      n.scale.setScalar((.2 + q * .8) * (1 + .3 * (st.focus === i ? st.focusE : 0)));
      if (!reduced()) { n.userData.body.rotation.x += dt * .15; n.userData.body.rotation.y += dt * .1; }
      n.userData.body.material.emissiveIntensity = .3 + (st.focus === i ? .7 * st.focusE : 0);
      const pos = spokes[i].geometry.attributes.position; pos.setXYZ(1, n.position.x, n.position.y, n.position.z); pos.needsUpdate = true;
    });
    dustMat.opacity = lerp(.3, .55, seg(p, .4, .9)); if (!reduced()) dust.rotation.y += dt * .01;
    if (!st.lowQ) { bloom.strength = lerp(.3, .62, ease(seg(p, .08, .35))); bloom.threshold = lerp(.5, .55, p); bloom.radius = .55; }
    placeLabels(seg(p, .6, .85));
  }

  const grid = $('#grid'), vig = $('#vig'), ark = $('#ark'), hudEl = $('#core-ui'), hit = $('#core-hit');
  const tlf = $('#tlf'), tlm = $('#tlm'), tlt = $('#tlt');
  function uiPhase(p) {
    const live = p >= P_LIVE;
    grid.style.opacity = (.55 * (1 - seg(p, .1, .5))).toFixed(3);
    vig.style.opacity = lerp(1, .35, seg(p, .3, .9)).toFixed(3);
    // ignition flash, or a plain fade to black when motion is reduced (no flicker)
    if (reduced()) { ark.style.background = '#000'; ark.style.opacity = (Math.sin(Math.PI * p) ** 2).toFixed(3); }
    else { ark.style.background = 'var(--reactor)'; ark.style.opacity = (.3 * Math.sin(Math.PI * seg(p, .18, .55)) ** 2).toFixed(3); }
    hudEl.style.opacity = ease(seg(p, P_LIVE - .08, P_LIVE + .12)).toFixed(3);
    hudEl.style.visibility = live || st.mode === 'core' ? 'visible' : 'hidden';
    root.classList.toggle('hud-live', live);
    const loginOn = p < .25;
    root.classList.toggle('leaving', st.mode === 'core' || (st.mode === 'trans' && (st.dir > 0 || !loginOn)));
    $('#login').style.visibility = p < .6 ? 'visible' : 'hidden';
    hit.style.display = st.mode === 'core' ? 'block' : 'none';
    tlf.style.width = (p * 100).toFixed(1) + '%';
  }

  function frameStep(dt) {
    time += reduced() ? 0 : dt;
    ptr.sx = lerp(ptr.sx, ptr.x, 1 - Math.exp(-dt * 4)); ptr.sy = lerp(ptr.sy, ptr.y, 1 - Math.exp(-dt * 4));
    if (st.boot < 1) st.boot = reduced() || shot ? 1 : clamp(st.boot + dt / 1.5);
    if (st.shake > 0) st.shake = Math.max(0, st.shake - dt / .45);
    st.focusE = lerp(st.focusE, st.focus >= 0 ? 1 : 0, 1 - Math.exp(-dt * 6));

    if (st.mode === 'trans') {
      if (!st.hold) st.elapsed += dt * (st.skip ? 6 : 1);
      const k = st.hold ? (st.dir > 0 ? st.p : 1 - st.p) : clamp(st.elapsed / st.dur);
      st.p = st.dir > 0 ? k : 1 - k;
      if (st.dir > 0 && st.liveAt === null && st.p >= P_LIVE) st.liveAt = st.elapsed;
      tlm.style.left = (P_LIVE * 100) + '%';
      tlt.textContent = `t = ${Math.min(st.elapsed, st.dur).toFixed(2)} s z ${st.dur.toFixed(1)} s · HUD klikalny ${st.p >= P_LIVE || st.dir < 0 ? '✓' : 'od ' + (P_LIVE * st.dur).toFixed(1) + ' s'}`;
      if (k >= 1 && !st.hold) finish();
    } else if (st.mode === 'core') {
      st.idle += dt;
      // follow the focused agent gently; recentre when nothing is focused
      if (gl) {
        tgt.copy(st.focus >= 0 && nodes[st.focus] ? nodes[st.focus].position : coreLook).multiplyScalar(st.focus >= 0 ? .35 : 1);
        controls.target.lerp(tgt, 1 - Math.exp(-dt * 4));
        controls.autoRotate = !reduced() && st.focus < 0;
      }
    }
    if (gl) scenePhase(st.p, dt);
    uiPhase(st.p);
  }

  function finish() {
    if (st.dir > 0) {
      st.mode = 'core'; st.p = 1; st.lastDur = st.dur; st.lastLive = st.liveAt ?? P_LIVE * st.dur;
      if (gl) { controls.target.copy(coreLook); controls.enabled = true; }
      tlt.textContent = `Ostatnie przejście: ${st.lastDur.toFixed(1)} s · HUD klikalny od ${st.lastLive.toFixed(1)} s`;
      $('#out').focus({ preventScroll: true });
    } else {
      st.mode = 'login'; st.p = 0; st.focus = -1;
      root.classList.remove('leaving');
      $('#key').focus({ preventScroll: true });
      tlt.textContent = 'Powrót do logowania w tej samej scenie.';
    }
    st.skip = false; st.idle = 0;
  }

  function go(dir) {
    if (st.mode === 'trans' || (dir > 0 && st.mode !== 'login') || (dir < 0 && st.mode !== 'core')) return;
    st.mode = 'trans'; st.dir = dir; st.elapsed = 0; st.skip = false; st.liveAt = null;
    st.dur = dir > 0 ? DUR[eff] : DUR[eff] * .55;
    if (dir > 0) { endCam.copy(coreCam); endLook.copy(coreLook); }
    else { if (gl) { endCam.copy(camera.position); endLook.copy(controls.target); } st.focus = -1; }
    if (gl) controls.enabled = false;
    $('#detail').classList.remove('on');
    if (!gl) { st.dur = .35; }
  }

  // ---- form ----
  const form = $('#login-form'), msg = $('#lmsg');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (st.mode !== 'login') return;
    const pw = $('#key').value;
    if (!pw || pw === 'zle') {
      st.shake = 1; msg.textContent = 'Odmowa dostępu. Sprawdź klucz.'; form.classList.remove('err'); void form.offsetWidth; form.classList.add('err');
      $('#key').focus(); return;
    }
    msg.textContent = ''; form.classList.remove('err'); go(1);
  });
  $('#out').addEventListener('click', () => go(-1));

  // skip: any pointer or key press during the animation fast-forwards it
  const skip = () => { if (st.mode === 'trans') st.skip = true; if (st.boot < 1) st.boot = 1; };
  addEventListener('pointerdown', skip, { passive: true });
  addEventListener('keydown', (e) => { skip(); if (e.key === 'Escape') select(-1); });
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { ptr.x = e.clientX / innerWidth * 2 - 1; ptr.y = e.clientY / innerHeight * 2 - 1; } st.idle = 0; }, { passive: true });

  // ---- roster (HUD, clickable while the animation is still settling) ----
  const roster = $('#roster'), detail = $('#detail');
  AGENTS.forEach((a, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.i = i;
    b.innerHTML = `<i>${String(i + 1).padStart(2, '0')}</i><span><b>${a.name}</b><em>${a.role.replace('&', '&amp;')}</em></span>`;
    b.addEventListener('click', () => select(st.focus === i ? -1 : i)); roster.append(b);
  });
  function select(i) {
    st.focus = i; st.idle = 0;
    $$('.chip').forEach((c, k) => c.setAttribute('aria-pressed', k === i));
    labels.forEach((l, k) => l.el.classList.toggle('on', k === i + 1));
    if (i < 0) { detail.classList.remove('on'); return; }
    detail.innerHTML = `<p class="tag"><span>${AGENTS[i].name}</span><i>online</i></p><p>${AGENTS[i].text}</p>`; detail.classList.add('on');
  }

  // ---- demo panel ----
  $$('[data-eff]').forEach((b) => b.addEventListener('click', () => {
    eff = b.dataset.eff; $$('[data-eff]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    tlt.textContent = eff === 'min' ? 'Tryb minimalny: bez ruchu kamery, tylko zanikanie do czerni (prefers-reduced-motion).' : `Czas przejścia: ${DUR[eff]} s, HUD od ${(P_LIVE * DUR[eff]).toFixed(1)} s.`;
    if (st.mode === 'login') $('#key').focus();
  }));
  $('#bad').addEventListener('click', () => { if (st.mode !== 'login') return; $('#key').value = 'zle'; form.requestSubmit(); });
  $('#again').addEventListener('click', () => { if (st.mode === 'core') go(-1); else if (st.mode === 'login') { $('#key').value = 'demo'; form.requestSubmit(); } });
  $$('[data-eff]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.eff === eff));
  if (innerWidth < 760) $('#demo').removeAttribute('open');

  // ---- loop ----
  function quality(dt) {
    if (shot || reduced() || st.lowQ || !gl) return;
    frames++; if (dt > .034) slow++;
    if (frames === 60) {
      st.fps = slow > 30 ? 30 : 60;
      if (slow > 30) { st.lowQ = true; dpr = 1; renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight, false); composer.setPixelRatio(1); composer.setSize(innerWidth, innerHeight); bloom.strength = .18; }
      $('#stat').textContent = st.lowQ ? 'Jakość: obniżona automatycznie (DPR 1, słabszy bloom)' : `Jakość: pełna (DPR ${dpr})`;
    }
  }
  function frame(now) {
    if (!shot) requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    quality(dt);
    // idle in the dashboard: 30 fps after 6 s without input, nothing when the tab is hidden
    if (st.mode === 'core' && st.idle > 6 && !shot) { skipOdd = !skipOdd; if (skipOdd) return; }
    frameStep(dt);
    if (gl) composer.render(dt);
    const idleNow = st.mode === 'core' && st.idle > 6;
    root.classList.toggle('idle', idleNow);
  }

  addEventListener('resize', layout);
  layout(); if (document.fonts) document.fonts.ready.then(layout);
  $('#stat').textContent = gl ? 'Jakość: sprawdzam…' : 'Brak WebGL: ta sama ścieżka, bez sceny 3D.';
  $('#key').focus({ preventScroll: true });
  if (!gl) { st.boot = 1; }
  requestAnimationFrame(frame);
  window.__f = { st, go, frame: (dt = .016) => { frameStep(dt); if (gl) composer.render(dt); }, set: (p, mode) => { st.p = p; st.mode = mode || (p >= 1 ? 'core' : p <= 0 ? 'login' : 'trans'); if (mode === 'core' && gl) { controls.target.copy(coreLook); controls.enabled = true; camera.position.copy(coreCam); } }, select, layout };
}

start();
