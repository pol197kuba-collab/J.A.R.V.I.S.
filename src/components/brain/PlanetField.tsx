// Mózg 3D — tryb STRUKTURA: proceduralne planety.
//
// Trzy InstancedMesh (po jednym wywołaniu rysowania): powierzchnia,
// poświata atmosfery (powłoka od tyłu, addytywnie) i pierścienie. Wygląd
// każdej planety liczy shader z szumu 3D — skalista z kraterami, gazowy
// olbrzym z pasami i burzą, lodowa ze spękaniami, wulkaniczna ze
// świecącą lawą, ziemiopodobna z oceanami, chmurami i światłami miast.
// Światło pada ze słońca w środku mapy. Poświata ma kolor modułu (token
// motywu) — jedyna informacja o module na samej planecie.

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SCENE_SCALE } from "@/lib/brain/scene";
import { planetRadius, type ModuleId } from "@/lib/brain/structure";
import { PLANET_KIND_INDEX, type PlanetLook } from "@/lib/brain/planets";
import { NOISE_GLSL } from "./glsl";

export type PlanetNode = { module: ModuleId; rows: number; x: number; y: number; z: number };

/** Promień powłoki atmosfery względem planety (cienka — inaczej „bańka mydlana”). */
const ATMOSPHERE = 1.12;
/** Pierścienie: od/do w promieniach planety (geometria w tych jednostkach). */
const RING_INNER = 1.4;
const RING_OUTER = 2.35;
/** Przygaszenie planet spoza wyników wyszukiwania. */
const DIMMED = 0.22;

const PLANET_VERTEX = /* glsl */ `
  attribute vec3 aColA;
  attribute vec3 aColB;
  attribute vec3 aColC;
  attribute vec3 aRim;
  attribute vec2 aKindSeed;
  attribute float aDim;
  varying vec3 vObj;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColA;
  varying vec3 vColB;
  varying vec3 vColC;
  varying vec3 vRim;
  varying vec2 vKindSeed;
  varying float vDim;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 w = m * vec4(position, 1.0);
    vObj = position;
    vWorld = w.xyz;
    vNormal = normalize(mat3(m) * normal);
    vColA = aColA;
    vColB = aColB;
    vColC = aColC;
    vRim = aRim;
    vKindSeed = aKindSeed;
    vDim = aDim;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const PLANET_FRAGMENT = /* glsl */ `
  ${NOISE_GLSL}
  uniform float uTime;
  uniform vec3 uSun;
  varying vec3 vObj;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColA;
  varying vec3 vColB;
  varying vec3 vColC;
  varying vec3 vRim;
  varying vec2 vKindSeed;
  varying float vDim;

  float craterField(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float res = 0.0;
    for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
    for (int z = -1; z <= 1; z++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = hash3(i + g);
      if (o.z < 0.45) continue;
      float d = length(g + o - f);
      float rad = 0.2 + 0.22 * o.x;
      float bowl = smoothstep(rad, rad * 0.6, d);
      float rim = smoothstep(rad * 0.7, rad, d) * smoothstep(rad * 1.3, rad, d);
      res += rim * 0.55 - bowl * 0.5;
    }
    return res;
  }

  void main() {
    int kind = int(vKindSeed.x + 0.5);
    float seed = vKindSeed.y;
    vec3 q = normalize(vObj);
    // Powolny obrót wokół własnej osi, każda planeta we własnym tempie.
    float ang = uTime * (0.03 + 0.05 * seed);
    float ca = cos(ang);
    float sa = sin(ang);
    vec3 p = vec3(ca * q.x - sa * q.z, q.y, sa * q.x + ca * q.z);
    vec3 ps = p + vec3(seed * 31.0, seed * 17.0, seed * 23.0);

    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSun - vWorld);
    float ndl = dot(N, L);
    float lit = smoothstep(-0.12, 0.25, ndl) * (0.35 + 0.65 * max(ndl, 0.0));

    vec3 albedo = vColA;
    vec3 emissive = vec3(0.0);
    float spec = 0.0;

    if (kind == 0) {
      // Skalista: równiny i wyżyny + kratery w dwóch skalach.
      float h = fbm(ps * 2.2);
      albedo = mix(vColB, vColA, smoothstep(-0.35, 0.35, h));
      albedo = mix(albedo, vColC, smoothstep(0.25, 0.65, fbm3(ps * 7.0)) * 0.55);
      float cr = craterField(ps * 3.5) + 0.5 * craterField(ps * 7.0 + 11.0);
      albedo *= 1.0 + cr * 0.6;
    } else if (kind == 1) {
      // Gazowy olbrzym: pasy z turbulencją + wielka plama burzowa.
      float w = fbm(ps * vec3(1.2, 4.0, 1.2));
      float y = p.y + w * 0.18;
      float bands = sin(y * (9.0 + seed * 7.0)) * 0.5 + 0.5;
      float fine = sin(y * (27.0 + seed * 9.0) + w * 3.0) * 0.5 + 0.5;
      albedo = mix(vColB, vColA, bands);
      albedo = mix(albedo, vColC, fine * 0.35);
      vec3 spotC = normalize(vec3(cos(seed * 6.283), (seed - 0.5) * 0.9, sin(seed * 6.283)));
      vec3 squash = vec3(1.0, 2.2, 1.0);
      float sd = distance(p * squash, spotC * squash);
      float spot = smoothstep(0.32, 0.12, sd + w * 0.08);
      albedo = mix(albedo, mix(vColB, vColC, 0.35) * 1.1, spot * 0.85);
    } else if (kind == 2) {
      // Lodowa: gładkie odcienie, cienkie spękania, połysk.
      float n = fbm(ps * vec3(1.5, 3.5, 1.5));
      albedo = mix(vColA, vColC, smoothstep(-0.3, 0.5, n));
      float cracks = 1.0 - abs(snoise(ps * 5.0));
      albedo = mix(albedo, vColB, smoothstep(0.9, 0.985, cracks) * 0.75);
      spec = pow(max(dot(reflect(-L, N), V), 0.0), 24.0) * 0.35;
    } else if (kind == 3) {
      // Wulkaniczna: ciemna skorupa, pulsujące żyły lawy (świecą też nocą).
      float n = fbm(ps * 2.0);
      float vein = 1.0 - abs(snoise(ps * 3.0 + n * 1.5));
      albedo = mix(vColB, vColA, fbm3(ps * 8.0) * 0.5 + 0.5);
      float glow = smoothstep(0.82, 0.97, vein);
      float pulse = 0.85 + 0.15 * sin(uTime * 1.7 + seed * 12.0);
      albedo *= 1.0 - glow;
      emissive = vColC * (glow * 2.2 * pulse + 0.06);
    } else {
      // Ziemiopodobna: oceany, lądy, czapy lodowe, chmury, światła miast.
      float h = fbm(ps * 1.8);
      float land = smoothstep(0.0, 0.06, h);
      vec3 ground = mix(vColB, vColC, smoothstep(0.18, 0.45, h + fbm3(ps * 6.0) * 0.15));
      albedo = mix(vColA, ground, land);
      float cap = smoothstep(0.72, 0.86, abs(p.y) + fbm3(ps * 4.0) * 0.12);
      albedo = mix(albedo, vec3(0.92, 0.95, 1.0), cap);
      float ang2 = uTime * 0.02;
      vec3 pc = vec3(cos(ang2) * p.x - sin(ang2) * p.z, p.y, sin(ang2) * p.x + cos(ang2) * p.z);
      float cloud = smoothstep(0.05, 0.55, fbm(pc * 2.6 + seed * 7.0));
      albedo = mix(albedo, vec3(1.0), cloud * 0.75);
      spec = pow(max(dot(reflect(-L, N), V), 0.0), 48.0) * 0.8 * (1.0 - land) * (1.0 - cloud);
      // Miasta skupione na wybrzeżach i w „cywilizowanych” regionach.
      float region = smoothstep(0.1, 0.4, fbm3(ps * 3.0 + 5.0));
      float coast = 1.0 - smoothstep(0.0, 0.2, h);
      float city = step(0.86, hash3(floor(ps * 70.0)).x) * land * region * (0.4 + 0.6 * coast);
      city *= (1.0 - cloud) * (1.0 - cap);
      emissive = vec3(1.0, 0.72, 0.38) * city * smoothstep(0.05, -0.25, ndl) * 0.7;
    }

    // Słabe światło od strony kamery — nocna strona nie ginie w czerni.
    float fill = max(dot(N, V), 0.0) * 0.12;
    vec3 col = albedo * (0.04 + fill + 1.35 * lit) + spec * smoothstep(0.0, 0.2, ndl) + emissive;
    // Atmosfera na krawędzi tarczy — w kolorze modułu.
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.5);
    col += vRim * fres * (0.15 + 0.6 * smoothstep(-0.35, 0.5, ndl));
    gl_FragColor = vec4(col * vDim, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ATMOSPHERE_VERTEX = /* glsl */ `
  attribute vec3 aRim;
  attribute float aDim;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vCenter;
  varying vec3 vRim;
  varying float vDim;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 w = m * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(m) * normal);
    vCenter = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vRim = aRim;
    vDim = aDim;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vCenter;
  varying vec3 vRim;
  varying float vDim;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    // Tylna ścianka powłoki: 0 na zewnętrznej krawędzi, max przy tarczy.
    float inten = pow(smoothstep(0.0, 0.45, -dot(N, V)), 2.2);
    vec3 L = normalize(uSun - vCenter);
    float sunSide = smoothstep(-0.5, 0.6, dot(normalize(vWorld - vCenter), L));
    gl_FragColor = vec4(vRim * inten * (0.12 + 0.6 * sunSide) * vDim, 1.0);
    #include <colorspace_fragment>
  }
`;

const RING_VERTEX = /* glsl */ `
  attribute vec3 aColA;
  attribute vec3 aColC;
  attribute vec2 aKindSeed;
  attribute float aDim;
  varying float vRadius;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColA;
  varying vec3 vColC;
  varying float vSeed;
  varying float vDim;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 w = m * vec4(position, 1.0);
    vRadius = length(position.xy);
    vWorld = w.xyz;
    vNormal = normalize(mat3(m) * vec3(0.0, 0.0, 1.0));
    vColA = aColA;
    vColC = aColC;
    vSeed = aKindSeed.y;
    vDim = aDim;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const RING_FRAGMENT = /* glsl */ `
  uniform vec3 uSun;
  varying float vRadius;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColA;
  varying vec3 vColC;
  varying float vSeed;
  varying float vDim;
  void main() {
    float t = (vRadius - ${RING_INNER.toFixed(2)}) / ${(RING_OUTER - RING_INNER).toFixed(2)};
    float bands = 0.55 + 0.45 * sin(t * 70.0 + vSeed * 20.0) * (0.6 + 0.4 * sin(t * 23.0));
    float gap = smoothstep(0.015, 0.05, abs(t - 0.62)); // przerwa jak u Saturna
    float edge = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t);
    float alpha = 0.75 * bands * gap * edge;
    vec3 L = normalize(uSun - vWorld);
    float light = 0.35 + 0.8 * abs(dot(normalize(vNormal), L));
    gl_FragColor = vec4(mix(vColA, vColC, bands) * light * vDim, alpha * (0.4 + 0.6 * vDim));
    #include <colorspace_fragment>
  }
`;

export function PlanetField({
  nodes,
  looks,
  visibleModules,
  highlighted,
  rimColors,
}: {
  nodes: PlanetNode[];
  looks: PlanetLook[];
  visibleModules: ReadonlySet<ModuleId>;
  highlighted: ReadonlySet<number>;
  rimColors: Record<ModuleId, string>;
}) {
  const count = nodes.length;
  const ringed = useMemo(
    () => looks.flatMap((l, i) => (l.ringTilt === null || i >= count ? [] : [i])),
    [looks, count],
  );

  // Wspólne uniformy: czas i pozycja słońca.
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 0, 0) } }),
    [],
  );

  const { planetGeo, atmoGeo, ringGeo, dim, ringDim } = useMemo(() => {
    const colA = new Float32Array(count * 3);
    const colB = new Float32Array(count * 3);
    const colC = new Float32Array(count * 3);
    const rim = new Float32Array(count * 3);
    const kindSeed = new Float32Array(count * 2);
    const c = new THREE.Color();
    nodes.forEach((n, i) => {
      const look = looks[i];
      if (!look) return;
      // THREE.Color przelicza sRGB z CSS na liniowe — shader liczy liniowo.
      c.set(look.colors[0]).toArray(colA, i * 3);
      c.set(look.colors[1]).toArray(colB, i * 3);
      c.set(look.colors[2]).toArray(colC, i * 3);
      c.set(rimColors[n.module]).toArray(rim, i * 3);
      kindSeed.set([PLANET_KIND_INDEX[look.kind], look.seed], i * 2);
    });
    const dimAttr = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
    const inst = (arr: Float32Array, size: number) => new THREE.InstancedBufferAttribute(arr, size);

    const planet = new THREE.SphereGeometry(1, 64, 48);
    planet.setAttribute("aColA", inst(colA, 3));
    planet.setAttribute("aColB", inst(colB, 3));
    planet.setAttribute("aColC", inst(colC, 3));
    planet.setAttribute("aRim", inst(rim, 3));
    planet.setAttribute("aKindSeed", inst(kindSeed, 2));
    planet.setAttribute("aDim", dimAttr);

    const atmo = new THREE.SphereGeometry(ATMOSPHERE, 32, 24);
    atmo.setAttribute("aRim", inst(rim, 3));
    atmo.setAttribute("aDim", dimAttr);

    // Pierścienie: tylko planety-węzły, więc własne (krótsze) tablice.
    const pick = (src: Float32Array, size: number) => {
      const out = new Float32Array(Math.max(1, ringed.length) * size);
      ringed.forEach((i, k) => out.set(src.subarray(i * size, i * size + size), k * size));
      return out;
    };
    const ringDimAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(Math.max(1, ringed.length)).fill(1),
      1,
    );
    const ring = new THREE.RingGeometry(RING_INNER, RING_OUTER, 128, 1);
    ring.setAttribute("aColA", inst(pick(colA, 3), 3));
    ring.setAttribute("aColC", inst(pick(colC, 3), 3));
    ring.setAttribute("aKindSeed", inst(pick(kindSeed, 2), 2));
    ring.setAttribute("aDim", ringDimAttr);

    return { planetGeo: planet, atmoGeo: atmo, ringGeo: ring, dim: dimAttr, ringDim: ringDimAttr };
  }, [nodes, looks, rimColors, count, ringed]);

  useEffect(
    () => () => {
      planetGeo.dispose();
      atmoGeo.dispose();
      ringGeo.dispose();
    },
    [planetGeo, atmoGeo, ringGeo],
  );

  const materials = useMemo(
    () => ({
      planet: new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PLANET_VERTEX,
        fragmentShader: PLANET_FRAGMENT,
      }),
      atmosphere: new THREE.ShaderMaterial({
        uniforms,
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
      ring: new THREE.ShaderMaterial({
        uniforms,
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    }),
    [uniforms],
  );
  useEffect(
    () => () => {
      materials.planet.dispose();
      materials.atmosphere.dispose();
      materials.ring.dispose();
    },
    [materials],
  );

  const planetMesh = useMemo(
    () => new THREE.InstancedMesh(planetGeo, materials.planet, Math.max(1, count)),
    [planetGeo, materials, count],
  );
  const atmoMesh = useMemo(
    () => new THREE.InstancedMesh(atmoGeo, materials.atmosphere, Math.max(1, count)),
    [atmoGeo, materials, count],
  );
  const ringMesh = useMemo(
    () => new THREE.InstancedMesh(ringGeo, materials.ring, Math.max(1, ringed.length)),
    [ringGeo, materials, ringed.length],
  );

  // Pozycje, rozmiary, ukryte moduły, przygaszenie przy wyszukiwaniu.
  useEffect(() => {
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const none = new THREE.Quaternion();
    const searching = highlighted.size > 0;
    nodes.forEach((n, i) => {
      const r = visibleModules.has(n.module) ? planetRadius(n.rows) : 0.0001;
      pos.set(n.x * SCENE_SCALE, n.y * SCENE_SCALE, n.z * SCENE_SCALE);
      m.compose(pos, none, scale.setScalar(r));
      planetMesh.setMatrixAt(i, m);
      atmoMesh.setMatrixAt(i, m);
      dim.setX(i, searching && !highlighted.has(i) ? DIMMED : 1);
    });
    const tilt = new THREE.Quaternion();
    const euler = new THREE.Euler();
    ringed.forEach((i, k) => {
      const n = nodes[i];
      const r = visibleModules.has(n.module) ? planetRadius(n.rows) : 0.0001;
      const t = looks[i].ringTilt ?? 0;
      // Geometria pierścienia leży w XY — kładziemy ją na równiku i lekko pochylamy.
      tilt.setFromEuler(euler.set(-Math.PI / 2 + t, 0, t * 0.6));
      pos.set(n.x * SCENE_SCALE, n.y * SCENE_SCALE, n.z * SCENE_SCALE);
      m.compose(pos, tilt, scale.setScalar(r));
      ringMesh.setMatrixAt(k, m);
      ringDim.setX(k, searching && !highlighted.has(i) ? DIMMED : 1);
    });
    for (const mesh of [planetMesh, atmoMesh, ringMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    dim.needsUpdate = true;
    ringDim.needsUpdate = true;
  }, [
    nodes,
    looks,
    ringed,
    visibleModules,
    highlighted,
    planetMesh,
    atmoMesh,
    ringMesh,
    dim,
    ringDim,
  ]);

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
  });

  if (count === 0) return null;
  return (
    <group>
      <primitive object={planetMesh} frustumCulled={false} />
      <primitive object={atmoMesh} frustumCulled={false} renderOrder={2} />
      {ringed.length > 0 && <primitive object={ringMesh} frustumCulled={false} renderOrder={3} />}
    </group>
  );
}
