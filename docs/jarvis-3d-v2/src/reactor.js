import * as THREE from 'three';

// Colours are the app's tokens (src/styles.css) resolved to sRGB, because
// three.js cannot read CSS variables.
export const C = { primary: 0x00e6f9, accent: 0x73bdff, reactor: 0xffad00, hot: 0xffcd42, void: 0x000000, base: 0x030a13 };

const P = (x, y) => new THREE.Vector2(x - 100, 100 - y); // SVG viewBox 200 -> world, same units

const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

function ringMesh(r, w, mat, seg = 160) {
  const s = new THREE.Shape(); s.absarc(0, 0, r + w / 2, 0, Math.PI * 2, false);
  const h = new THREE.Path(); h.absarc(0, 0, r - w / 2, 0, Math.PI * 2, true); s.holes.push(h);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: seg });
  g.translate(0, 0, -.5);
  return new THREE.Mesh(g, mat);
}
function strip(a, b, w, mat) {
  const len = a.distanceTo(b) + w * .9;
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, w, 1), mat);
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
  m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
  return m;
}
function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(256, 256, 0, 256, 256, 256);
  // same stops as the #arc-core gradient in ArcReactorTriangle
  g.addColorStop(0, '#e6fdff'); g.addColorStop(.35, 'rgba(0,230,249,.95)');
  g.addColorStop(.7, 'rgba(0,120,132,.5)'); g.addColorStop(1, 'rgba(0,50,56,0)');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildReactor() {
  const root = new THREE.Group();
  const line = glow(C.primary, 1), lineSoft = glow(C.primary, .6), lineFaint = glow(C.primary, .42);
  const parts = [];
  const add = (obj, o) => { root.add(obj); parts.push({ obj, spin: 0, tilt: 0, z: 0, depth: 1, base: 0, ...o }); return obj; };

  // outer r96, dashed r82: the two guide rings of the SVG
  add(ringMesh(96, .7, lineFaint), { z: 70, depth: 16, tilt: .42, spin: .05 });
  const dashes = new THREE.Group();
  const dashGeo = new THREE.BoxGeometry(3.2, .7, 1);
  for (let i = 0; i < 74; i++) {
    const a = i / 74 * Math.PI * 2, m = new THREE.Mesh(dashGeo, lineSoft);
    m.position.set(Math.cos(a) * 82, Math.sin(a) * 82, 0); m.rotation.z = a + Math.PI / 2; dashes.add(m);
  }
  add(dashes, { z: 24, depth: 12, tilt: -.34, spin: -.09 });

  // core gradient disc r68
  const disc = new THREE.Mesh(new THREE.CircleGeometry(68, 96), new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  add(disc, { z: -90 });

  // the three triangular segments, each a hollow prism when pulled apart
  const tri = new THREE.Group();
  [0, 120, 240].forEach((rot) => {
    const g = new THREE.Group(); g.rotation.z = -THREE.MathUtils.degToRad(rot);
    const A = P(100, 46), B = P(130, 98), D = P(70, 98);
    [[A, B], [B, D], [D, A]].forEach(([a, b]) => g.add(strip(a, b, 1.7, line)));
    const a2 = P(100, 58), b2 = P(122, 96), d2 = P(78, 96);
    [[a2, b2], [b2, d2], [d2, a2]].forEach(([a, b]) => g.add(strip(a, b, 1.7, lineSoft)));
    g.add(strip(P(100, 46), P(100, 30), 1.7, line));
    tri.add(g);
  });
  add(tri, { z: -18, depth: 64, spin: .14 });

  const d14 = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshBasicMaterial({ color: 0xe6fdff, transparent: true, depthWrite: false }));
  const d6 = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
  add(d14, { z: 4 }); add(d6, { z: 8 });

  // Hull: exists only while the reactor is pulled apart. Fades out completely
  // before the front-on match with the 2D login reactor.
  const hull = new THREE.Group(); root.add(hull);
  const steel = new THREE.MeshStandardMaterial({ color: 0x0c1b2a, metalness: .85, roughness: .38, transparent: true });
  const edgeMat = new THREE.LineBasicMaterial({ color: C.primary, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 12; i++) {
    const a0 = i / 12 * Math.PI * 2 + .03, a1 = (i + 1) / 12 * Math.PI * 2 - .03;
    const s = new THREE.Shape(); s.absarc(0, 0, 134, a0, a1, false); s.absarc(0, 0, 106, a1, a0, true);
    const g = new THREE.ExtrudeGeometry(s, { depth: 34 + (i % 3) * 12, bevelEnabled: false, curveSegments: 14 });
    g.translate(0, 0, -30);
    const m = new THREE.Mesh(g, steel); hull.add(m);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 24), edgeMat));
  }
  const gyro = [];
  [[166, .9, '40 12'], [196, .7, '4 18'], [228, .6, '10 26']].forEach(([r, w], i) => {
    const g = new THREE.Group();
    g.add(ringMesh(r, w, i === 1 ? lineFaint : lineSoft, 200));
    const seg = i === 0 ? 14 : i === 1 ? 48 : 24;
    const tick = new THREE.BoxGeometry(i === 0 ? 34 : i === 1 ? 2 : 10, 3, 2);
    for (let k = 0; k < seg; k++) {
      const a = k / seg * Math.PI * 2, m = new THREE.Mesh(tick, lineSoft);
      m.position.set(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6), 0); m.rotation.z = a + Math.PI / 2; g.add(m);
    }
    g.userData = { rx: [.5, -.8, 1.1][i], ry: [.3, .5, -.4][i], s: [.11, -.08, .05][i] };
    hull.add(g); gyro.push(g);
  });
  const fill = new THREE.PointLight(C.primary, 90000, 900, 1.8); fill.position.set(0, 0, 60); hull.add(fill);

  return { root, parts, hull, gyro, steel, edgeMat, mats: { line, lineSoft, lineFaint }, disc, d14, d6, fill };
}

// Same layout as JarvisCanvas: satellites on a horizontal ring around the core.
export const WORLD = 100; // 1 app unit = 100 world units
export const SCALE = .72 * WORLD;

export function orbitPosition(i, n) {
  const radius = (n <= 4 ? 2.6 : n <= 6 ? 3.0 : 3.4) * SCALE;
  const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
  return new THREE.Vector3(Math.cos(angle) * radius, (i % 2 === 0 ? 1 : -1) * .35 * SCALE, Math.sin(angle) * radius);
}

export function buildNode() {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(.38 * SCALE, 0);
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: C.primary, emissive: C.primary, emissiveIntensity: .3, metalness: .4, roughness: .35, flatShading: true, transparent: true, opacity: .55 }));
  const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xbff8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  body.add(wire); g.add(body);
  g.userData.body = body;
  return g;
}

// Molten core: the look of drei's MeshDistortMaterial in Core3D, as a small shader.
const NOISE = /* glsl */`
vec3 m289(vec3 x){return x-floor(x*(1./289.))*289.;}vec4 m289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return m289(((x*34.)+1.)*x);}vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
i=m289(i);vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);vec4 norm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}`;

export function buildCore() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { t: { value: 0 }, heat: { value: 0 }, op: { value: 1 }, cold: { value: new THREE.Color(C.primary) }, amber: { value: new THREE.Color(C.reactor) }, hot: { value: new THREE.Color(C.hot) } },
    vertexShader: NOISE + /* glsl */`
      uniform float t; varying vec3 vN; varying vec3 vV; varying float vD;
      void main(){ vec3 n=normalize(position); float d=snoise(n*1.6+vec3(0.,t*.55,t*.3)); vD=d;
        vec3 p=position+normal*d*.35*${SCALE.toFixed(1)}*.32;
        vec4 mv=modelViewMatrix*vec4(p,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform float heat,op; uniform vec3 cold,amber,hot; varying vec3 vN; varying vec3 vV; varying float vD;
      void main(){ float f=pow(1.-max(dot(vN,vV),0.),2.2); vec3 c=mix(amber*.34,amber*.95,smoothstep(-.45,.25,vD)); c=mix(c,hot*1.1,smoothstep(.25,.75,vD)); c=mix(c,hot*1.15,f*.8);
        c=mix(cold*1.1,c,heat); gl_FragColor=vec4(c,op); }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(SCALE, 128, 96), mat);
}
