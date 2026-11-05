import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildReactor, buildNode, buildCore, orbitPosition, C, SCALE } from './reactor.js';
import { AGENTS, MODULES } from './data.js';
import { orbitSpec, orbitAt, decorateRing, buildCoreExtras, makePackets } from './core2.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const shot = location.hash === '#shot';
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (p, a, b) => clamp((p - a) / (b - a));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;

const TUNNEL = { start: 420, end: -2880, first: -300, step: 205 };

function start() {
  const canvas = $('#scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: shot });
  } catch (e) { root.classList.add('no-webgl'); wireFallback(); return; }

  const mobile = innerWidth < 760;
  let dpr = Math.min(devicePixelRatio, mobile ? 1.5 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.void);
  scene.fog = new THREE.Fog(C.void, 900, 2600);
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 7000);

  scene.add(new THREE.AmbientLight(0x66e8ff, .5));
  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(300, 500, 500); scene.add(key);

  const R = buildReactor(); scene.add(R.root);

  // satellites, spokes
  const nodes = AGENTS.map((a, i) => {
    const n = buildNode(); n.userData.home = orbitPosition(i, AGENTS.length); n.position.copy(n.userData.home); scene.add(n); return n;
  });
  const spokeMat = new THREE.LineBasicMaterial({ color: 0x0aa6b8, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false });
  const spokes = nodes.map((n) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), n.position.clone()]);
    const l = new THREE.Line(g, spokeMat.clone()); scene.add(l); return l;
  });

  // ---- Arc Core v2: individual orbits, status colours, plasma shell, corona, floor, light packets ----
  const STATUS = ['idle', 'busy', 'idle', 'busy', 'idle', 'idle'];
  const specs = AGENTS.map((a, i) => orbitSpec(i, AGENTS.length));
  const X = buildCoreExtras(specs); X.group.visible = false; scene.add(X.group);
  const pk = makePackets(AGENTS.length); scene.add(pk.points);
  const cCyan = new THREE.Color(C.primary), cAmber = new THREE.Color(C.reactor), wCyan = new THREE.Color(0xbff8ff), wAmber = new THREE.Color(0xffe1a0);
  const nodePos = specs.map(() => new THREE.Vector3());

  // dust around the core (ParticleField in JarvisCanvas)
  const dustN = 800, dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    const r = (3 + Math.random() * 5.5) * SCALE, th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1);
    dp.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * .4, r * Math.cos(ph)], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dustMat = new THREE.PointsMaterial({ color: C.primary, size: 2.4, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending });
  const dust = new THREE.Points(dustGeo, dustMat); scene.add(dust);

  // Arc Core: molten sphere + three rings that start as the reactor's outer ring
  const core = buildCore(); core.visible = false; scene.add(core);
  const coreLight = new THREE.PointLight(C.reactor, 0, 1400, 1.7); scene.add(coreLight);
  const torus = (r, tube, color, opacity) => new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 180), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  const rings = [
    { m: torus(1.55 * SCALE, 1.1, C.reactor, .75), rot: [Math.PI / 2.3, 0, 0], v: [.25, 0, 0] },
    { m: torus(1.85 * SCALE, .8, C.primary, .55), rot: [Math.PI / 3.1, Math.PI / 5, 0], v: [0, .18, 0] },
    { m: torus(2.1 * SCALE, .7, C.reactor, .45), rot: [0, Math.PI / 2.4, Math.PI / 6], v: [0, 0, .32] },
  ];
  rings.forEach((r) => { r.m.visible = false; scene.add(r.m); });
  const ringDeco = rings.map((r, i) => decorateRing(r.m, ['fine', 'bold', 'claw'][i], [C.hot, C.primary, C.reactor][i]));

  // module tunnel: triangular gates borrowed from the reactor segments
  const tunnel = new THREE.Group(); scene.add(tunnel); tunnel.visible = false;
  const gateMat = new THREE.MeshBasicMaterial({ color: C.primary, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const gateSoft = gateMat.clone(); gateSoft.opacity = .35;
  const triOutline = (r, w) => {
    const s = new THREE.Shape(), h = new THREE.Path();
    for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * 2.0944; const f = i ? 'lineTo' : 'moveTo'; s[f](Math.cos(a) * r, Math.sin(a) * r); h[f](Math.cos(a) * (r - w), Math.sin(a) * (r - w)); }
    s.closePath(); h.closePath(); s.holes.push(h);
    return new THREE.ShapeGeometry(s);
  };
  const gateCount = MODULES.length + 3, boards = [];
  const triGeo = triOutline(420, 7), triGeo2 = triOutline(392, 2.4);
  const ringGeo = new THREE.RingGeometry(508, 512, 128);
  for (let i = 0; i < gateCount; i++) {
    const z = TUNNEL.first - i * TUNNEL.step, g = new THREE.Group(); g.position.z = z; g.rotation.z = i * .36;
    g.add(new THREE.Mesh(triGeo, gateMat), new THREE.Mesh(triGeo2, gateSoft), new THREE.Mesh(ringGeo, gateSoft));
    tunnel.add(g);
  }
  const portal = new THREE.Mesh(new THREE.SphereGeometry(170, 40, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  portal.position.z = TUNNEL.end - 240; tunnel.add(portal);

  const boardTex = (name, sub, i) => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 400;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(0,190,210,.13)'; x.fillRect(0, 0, 1024, 400);
    x.strokeStyle = '#00e6f9'; x.lineWidth = 4; x.strokeRect(10, 10, 1004, 380);
    x.fillStyle = '#00e6f9'; [[10, 10], [974, 10], [10, 374], [974, 374]].forEach(([a, b]) => x.fillRect(a, b, 40, 16));
    x.font = '400 40px "Share Tech Mono","JetBrains Mono",monospace'; x.fillText(`MODULE // ${String(i + 1).padStart(2, '0')}`, 56, 92);
    x.fillStyle = '#e3f6f9'; x.font = '400 112px "Share Tech Mono","JetBrains Mono",monospace'; x.fillText(name.toUpperCase(), 54, 226);
    x.fillStyle = '#76c7cc'; x.font = '400 40px "JetBrains Mono",monospace'; x.fillText(sub, 56, 320);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };

  // post
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .42, .45, .5);
  composer.addPass(bloom); composer.addPass(new OutputPass());

  // ---- stops ----
  const stops = [], els = $$('[data-stop]');
  const arcDom = $('#arc'), flash = $('#flash'), grid = $('#grid'), engageUi = $('#engage-ui');
  const coords = { portrait: false };

  // where the camera must sit so 3D units land exactly on a DOM rect
  function fitCamera(rect, fov = 32, span = 200) {
    const h = innerHeight, tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const pxPerUnit = rect.width / span, d = h / (2 * tan * pxPerUnit);
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    return { d, x: -(cx - innerWidth / 2) / pxPerUnit, y: (cy - h / 2) / pxPerUnit };
  }

  function layout() {
    const w = innerWidth, h = innerHeight, asp = w / h, port = asp < 1;
    coords.portrait = port;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = asp; camera.updateProjectionMatrix();
    const far = clamp(1.65 / asp, 1, 2.4);
    coreCam.set(0, 2.7 * SCALE, 9.8 * SCALE).multiplyScalar(clamp(1.35 / asp, 1, 2.5));
    stops.length = 0;
    els.forEach((el) => {
      const r = el.getBoundingClientRect(), top = r.top + scrollY, span = Math.max(1, r.height - h), id = el.dataset.stop;
      const s = { id, a: top, b: top + span, x: 0, grid: 0, fog: [900, 2600], tun: 0, hull: 1, bloom: .42 };
      if (id === 'hero') {
        s.a = 0; s.grid = .55;
        s.look = port ? new THREE.Vector3(0, -40, 0) : new THREE.Vector3(-235, 10, 0);
        s.cam = new THREE.Vector3(port ? 230 : 300, 140, 860 * far);
      } else if (id === 'jarvis') {
        s.look = port ? new THREE.Vector3(0, -60, 0) : new THREE.Vector3(-110, 0, -20);
        s.cam = new THREE.Vector3(-230, 80, 430 * far);
      } else if (id.startsWith('a')) {
        const n = nodes[+id.slice(1)].userData.home, dir = n.clone().normalize(), side = (+id.slice(1) % 2 ? -1 : 1);
        s.look = n.clone().lerp(new THREE.Vector3(), .3); if (port) s.look.y -= 70;
        s.look.x += port ? 0 : side * 70;
        s.cam = n.clone().add(dir.clone().multiplyScalar(340 * far)).add(new THREE.Vector3(side * 170, 80, 120));
      } else if (id === 'modules') {
        s.look = new THREE.Vector3(0, 0, -1000);
        s.cam = new THREE.Vector3(0, 0, TUNNEL.start); s.tun = 1; s.fog = [240, 1250]; s.bloom = .45; s.hull = .4;
      } else if (id === 'engage') {
        const f = fitCamera($('#arc-home').getBoundingClientRect());
        // Lock against scroll offset: the engage panel is pinned, so its rect is measured at the end of the page.
        s.fit = f; s.grid = 1; s.hull = 0; s.bloom = .26; s.tun = 0; s.b = Infinity;
        s.look = new THREE.Vector3(f.x, f.y, 0); s.cam = new THREE.Vector3(f.x, f.y, f.d);
      }
      stops.push(s);
    });
    // agent boards are placed per viewport: narrow screens get them closer to the axis
    placeBoards(port);
    fitHomes();
  }

  let boardsBuilt = false;
  function placeBoards(port) {
    if (!boardsBuilt) {
      boardsBuilt = true;
      MODULES.forEach(([n, s], i) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, .39), new THREE.MeshBasicMaterial({ map: boardTex(n, s, i), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        tunnel.add(m); boards.push(m);
      });
    }
    boards.forEach((m, i) => {
      const side = i % 2 ? 1 : -1, z = TUNNEL.first - 60 - (i + 1) * TUNNEL.step;
      const w = port ? 120 : 250;
      m.scale.set(w, w, 1);
      m.position.set(side * (port ? 74 : 190), (i % 3 - 1) * (port ? 34 : 56), z);
      m.rotation.y = -side * .34;
    });
  }

  function fitHomes() {
    // Keep the 2D reactor exactly on its placeholder for the current screen.
    if (state.mode !== 'scroll') return;
    const t = $('#arc-home');
    const r = t.getBoundingClientRect();
    if (r.width) { arcDom.style.left = r.left + 'px'; arcDom.style.top = r.top + 'px'; arcDom.style.width = r.width + 'px'; }
  }

  function at(y) {
    let i = 0;
    while (i < stops.length - 1 && y > stops[i].b) i++;
    const S = stops[i];
    if (y >= S.a || i === 0) return { A: S, B: S, t: 0, raw: S.b === Infinity ? 1 : clamp((y - S.a) / (S.b - S.a)) };
    const P = stops[i - 1];
    return { A: P, B: S, t: clamp((y - P.b) / (S.a - P.b)), raw: 0 };
  }

  // ---- app state: scroll -> login -> ignite -> core ----
  const state = { mode: 'scroll', ig: 0, igStart: 0 };
  const parts = R.parts;
  let time = 0, spinT = 0, energy = 0, energyBase = 0, shake = 0, last = performance.now(), sy = scrollY, frames = 0, slow = 0;
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { ptr.x = e.clientX / innerWidth * 2 - 1; ptr.y = e.clientY / innerHeight * 2 - 1; } }, { passive: true });
  const cam = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3();
  const igFrom = { cam: new THREE.Vector3(), look: new THREE.Vector3() };
  const coreCam = new THREE.Vector3(0, 2.7 * SCALE, 9.8 * SCALE), coreLook = new THREE.Vector3();
  const colA = new THREE.Color(C.primary), colB = new THREE.Color(C.reactor), colTmp = new THREE.Color(), colR = new THREE.Color(0xff4a3a);
  let controls = null;

  const labels = [{ el: $('#l-core'), pos: () => tmp.set(0, -1.32 * SCALE, 0) }, ...nodes.map((n, i) => ({ el: $(`#l-a${i}`), node: n }))];
  const v = new THREE.Vector3();
  AGENTS.forEach((a, i) => { const e = $(`#l-a${i}`), busy = STATUS[i] === 'busy'; e.insertAdjacentHTML('beforeend', `<small class="st${busy ? ' busy' : ''}">● ${busy ? 'BUSY 00:' + String(14 + i * 9).padStart(2, '0') : 'IDLE'}</small>`); });
  const mobileLabels = innerWidth < 760;
  function placeLabels(show, radial = false) {
    v.set(0, 0, 0).project(camera); const cx = (v.x * .5 + .5) * innerWidth, cy = (-v.y * .5 + .5) * innerHeight;
    labels.forEach((l) => {
      if (l.node) { v.copy(l.node.position); if (!radial) v.y -= .62 * SCALE; } else v.set(0, -1.32 * SCALE, 0);
      v.project(camera);
      const vis = show > .01 && v.z < 1;
      l.el.style.opacity = vis ? show : 0;
      if (!vis) return;
      let sx = (v.x * .5 + .5) * innerWidth, sy = (-v.y * .5 + .5) * innerHeight;
      let ax = '-50%';
      if (radial && !mobileLabels && l.node) {
        // labels sit beside their node, on the side facing away from the core, so they never cover the node or the core
        const dx = sx - cx, dy = sy - cy, d = Math.hypot(dx, dy) || 1, side = Math.abs(dx) > 40 ? Math.sign(dx) : 0, off = mobileLabels ? 30 : 46;
        sx += side * off + dx / d * 10; sy += side ? dy / d * 8 : (dy > 0 ? 40 : -40);
        ax = side > 0 ? '0%' : side < 0 ? '-100%' : '-50%';
        l.el.style.textAlign = side > 0 ? 'left' : side < 0 ? 'right' : 'center';
      }
      l.el.style.transform = `translate(${ax},-50%) translate(${sx}px,${sy}px)`;
    });
  }

  function applyReactor(a, hullVis, fade = 1) {
    parts.forEach((p) => {
      const o = p.obj, off = 1 - a;
      o.position.z = p.z * off;
      o.scale.z = lerp(p.depth, 1, a);
      o.rotation.x = p.tilt * off;
      o.rotation.z = p.spin * off * (reduce ? 4 : spinT * 2 + 4);
    });
    const wall = lerp(.3, 1, a * a);
    R.mats.line.opacity = fade * wall; R.mats.lineSoft.opacity = .6 * fade * wall; R.mats.lineFaint.opacity = .42 * fade * lerp(.5, 1, a);
    R.disc.material.opacity = fade * lerp(.14, 1, a); R.d14.material.opacity = fade; R.d6.material.opacity = fade;
    R.hull.visible = hullVis > .005;
    R.steel.opacity = hullVis; R.edgeMat.opacity = .75 * hullVis; R.fill.intensity = 90000 * hullVis;
    R.gyro.forEach((g) => {
      g.rotation.set(g.userData.rx + spinT * g.userData.s * .6, g.userData.ry, spinT * g.userData.s);
      g.children.forEach((c) => (c.visible = hullVis > .05));
    });
  }

  function frame(now) {
    if (!shot) requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now; time += reduce ? 0 : dt;
    ptr.sx = lerp(ptr.sx, ptr.x, 1 - Math.exp(-dt * 4)); ptr.sy = lerp(ptr.sy, ptr.y, 1 - Math.exp(-dt * 4));
    energy *= Math.exp(-dt * 2.2); if (shake > 0) shake = Math.max(0, shake - dt / .45);
    const boost = state.mode === 'ignite' ? 4 * Math.sin(Math.PI * clamp(state.ig * 1.6)) : clamp(energy + energyBase) * 5;
    spinT += reduce ? 0 : dt * (1 + boost);
    if (!reduce && !shot) { if (dt > .04) slow++; if (++frames === 90) { if (slow > 55 && dpr > 1) { dpr = 1; renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight, false); composer.setPixelRatio(1); composer.setSize(innerWidth, innerHeight); } frames = slow = 0; } }
    if (state.mode === 'scroll') scrollFrame(dt); else if (state.mode === 'login') loginFrame(dt); else igniteFrame(dt);
    composer.render(dt);
  }

  function scrollFrame(dt) {
    sy = reduce || shot || jump ? scrollY : lerp(sy, scrollY, 1 - Math.exp(-dt * 6)); // a jump is already eased
    if (Math.abs(sy - scrollY) < .3) sy = scrollY;
    const { A, B, t, raw } = at(sy);
    const e = ease(t);
    let align = 0, fl = 0, tunVis = lerp(A.tun, B.tun, t > .5 ? 1 : 0), showArc = true;
    camera.fov = 32;

    if (A === B && A.id === 'modules') {
      const z = lerp(TUNNEL.start, TUNNEL.end, raw);
      cam.set(Math.sin(raw * 9) * 14, Math.cos(raw * 7) * 10, z); look.set(0, 0, z - 500);
      tunVis = 1;
    } else if (A.id === 'modules' && B.id === 'engage') {
      // match cut on white: the end of the tunnel is the white centre of the reactor
      const out = seg(t, 0, .28), back = seg(t, .28, 1);
      fl = out < 1 ? ease(out) : 1 - seg(t, .28, .32);
      if (out < 1) { cam.set(0, 0, lerp(TUNNEL.end, TUNNEL.end - 90, out)); look.set(0, 0, cam.z - 500); }
      else {
        const k = back * back * (3 - 2 * back);
        align = 1;
        cam.set(B.cam.x * k, B.cam.y * k, lerp(12, B.cam.z, k)); look.set(B.look.x * k, B.look.y * k, 0);
        tunVis = 0;
      }
    } else {
      cam.lerpVectors(A.cam, B.cam, e); look.lerpVectors(A.look, B.look, e);
      if (A.id === 'engage') align = 1;
    }
    if (B.id === 'engage' && A === B) align = 1;
    camera.position.copy(cam); camera.updateProjectionMatrix(); camera.lookAt(look);

    const hull = align ? 0 : lerp(A.hull, B.hull, e);
    applyReactor(align, hull);
    R.root.visible = showArc && cam.z > -700;

    tunnel.visible = tunVis > 0;
    gateMat.opacity = .9; scene.fog.near = tunVis ? 240 : 900; scene.fog.far = tunVis ? 1250 : 2600;
    if (tunVis) {
      const idx = clamp(Math.floor((TUNNEL.first - 60 - TUNNEL.step - cam.z + 400) / TUNNEL.step + .5), -1, MODULES.length - 1);
      $('#mod-now').textContent = idx >= 0 ? MODULES[idx][0] : 'Wejście do rdzenia';
      $('#mod-count').textContent = `${String(Math.max(0, idx + 1)).padStart(2, '0')} / ${MODULES.length}`;
      gates(dt);
      boards.forEach((m) => { const d = cam.z - m.position.z; m.material.opacity = seg(d, 780, 420) * seg(d, 30, 150); m.visible = m.material.opacity > .01; });
      const pr = seg(cam.z, -1900, TUNNEL.end); portal.scale.setScalar(lerp(.12, 1, pr * pr));
    }
    bloom.strength = align ? lerp(.4, B.bloom ?? .26, seg(t, .28, .6)) * (A === B ? 1 : 1) : lerp(A.bloom, B.bloom, e);
    if (A === B && A.id === 'engage') bloom.strength = .26;

    const nodesVis = cam.z > -500 && !align;
    nodes.forEach((n, i) => { n.visible = nodesVis; spokes[i].visible = nodesVis; n.userData.body.rotation.x += dt * .15; n.userData.body.rotation.y += dt * .1; });
    dust.visible = !align; dust.rotation.y += reduce ? 0 : dt * .01;

    flash.style.opacity = fl;
    grid.style.opacity = A === B ? A.grid : lerp(A.grid, B.grid, B.id === 'engage' ? seg(t, .5, 1) : e);
    const engaged = B.id === 'engage' ? (A === B ? 1 : seg(t, .85, 1)) : 0;
    engageUi.style.opacity = engaged; engageUi.classList.toggle('live', engaged > .95);
    arcDom.style.opacity = engaged;
    $('#hud-mod').style.opacity = tunVis && A === B ? 1 : 0;
    root.style.setProperty('--scan', Math.round(clamp(sy / Math.max(1, document.documentElement.scrollHeight - innerHeight)) * 100));
    $('#scan').textContent = `SYSTEM SCAN ${String(Math.round(clamp(sy / Math.max(1, document.documentElement.scrollHeight - innerHeight)) * 100)).padStart(3, '0')}%`;
    placeLabels(0);
  }

  function gates(dt) {
    if (reduce) return;
    tunnel.children.forEach((g, i) => { if (i < gateCount) g.rotation.z += dt * (i % 2 ? .12 : -.12); });
  }

  // 3D login: the reactor stays in the scene, parked on the left; hull and gyro rings appear, the scene reacts to typing
  function loginFrame(dt) {
    const lg = state.lg = shot || reduce ? 1 : clamp((performance.now() - state.lgStart) / 1100), k = ease(lg), E = clamp(energy + energyBase);
    cam.set(lerp(lgFrom.cam.x, lgPose.x, k), lerp(lgFrom.cam.y, lgPose.y, k), lerp(lgFrom.cam.z, lgPose.d, k));
    look.set(lerp(lgFrom.look.x, lgPose.x, k), lerp(lgFrom.look.y, lgPose.y, k), 0);
    if (!reduce) { cam.x += ptr.sx * 22 * k; cam.y -= ptr.sy * 14 * k; }
    camera.position.copy(cam); camera.fov = 32; camera.updateProjectionMatrix(); camera.lookAt(look);
    applyReactor(lerp(1, .5, k), .6 * ease(seg(lg, .15, 1)) * (1 + E * .25), 1);
    colTmp.copy(colA);
    if (shake > 0) { const q = shake * shake; colTmp.lerp(colR, clamp(shake * 1.8) * .95); R.root.position.x = Math.sin(time * 70) * 5 * q; R.root.rotation.z = Math.sin(time * 53) * .035 * q; }
    else { R.root.position.x = 0; R.root.rotation.z = 0; }
    R.mats.line.color.copy(colTmp); R.mats.lineSoft.color.copy(colTmp); R.mats.lineFaint.color.copy(colTmp);
    R.root.visible = true; R.d14.scale.setScalar(1 + E * .1);
    nodes.forEach((n, i) => { n.visible = false; spokes[i].visible = false; });
    core.visible = false; coreLight.intensity = 0; rings.forEach((r) => (r.m.visible = false)); X.group.visible = false; pk.points.visible = false;
    tunnel.visible = false; scene.fog.near = 1500; scene.fog.far = 3400;
    dust.visible = true; dustMat.opacity = .3; dust.rotation.y += reduce ? 0 : dt * .01;
    bloom.strength = .3 + E * .08 - (shake > 0 ? .06 : 0); bloom.threshold = .5; bloom.radius = .45;
    grid.style.opacity = .55;
    placeLabels(0);
  }

  function igniteFrame(dt) {
    if (state.mode === 'ignite' && !shot) { state.ig = clamp((performance.now() - state.igStart) / (reduce ? 1 : 2600)); }
    const p = state.ig;
    if (state.mode === 'ignite' && p >= 1 && !shot) enterCore();

    // the login reactor comes back as geometry, then comes apart
    const a = .5 * (1 - ease(seg(p, .05, .5)));
    const fade = 1 - seg(p, .16, .5);
    applyReactor(a, .6 * (1 - ease(seg(p, 0, .25))), fade);
    colTmp.copy(colA).lerp(colB, seg(p, .08, .3));
    R.mats.line.color.copy(colTmp); R.mats.lineSoft.color.copy(colTmp); R.mats.lineFaint.color.copy(colTmp);
    R.root.visible = fade > 0;
    R.root.rotation.y = 0;

    const k = ease(seg(p, .1, .85));
    if (!controls) {
      camera.position.lerpVectors(igFrom.cam, coreCam, k);
      look.lerpVectors(igFrom.look, coreLook, k);
      camera.fov = lerp(32, 45, k); camera.updateProjectionMatrix(); camera.lookAt(look);
    } else { controls.update(); }

    // Arc Core
    const g = ease(seg(p, .12, .5));
    core.visible = g > 0;
    core.scale.setScalar(lerp(.9, 1, g) * (1 + Math.sin(time * 1.4) * .03));
    core.rotation.y += dt * .15;
    core.material.uniforms.t.value = time; core.material.uniforms.heat.value = seg(p, .1, .32); core.material.uniforms.op.value = g;
    coreLight.intensity = 70000 * g;

    const u = ease(seg(p, .2, .78));
    rings.forEach((r) => {
      r.m.visible = u > 0;
      const s = lerp(96 / r.m.geometry.parameters.radius, 1, u);
      r.m.scale.set(s, s, s);
      r.spin = (r.spin || [0, 0, 0]);
      if (!reduce) r.v.forEach((w, i) => (r.spin[i] += w * dt));
      r.m.rotation.set(lerp(0, r.rot[0], u) + r.spin[0], lerp(0, r.rot[1], u) + r.spin[1], lerp(0, r.rot[2], u) + r.spin[2]);
    });

    const stK = ease(seg(p, .62, .9)), vis2 = seg(p, .5, .9);
    nodes.forEach((n, i) => {
      const q = ease(seg(p, .34 + i * .04, .78 + i * .03)), busy = STATUS[i] === 'busy';
      n.visible = spokes[i].visible = q > 0;
      orbitAt(specs[i], specs[i].a0 + (reduce ? 0 : specs[i].w * time), nodePos[i]);
      n.position.copy(nodePos[i]).multiplyScalar(q);
      n.scale.setScalar((.2 + q * .8) * .8 * (busy && stK > .5 ? 1 + Math.sin(time * 5 + i) * .07 : 1));
      n.userData.body.rotation.x += dt * (busy ? .5 : .15); n.userData.body.rotation.y += dt * (busy ? .35 : .1);
      const mt = n.userData.body.material, wm = n.userData.body.children[0].material, sm = spokes[i].material;
      mt.color.copy(cCyan); mt.emissive.copy(cCyan); wm.color.copy(wCyan); sm.color.set(0x0aa6b8); sm.opacity = .4;
      if (busy) { mt.color.lerp(cAmber, stK); mt.emissive.lerp(cAmber, stK); wm.color.lerp(wAmber, stK); sm.color.lerp(cAmber, stK); sm.opacity = .4 + .35 * stK; mt.emissiveIntensity = .3 + .5 * stK; }
      const pos = spokes[i].geometry.attributes.position; pos.setXYZ(1, n.position.x, n.position.y, n.position.z); pos.needsUpdate = true;
    });
    const pulse = 1 + Math.sin(time * 1.4) * .03;
    X.group.visible = p > .1;
    X.corona.material.opacity = .55 * ease(seg(p, .25, .65)) * (1 + Math.sin(time * 1.4) * .08); X.corona.scale.setScalar(5.6 * SCALE * pulse);
    X.shell.material.opacity = .17 * seg(p, .3, .7); if (!reduce) { X.shell.rotation.y -= dt * .09; X.shell.rotation.x += dt * .05; }
    X.floor.material.opacity = .15 * vis2; X.orbits.forEach((o) => (o.material.opacity = .22 * vis2));
    ringDeco.forEach((d, i) => { d.inst.material.opacity = .85 * ease(seg(p, .3, .8)); d.bead.visible = p > .45; const ang = time * (i % 2 ? -.9 : .7) + i * 2; d.bead.position.set(Math.cos(ang) * d.r, Math.sin(ang) * d.r, 0); });
    pk.update(nodes, STATUS, reduce ? 0 : time, p > .7 ? vis2 : 0);
    dust.visible = true; dustMat.opacity = .55 * seg(p, .4, .9); dust.rotation.y += reduce ? 0 : dt * .01;
    tunnel.visible = false; scene.fog.near = 1500; scene.fog.far = 3200;
    bloom.strength = lerp(.26, .62, ease(seg(p, .08, .35))); bloom.threshold = lerp(.5, .55, p); bloom.radius = .55;
    grid.style.opacity = 1 - seg(p, .1, .5);
    placeLabels(seg(p, .72, .95), true);
  }

  function enterCore() {
    state.mode = 'core'; state.ig = 1;
    if (reduce) { camera.position.copy(coreCam); camera.fov = 45; camera.updateProjectionMatrix(); }
    root.classList.add('core');
    controls = new OrbitControls(camera, $('#core-hit'));
    controls.enablePan = false; controls.minDistance = 5 * SCALE; controls.maxDistance = Math.max(14 * SCALE, coreCam.length() * 1.2);
    controls.autoRotate = !reduce; controls.autoRotateSpeed = .35; controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 1.6; controls.minPolarAngle = Math.PI / 4;
    controls.target.copy(coreLook);
  }

  // ---- buttons ----
  // Button jumps run on their own clock. Native smooth scrolling crosses the
  // whole ~15 000 px story in about a second, too fast to read and it stutters.
  const JUMP_PX_PER_MS = 5.5, JUMP_MIN_MS = 900, JUMP_MAX_MS = 3000;
  const jumpMs = (px) => clamp(Math.abs(px) / JUMP_PX_PER_MS, JUMP_MIN_MS, JUMP_MAX_MS);
  const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  let jump = null;
  const stopJump = () => { if (jump) { cancelAnimationFrame(jump.raf); jump = null; } };
  ['wheel', 'touchstart', 'keydown'].forEach((ev) => addEventListener(ev, stopJump, { passive: true }));
  function jumpTo(top) {
    stopJump();
    if (reduce) { scrollTo(0, top); return; }
    const from = scrollY, dist = top - from, ms = jumpMs(dist), t0 = performance.now();
    const step = (now) => {
      const k = clamp((now - t0) / ms);
      scrollTo(0, from + dist * easeInOut(k));
      if (k < 1 && jump) jump.raf = requestAnimationFrame(step); else jump = null;
    };
    jump = { raf: requestAnimationFrame(step) };
  }
  const stopTop = (id) => stops.find((o) => o.id === id).a + 2;
  $$('[data-go=engage]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); jumpTo(stopTop('engage')); }));
  $('#go').addEventListener('click', (e) => { e.preventDefault(); jumpTo(stopTop('jarvis')); });

  const lgFrom = { cam: new THREE.Vector3(), look: new THREE.Vector3() }, lgPose = { x: 0, y: 0, d: 900 };
  function calcLoginPose() { const r = $('#login-slot').getBoundingClientRect(); if (r.width) { const f = fitCamera(r, 32, 380); lgPose.x = f.x; lgPose.y = f.y; lgPose.d = f.d; } }
  $('#engage-btn').addEventListener('click', () => {
    if (state.mode !== 'scroll') return;
    stopJump();
    lgFrom.cam.copy(camera.position); lgFrom.look.copy(look);
    state.mode = 'login'; state.lgStart = performance.now(); state.lg = 0;
    root.classList.add('login');
    engageUi.classList.remove('live');
    calcLoginPose();
    setTimeout(() => $('#key').focus({ preventScroll: true }), 600);
  });

  const form = $('#login-form'), lmsg = $('#lmsg');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.mode !== 'login') return;
    const pw = $('#key').value;
    if (!pw || pw === 'zle') {
      shake = 1; energy = 1; lmsg.textContent = 'Odmowa dostępu. Sprawdź klucz.';
      form.classList.remove('err'); void form.offsetWidth; form.classList.add('err'); $('#key').focus(); return;
    }
    lmsg.textContent = ''; form.classList.remove('err');
    state.mode = 'ignite'; state.igStart = performance.now(); state.ig = 0;
    igFrom.cam.copy(camera.position); igFrom.look.copy(look);
    root.classList.add('leaving');
    sound();
  });
  form.addEventListener('input', () => { energy = Math.min(1, energy + .3); });
  form.addEventListener('keydown', () => { energy = Math.min(1, energy + .22); });
  form.addEventListener('focusin', () => { energyBase = .3; }); form.addEventListener('focusout', () => { energyBase = 0; });

  function resetAll() {
    stopJump(); state.mode = 'scroll'; state.ig = 0;
    root.classList.remove('login', 'leaving', 'core');
    if (controls) { controls.dispose(); controls = null; }
    core.visible = false; coreLight.intensity = 0; rings.forEach((r) => { r.m.visible = false; r.spin = null; });
    [R.mats.line, R.mats.lineSoft, R.mats.lineFaint].forEach((m) => m.color.copy(colA));
    nodes.forEach((n, i) => { n.position.copy(n.userData.home); n.scale.setScalar(1); const pos = spokes[i].geometry.attributes.position; pos.setXYZ(1, n.position.x, n.position.y, n.position.z); pos.needsUpdate = true; });
    dustMat.opacity = .55; bloom.threshold = .5; bloom.radius = .45;
    X.group.visible = false; pk.points.visible = false; shake = 0; energy = 0; R.root.position.x = 0; R.root.rotation.z = 0;
    ringDeco.forEach((d) => { d.inst.material.opacity = 0; d.bead.visible = false; });
    nodes.forEach((n, i) => { const mt = n.userData.body.material; mt.color.copy(cCyan); mt.emissive.copy(cCyan); mt.emissiveIntensity = .3; n.userData.body.children[0].material.color.copy(wCyan); spokes[i].material.color.set(0x0aa6b8); spokes[i].material.opacity = .45; });
    $('#lmsg').textContent = '';
    scrollTo({ top: 0, behavior: 'auto' }); sy = 0; fitHomes();
  }
  $('#replay').addEventListener('click', resetAll);

  // a short rising tone on access granted, started by the click itself
  function sound() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)(), t = ac.currentTime, g = ac.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + .25); g.gain.exponentialRampToValueAtTime(.0001, t + 2.6);
      g.connect(ac.destination);
      [55, 110.5, 220].forEach((f, i) => { const o = ac.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2.02, t + 1.3); o.connect(g); o.start(t); o.stop(t + 2.7); });
    } catch (e) { /* no audio: visuals carry on */ }
  }

  layout();
  addEventListener('resize', () => { layout(); if (state.mode === 'login') calcLoginPose(); else fitHomes(); });
  new ResizeObserver(() => layout()).observe(document.body);
  document.fonts.ready.then(() => { boards.forEach((m, i) => { m.material.map = boardTex(MODULES[i][0], MODULES[i][1], i); m.material.needsUpdate = true; }); layout(); });
  root.classList.add('ready');
  window.__jv = { stops, frame: () => frame(performance.now()), setIg: (p) => { state.ig = p; }, state, enterCore, calcLoginPose, setEnergy: (e) => { energy = e; }, setShake: (v) => { shake = v; } };
  requestAnimationFrame(frame);
}

function wireFallback() {
  $('#engage-btn').addEventListener('click', () => { root.classList.add('login'); });
  $('#login-form').addEventListener('submit', (e) => { e.preventDefault(); root.classList.add('leaving', 'core'); });
  $('#replay').addEventListener('click', () => { root.classList.remove('login', 'leaving', 'core'); scrollTo(0, 0); });
}

start();
