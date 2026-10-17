// Mózg 3D — kosmos wokół obu map: pole gwiazd, mgławica i słońce.
//
// Tło jedzie razem z kamerą (bez paralaksy), więc gwiazdy tła nigdy nie
// mylą się z gwiazdami wiedzy — te drugie przesuwają się przy obrocie,
// tło stoi. Barwy kosmosu to grafika (jak paleta Town), nie kolory UI.

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { seededRandom } from "@/lib/brain/projection";
import { NOISE_GLSL } from "./glsl";

const STAR_COUNT = 1600;
const SKY_RADIUS = 90;

/**
 * Gwiazdy i mgławica w tle. `strength` przygasza całość — w trybie WIEDZA
 * tło jest ciemniejsze, żeby nie konkurowało z gwiazdami-danymi.
 */
export function SpaceBackdrop({ strength = 1 }: { strength?: number }) {
  const group = useRef<THREE.Group>(null);
  const { camera, gl } = useThree();

  const stars = useMemo(() => {
    const rnd = seededRandom(1977);
    const pos = new Float32Array(STAR_COUNT * 3);
    const col = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    const phase = new Float32Array(STAR_COUNT);
    // Barwy gwiazd wg temperatury: błękitne, białe, żółte, pomarańczowe.
    const temps = ["#a9c4ff", "#dfe8ff", "#ffffff", "#fff1d0", "#ffd0a0"].map(
      (h) => new THREE.Color(h),
    );
    for (let i = 0; i < STAR_COUNT; i++) {
      // Równomiernie na sferze.
      const u = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(t) * SKY_RADIUS, u * SKY_RADIUS, r * Math.sin(t) * SKY_RADIUS], i * 3);
      const c = temps[Math.floor(rnd() * temps.length)];
      col.set([c.r, c.g, c.b], i * 3);
      // Większość drobnych, kilka jaśniejszych.
      const big = rnd();
      size[i] = big > 0.985 ? 3.2 : big > 0.9 ? 2.1 : 1.2 + rnd() * 0.6;
      phase[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    return g;
  }, []);

  const starMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uStrength: { value: strength }, uDpr: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aPhase;
          uniform float uTime;
          uniform float uDpr;
          varying vec3 vColor;
          varying float vTwinkle;
          void main() {
            vColor = aColor;
            vTwinkle = 0.7 + 0.3 * sin(uTime * (0.6 + aPhase * 2.2) + aPhase * 40.0);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * uDpr;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uStrength;
          varying vec3 vColor;
          varying float vTwinkle;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vColor * a * vTwinkle * 0.85 * uStrength, 1.0);
            #include <colorspace_fragment>
          }
        `,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    // strength aktualizowane w useFrame — materiał tworzony raz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const nebulaMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uStrength: { value: strength } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${NOISE_GLSL}
          uniform float uStrength;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            // Dwie warstwy obłoków: chłodny błękit i fiolet z różem.
            float n1 = fbm3(d * 1.6 + vec3(3.1, 0.0, 1.7));
            float n2 = fbm3(d * 2.4 + vec3(-2.0, 4.2, 0.5));
            float band = exp(-pow(d.y * 2.2 + n1 * 0.8, 2.0)); // „droga mleczna”
            vec3 teal = vec3(0.02, 0.10, 0.16);
            vec3 violet = vec3(0.10, 0.03, 0.16);
            vec3 rose = vec3(0.14, 0.03, 0.08);
            // Rzadkie obłoki: większość nieba ma zostać czarna.
            vec3 col = teal * smoothstep(0.1, 0.7, n1) * (0.4 + band)
                     + violet * smoothstep(0.2, 0.8, n2)
                     + rose * smoothstep(0.45, 0.9, n1 * n2 * 2.0);
            gl_FragColor = vec4(col * 0.5 * uStrength, 1.0);
            #include <colorspace_fragment>
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((state) => {
    group.current?.position.copy(camera.position);
    starMat.uniforms.uTime.value = state.clock.elapsedTime;
    starMat.uniforms.uStrength.value = strength;
    starMat.uniforms.uDpr.value = gl.getPixelRatio();
    nebulaMat.uniforms.uStrength.value = strength;
  });

  return (
    <group ref={group} renderOrder={-10}>
      <mesh material={nebulaMat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[SKY_RADIUS + 5, 32, 16]} />
      </mesh>
      <points geometry={stars} material={starMat} renderOrder={-9} frustumCulled={false} />
    </group>
  );
}

/** Słońce w środku mapy STRUKTURA — źródło światła planet (uSun = 0,0,0). */
export function Sun({ radius }: { radius: number }) {
  const surface = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vObj;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vObj = position;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vNormal = normalize(mat3(modelMatrix) * normal);
            vView = normalize(cameraPosition - w.xyz);
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          ${NOISE_GLSL}
          uniform float uTime;
          varying vec3 vObj;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vec3 p = normalize(vObj);
            float g = fbm(p * 4.0 + vec3(0.0, uTime * 0.05, uTime * 0.03));
            float spots = smoothstep(0.35, 0.6, fbm3(p * 2.0 - uTime * 0.02));
            vec3 hot = vec3(1.0, 0.96, 0.82);
            vec3 mid = vec3(1.0, 0.68, 0.24);
            vec3 deep = vec3(0.95, 0.35, 0.08);
            vec3 col = mix(deep, mid, smoothstep(-0.4, 0.2, g));
            col = mix(col, hot, smoothstep(0.1, 0.5, g));
            col *= 1.0 - spots * 0.35;
            // Pociemnienie brzegowe jak u prawdziwej gwiazdy.
            float limb = pow(max(dot(normalize(vNormal), normalize(vView)), 0.0), 0.45);
            gl_FragColor = vec4(col * (0.9 + 1.9 * limb), 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  const corona = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${NOISE_GLSL}
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            vec2 c = vUv - 0.5;
            float r = length(c) * 2.0;
            float a = atan(c.y, c.x);
            float rays = 0.65 + 0.35 * snoise(vec3(cos(a) * 2.5, sin(a) * 2.5, uTime * 0.15));
            float glow = exp(-r * 4.2) * 1.4 + exp(-r * 9.0) * 1.6;
            glow += exp(-r * 2.4) * 0.35 * rays;
            glow *= smoothstep(1.0, 0.6, r);
            vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.85, 0.6), exp(-r * 5.0));
            gl_FragColor = vec4(col * glow, 1.0);
            #include <colorspace_fragment>
          }
        `,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    [],
  );

  useFrame((state) => {
    surface.uniforms.uTime.value = state.clock.elapsedTime;
    corona.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group>
      <mesh material={surface}>
        <sphereGeometry args={[radius, 48, 32]} />
      </mesh>
      <Billboard>
        <mesh material={corona} renderOrder={1}>
          <planeGeometry args={[radius * 7, radius * 7]} />
        </mesh>
      </Billboard>
    </group>
  );
}
