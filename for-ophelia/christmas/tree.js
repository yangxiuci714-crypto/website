import * as THREE from './vendor/three-0.160.0/three.module.min.js';
import { EffectComposer } from './vendor/three-0.160.0/EffectComposer.js';
import { RenderPass } from './vendor/three-0.160.0/RenderPass.js';
import { UnrealBloomPass } from './vendor/three-0.160.0/UnrealBloomPass.js';
import { OutputPass } from './vendor/three-0.160.0/OutputPass.js';
import { ShaderPass } from './vendor/three-0.160.0/ShaderPass.js';

window.__treeStarted = true;
window.__stopFallback?.();

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('scene');
const TAU = Math.PI * 2;
let seed = 1225;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rr = (a, b) => a + (b - a) * rand();
const gauss = () => { let u = 0; while (u === 0) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rand()); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------- renderer ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let dpr = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr);
renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight), false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 200);
const tree = new THREE.Group();
scene.add(tree);

/* ---------- tree shape ---------- */
const H = 6.0, R0 = 2.15, TURNS = 6;
const uniforms = {
  uTime: { value: 0 }, uIntro: { value: 0 }, uScatter: { value: 0 }, uScale: { value: 800 },
  uFlow: { value: 0.006 }, uPulse: { value: 0 }, uH: { value: H }, uR0: { value: R0 }, uTurns: { value: TURNS },
  /* the star's secret: how far the tree has turned into a heart, its beat, and its turn to face the camera */
  uHeart: { value: 0 }, uBeat: { value: 0 }, uHeartY: { value: 3.35 }, uHRot: { value: new THREE.Matrix3() },
};

const DOT_FRAG = /* glsl */`
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor * exp(-d * 4.0) * vAlpha, 1.0);
  }`;

const TREE_VERT = /* glsl */`
  uniform float uTime, uIntro, uScatter, uScale, uFlow, uPulse, uH, uR0, uTurns;
  uniform float uHeart, uBeat, uHeartY;
  uniform mat3 uHRot;
  attribute vec4 aA;
  attribute vec4 aB;
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  varying float vAlpha;
  /* every layer but the base disc joins the heart; the bright ribbon is dimmed there, packed tighter */
  #if TYPE != 2
  attribute vec3 aH;
  #endif
  #if TYPE == 0
  const float HEART_DIM = 0.6;
  #else
  const float HEART_DIM = 1.0;
  #endif

  vec3 target(out float edge, out float glow) {
    edge = 1.0; glow = 0.0;
  #if TYPE == 0
    float q = fract(aA.x + uTime * uFlow);
    float A = uR0 * 0.5, B = uR0 + 0.05;
    float s = (B - sqrt(max(B * B - 4.0 * A * q * (B - A), 0.0))) / (2.0 * A);
    float r = uR0 * (1.0 - s) + 0.05;
    float th = s * uTurns * 6.2831853;
    float w = mix(0.2, 0.045, s);
    float rad = r + aA.y * w;
    vec3 p = vec3(cos(th) * rad, s * uH * 0.9 + aA.z * w * 0.75, sin(th) * rad);
    p.xz += vec2(-sin(th), cos(th)) * aA.w * w * 0.5;
    edge = smoothstep(0.0, 0.02, q) * smoothstep(1.0, 0.975, q);
    float dq = abs(fract(q - uPulse + 0.5) - 0.5);
    glow = exp(-dq * dq * 2200.0);
    return p;
  #elif TYPE == 1
    return aA.xyz + vec3(sin(uTime * 0.6 + aB.y * 6.0), cos(uTime * 0.5 + aB.y * 4.0), sin(uTime * 0.55 + aB.y * 5.0)) * 0.025;
  #elif TYPE == 2
    float phi = aA.y + uTime * 0.2 / (0.55 + aA.x / uR0);
    return vec3(cos(phi) * aA.x, aA.z, sin(phi) * aA.x);
  #else
    float th = aA.x + uTime * 1.1;
    return vec3(cos(th) * aA.z, aA.y, sin(th) * aA.z);
  #endif
  }

  void main() {
    float edge, glow;
    vec3 tgt = target(edge, glow);
    float hk = 0.0;
  #if TYPE != 2
    /* the heart: each point leaves the tree at its own moment and swirls round on the way */
    hk = clamp(uHeart * 1.5 - aB.y * 0.5, 0.0, 1.0);
    hk = hk * hk * (3.0 - 2.0 * hk);
    if (hk > 0.0) {
      vec3 hp = uHRot * (aH * (1.0 + uBeat * 0.06)) + vec3(0.0, uHeartY, 0.0);
      hp += vec3(sin(uTime * 1.3 + aB.y * 40.0), cos(uTime * 1.1 + aB.y * 31.0), sin(uTime * 0.9 + aB.y * 23.0)) * 0.012;
      vec3 m = mix(tgt, hp, hk);
      float arc = sin(hk * 3.14159265);
      float sw = arc * (0.9 + aB.y * 0.8);
      m.xz = mat2(cos(sw), sin(sw), -sin(sw), cos(sw)) * m.xz;
      m.y += arc * 0.3;
      tgt = m;
      edge = mix(edge, 1.0, hk);
      glow *= 1.0 - hk;
    }
  #endif
    float p = clamp((uIntro - aB.x) / 0.55, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - p, 3.0);
    float sw = (1.0 - e) * 2.6;
    vec3 st = position;
    st.xz = mat2(cos(sw), sin(sw), -sin(sw), cos(sw)) * st.xz;
    vec3 pos = mix(st, tgt, e);
    vec3 dir = normalize(tgt - vec3(0.0, uH * 0.42, 0.0) + vec3(0.0, 0.001, 0.0));
    float sc = uScatter * aB.w;
    pos += dir * sc + vec3(sin(aB.y * 7.0), cos(aB.y * 5.0), sin(aB.y * 3.0)) * sc * 0.4;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float tw = 0.72 + 0.28 * sin(uTime * aB.z + aB.y * 6.2831853);
    float ps = aSize * uScale / -mv.z * (0.85 + 0.3 * tw) * (1.0 + glow * 0.7);
    gl_PointSize = max(ps, 1.0);
    vColor = aColor * tw * (1.0 + glow * 2.0) * (1.0 + uBeat * 0.35 * hk);
    vAlpha = (0.2 + 0.8 * e) * edge * min(1.0, ps) * mix(1.0, HEART_DIM, hk);
    gl_Position = projectionMatrix * mv;
  }`;

function makeLayer(type, n, fill, heart) {
  const S = new Float32Array(n * 3), A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 3), Z = new Float32Array(n);
  const HP = heart ? new Float32Array(n * 3) : null, hv = new THREE.Vector3();
  const o = { a: [0, 0, 0, 0], b: [0, 0, 0, 0], s: new THREE.Vector3(), c: new THREE.Color(), size: 0.02 };
  for (let i = 0; i < n; i++) {
    fill(o, i);
    S.set([o.s.x, o.s.y, o.s.z], i * 3); A.set(o.a, i * 4); B.set(o.b, i * 4);
    C.set([o.c.r, o.c.g, o.c.b], i * 3); Z[i] = o.size;
    if (heart) { heart(hv); HP.set([hv.x, hv.y, hv.z], i * 3); }
  }
  const g = new THREE.BufferGeometry();
  if (HP) g.setAttribute('aH', new THREE.BufferAttribute(HP, 3));
  g.setAttribute('position', new THREE.BufferAttribute(S, 3));
  g.setAttribute('aA', new THREE.BufferAttribute(A, 4));
  g.setAttribute('aB', new THREE.BufferAttribute(B, 4));
  g.setAttribute('aColor', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(Z, 1));
  const m = new THREE.ShaderMaterial({
    defines: { TYPE: type }, uniforms, vertexShader: TREE_VERT, fragmentShader: DOT_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  tree.add(pts);
  return pts;
}

/* scattered start positions for the opening gather */
function startPos(v) {
  const dir = new THREE.Vector3(gauss(), gauss() * 0.6, gauss()).normalize();
  return v.copy(dir).multiplyScalar(rr(6, 13)).add(new THREE.Vector3(0, 3, 0));
}
const hex = (h) => new THREE.Color(h);
const PINK = hex('#f7a9c9'), ROSE = hex('#e9779f'), WHITE = hex('#fff3f8'), PALE = hex('#f4d8e4'), TIPC = hex('#ffc6db');
const IRIDESCENT = ['#ffe8b3', '#bfe6ff', '#dccbff', '#ffd1e6'].map(hex);
const phaseB = (o, delay) => { o.b[0] = delay; o.b[1] = rand(); o.b[2] = rr(0.8, 2.8); o.b[3] = rr(0.8, 2.6); };

/* ---------- the heart the tree turns into when the star is tapped ---------- */
/* The classic heart curve, traced by distance along it so points spread evenly round the outline
   (the curve itself slows to a stop at the dip and at the tip). It has its own random stream, so the
   tree and the sky keep exactly the look they had. */
let hseed = 812;
const hrand = () => { hseed = (Math.imul(hseed, 1664525) + 1013904223) >>> 0; return hseed / 4294967296; };
const hgauss = () => { let u = 0; while (u === 0) u = hrand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * hrand()); };
const HEART_S = 0.16, HEART_D = 0.62; /* curve units to world units; how full the heart is at its middle */
const heartPath = (() => {
  const N = 2400, x = new Float32Array(N + 1), y = new Float32Array(N + 1), L = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * TAU, s = Math.sin(t);
    x[i] = 16 * s * s * s;
    y[i] = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5;
    if (i) L[i] = L[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  }
  return { x, y, L, N };
})();
/* a point r of the way out from the middle to the outline (r > 1 is outside it), in world units */
function heartAt(v, r) {
  const { x, y, L, N } = heartPath, want = hrand() * L[N];
  let lo = 0, hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < want) lo = m; else hi = m; }
  const f = (want - L[lo]) / Math.max(1e-6, L[hi] - L[lo]);
  return v.set(lerp(x[lo], x[hi], f) * r * HEART_S, lerp(y[lo], y[hi], f) * r * HEART_S, 0);
}
const swell = (r) => HEART_D * Math.sqrt(Math.max(0, 1 - r * r));
/* the ribbon draws the bright outline, with a softer glow just inside it on the heart's surface */
const heartRibbon = (v) => {
  if (hrand() < 0.7) { heartAt(v, 1 - Math.abs(hgauss()) * 0.022); v.z = hgauss() * 0.05; return; }
  const r = Math.pow(hrand(), 1 / 8);
  heartAt(v, r); v.z = (hrand() < 0.5 ? -1 : 1) * swell(r) * (0.8 + 0.2 * hrand());
};
/* the dust fills the inside, thickest toward the edge, and a little of it hangs outside as a halo */
const heartDust = (v) => {
  if (hrand() < 0.78) { const r = Math.pow(hrand(), 1 / 3.5); heartAt(v, r); v.z = (hrand() * 2 - 1) * swell(r); return; }
  heartAt(v, Math.min(1.6, 1.02 - Math.log(1 - hrand()) * 0.09)); v.z = hgauss() * 0.1;
};
/* the star's own sparks scatter along the outline */
const heartSparks = (v) => { heartAt(v, 1 + hgauss() * 0.03); v.z = hgauss() * 0.06; };

/* ---------- the four particle layers of the tree ---------- */
makeLayer(0, 17000, (o) => {
  const u = rand(), gr = gauss() * 0.9, gy = gauss() * 0.9, gt = gauss() * 0.9;
  o.a[0] = u; o.a[1] = gr; o.a[2] = gy; o.a[3] = gt;
  const core = Math.exp(-(gr * gr + gy * gy) * 0.7);
  if (rand() < 0.07) o.c.copy(IRIDESCENT[Math.floor(rand() * 4)]);
  else o.c.copy(PINK).lerp(WHITE, 0.1 + core * 0.5);
  o.c.multiplyScalar(0.62 * rr(0.8, 1.2));
  o.size = rr(0.018, 0.034);
  startPos(o.s);
  phaseB(o, 0.06 + u * 0.42 + rand() * 0.1);
}, heartRibbon);

makeLayer(1, 11000, (o) => {
  const yf = 1 - Math.sqrt(rand());
  const rc = R0 * (1 - yf) + 0.05;
  const r = rc * (0.3 + 0.8 * Math.pow(rand(), 0.6));
  const a = rand() * TAU;
  o.a[0] = Math.cos(a) * r; o.a[1] = yf * H * 0.9 + gauss() * 0.04; o.a[2] = Math.sin(a) * r; o.a[3] = 0;
  o.c.copy(ROSE).lerp(PINK, rand() * 0.6).multiplyScalar(0.44 * rr(0.7, 1.3));
  o.size = rr(0.012, 0.024);
  startPos(o.s);
  phaseB(o, 0.1 + yf * 0.42 + rand() * 0.12);
}, heartDust);

makeLayer(2, 16000, (o) => {
  const k = rand();
  let r, phi;
  if (k < 0.16) { r = R0 * (1 + gauss() * 0.05); phi = rand() * TAU; }
  else if (k < 0.62) {
    r = R0 * (0.25 + 3.1 * Math.pow(rand(), 1.5));
    phi = (rand() < 0.5 ? 0 : Math.PI) + Math.log(r / R0 + 0.2) * 2.6 + gauss() * 0.22;
  } else { r = R0 * (0.15 + 3.4 * Math.pow(rand(), 1.8)); phi = rand() * TAU; }
  o.a[0] = r; o.a[1] = phi; o.a[2] = gauss() * 0.035 * (1 + (r / R0) * 0.3) - 0.03; o.a[3] = 0;
  const f = clamp(r / (R0 * 3.4), 0, 1);
  o.c.copy(k < 0.62 ? ROSE : PINK).lerp(PALE, f).multiplyScalar(0.9 / (1 + Math.pow(r / R0, 1.5) * 0.45) * rr(0.75, 1.25));
  o.size = rr(0.015, 0.03);
  startPos(o.s);
  phaseB(o, rand() * 0.3);
});

makeLayer(3, 900, (o) => {
  const t = Math.pow(rand(), 0.8);
  o.a[0] = rand() * TAU; o.a[1] = H * 0.88 + t * H * 0.17; o.a[2] = 0.025 + Math.abs(gauss()) * 0.05 * (1 - t); o.a[3] = 0;
  o.c.copy(TIPC).lerp(WHITE, rand() * 0.4).multiplyScalar(0.5);
  o.size = rr(0.014, 0.026);
  startPos(o.s);
  phaseB(o, 0.5 + rand() * 0.15);
}, heartSparks);

/* ---------- star glint at the tip and a faint rose haze behind the tree ---------- */
function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glintTex = canvasTexture(256, (g, c) => {
  const core = g.createRadialGradient(c, c, 0, c, c, c * 0.32);
  core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.25, 'rgba(255,240,246,0.55)'); core.addColorStop(1, 'rgba(255,220,235,0)');
  g.fillStyle = core; g.fillRect(0, 0, c * 2, c * 2);
  g.globalCompositeOperation = 'lighter';
  for (const [a, len, w] of [[0, 1, 2.4], [Math.PI / 2, 1, 2.4], [Math.PI / 4, 0.42, 1.4], [-Math.PI / 4, 0.42, 1.4]]) {
    g.save(); g.translate(c, c); g.rotate(a);
    const lg = g.createLinearGradient(-c * len, 0, c * len, 0);
    lg.addColorStop(0, 'rgba(255,230,240,0)'); lg.addColorStop(0.5, 'rgba(255,248,252,1)'); lg.addColorStop(1, 'rgba(255,230,240,0)');
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(-c * len, 0); g.lineTo(0, -w); g.lineTo(c * len, 0); g.lineTo(0, w); g.closePath(); g.fill();
    g.restore();
  }
});
const hazeTex = canvasTexture(256, (g, c) => {
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, c * 2, c * 2);
});
const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, color: hex('#ffe3ee'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
glint.position.set(0, H * 1.06 + 0.12, 0);
glint.scale.setScalar(1.25);
tree.add(glint);
const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: hazeTex, color: hex('#c2426f'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
haze.position.set(0, H * 0.4, 0);
haze.scale.set(10, 9, 1);
scene.add(haze);


/* ---------- background: a sky all the way round, snowfall and snowflake crystals that travel
   with the camera, shooting stars ---------- */
const snowUniforms = { uTime: { value: 0 }, uScale: uniforms.uScale, uFade: { value: 0 } };
scene.add(camera);

function bgLayer(n, fill, vertexShader, fragmentShader, extra = {}) {
  const P = new Float32Array(n * 3), Z = new Float32Array(n), V = new Float32Array(n), F = new Float32Array(n), C = new Float32Array(n * 3);
  const o = { p: new THREE.Vector3(), c: new THREE.Color(), size: 0, speed: 0, phase: 0 };
  for (let i = 0; i < n; i++) {
    fill(o);
    P.set([o.p.x, o.p.y, o.p.z], i * 3); Z[i] = o.size; V[i] = o.speed; F[i] = o.phase; C.set([o.c.r, o.c.g, o.c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(Z, 1));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(V, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(F, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(C, 3));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { ...snowUniforms, ...extra }, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
}
const BG_HEAD = /* glsl */`
  uniform float uTime, uScale, uFade;
  attribute float aSize, aSpeed, aPhase; attribute vec3 aColor;
  varying vec3 vColor; varying float vAlpha;`;
/* wraps a point into a box centred on uBoxC (the box rides along ahead of the camera) and returns how
   close it is to the box's faces, so a point can fade out before it jumps to the other side */
const BOX_WRAP = /* glsl */`
  uniform vec3 uBoxC;
  float wrapBox(inout vec3 p, vec3 size) {
    vec3 b0 = uBoxC - size * 0.5;
    p = b0 + mod(p - b0, size);
    vec3 q = abs(p - uBoxC) / (size * 0.5);
    return max(q.x, max(q.y, q.z));
  }`;
/* faded-out points are moved outside the clip volume, so they cost nothing to draw */
const CULL = 'if (vAlpha < 0.003) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);';
const STAR_TINTS = ['#ffffff', '#ffffff', '#ffffff', '#ffe1ec', '#e4dcff', '#fff0d2'].map(hex);

/* the sky: stars on a sphere that moves with the camera, so they sit at infinity and wheel past
   as the view circles the tree; now and then one flares into a small cross */
bgLayer(6500, (o) => {
  const y = rr(-1, 1), a = rand() * TAU, s = Math.sqrt(1 - y * y);
  o.p.set(Math.cos(a) * s * 100, y * 100, Math.sin(a) * s * 100);
  o.size = rr(0.1, 0.24); o.speed = rand(); o.phase = rand();
  o.c.copy(STAR_TINTS[Math.floor(rand() * STAR_TINTS.length)]).multiplyScalar(rr(0.5, 1));
}, BG_HEAD + /* glsl */`
  varying float vFlare;
  void main() {
    vec4 mv = modelViewMatrix * vec4(cameraPosition + position, 1.0);
    float tw = 0.5 + 0.5 * sin(uTime * (0.6 + aSpeed * 1.8) + aPhase * 6.2831853);
    float fl = pow(max(0.0, sin(uTime * (0.12 + aSpeed * 0.2) + aPhase * 40.0)), 90.0);
    vFlare = fl;
    float ps = aSize * uScale / -mv.z * (1.0 + fl * 6.0);
    gl_PointSize = max(ps, 1.0);
    vAlpha = uFade * (0.35 + 0.65 * tw) * min(1.0, ps) * (1.0 + fl * 1.6);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`, /* glsl */`
  varying vec3 vColor; varying float vAlpha; varying float vFlare;
  void main() {
    vec2 c = (gl_PointCoord - 0.5) * 2.0;
    float core = exp(-dot(c, c) * (6.0 + 40.0 * vFlare));
    float rays = (exp(-abs(c.x) * 30.0) * exp(-abs(c.y) * 2.4) + exp(-abs(c.y) * 30.0) * exp(-abs(c.x) * 2.4)) * vFlare;
    gl_FragColor = vec4(vColor * (core + rays) * vAlpha, 1.0);
  }`);

/* snowfall in a box that rides just ahead of the camera, so it surrounds the view wherever it flies */
const snowBox = { uBoxC: { value: new THREE.Vector3() } };
bgLayer(2900, (o) => {
  o.p.set(rand(), rand(), rand());
  o.size = rr(0.03, 0.075); o.speed = rr(0.25, 0.7); o.phase = rr(0, TAU);
  o.c.copy(rand() < 0.85 ? WHITE : PINK).multiplyScalar(rr(0.45, 0.85));
}, BG_HEAD + BOX_WRAP + /* glsl */`
  const vec3 BSIZE = vec3(48.0, 28.0, 48.0);
  void main() {
    vec3 p = position * BSIZE;
    p.y -= uTime * aSpeed;
    p.x += sin(uTime * 0.3 * aSpeed + aPhase) * 0.6 + uTime * 0.1;
    p.z += cos(uTime * 0.25 + aPhase) * 0.4;
    float edge = wrapBox(p, BSIZE);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float ps = aSize * uScale / -mv.z;
    gl_PointSize = max(ps, 1.0);
    float tw = 0.6 + 0.4 * sin(uTime * (0.8 + aSpeed) + aPhase * 5.0);
    vAlpha = uFade * tw * min(1.0, ps) * (1.0 - smoothstep(0.8, 1.0, edge)) * smoothstep(1.5, 5.0, -mv.z);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`, DOT_FRAG, snowBox);

/* snowflake crystals: four six-armed designs drawn once into a texture (top row), plus one heart
   hidden among them (bottom row) */
const flakeAtlas = (() => {
  const S = 256, cv = document.createElement('canvas');
  cv.width = S * 4; cv.height = S * 2;
  const g = cv.getContext('2d');
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 5;
  /* stroke width, arm length, side branches [where on the arm, length, angle], centre hexagon size */
  const designs = [
    { w: 7, arm: 0.95, br: [[0.32, 0.3, 58], [0.58, 0.24, 58], [0.8, 0.13, 58]], hex: 0.15 },
    { w: 6, arm: 0.92, br: [[0.48, 0.38, 42], [0.74, 0.2, 42]], hex: 0 },
    { w: 8, arm: 0.9, br: [[0.26, 0.17, 62], [0.48, 0.28, 62], [0.7, 0.19, 62]], hex: 0.24 },
    { w: 5, arm: 0.96, br: [[0.36, 0.2, 32], [0.55, 0.3, 32], [0.76, 0.2, 32]], hex: 0.1 },
  ];
  designs.forEach((d, k) => {
    const R = S * 0.45;
    g.save();
    g.translate(k * S + S / 2, S / 2);
    g.lineWidth = d.w;
    for (let a = 0; a < 6; a++) {
      g.save(); g.rotate((a * Math.PI) / 3);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -R * d.arm);
      for (const [at, len, ang] of d.br) {
        const y = -R * d.arm * at, l = R * len, r = THREE.MathUtils.degToRad(ang);
        g.moveTo(-Math.sin(r) * l, y - Math.cos(r) * l); g.lineTo(0, y); g.lineTo(Math.sin(r) * l, y - Math.cos(r) * l);
      }
      g.stroke(); g.restore();
    }
    if (d.hex) {
      g.beginPath();
      for (let a = 0; a < 6; a++) { const t = (a * Math.PI) / 3; g.lineTo(Math.sin(t) * R * d.hex, -Math.cos(t) * R * d.hex); }
      g.closePath(); g.stroke();
    }
    g.restore();
  });
  /* the heart: the same curve the tree becomes, as a fine outline with a faint fill */
  g.save();
  g.translate(S / 2, S + S / 2);
  g.beginPath();
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * TAU, sn = Math.sin(t), k = S * 0.0255;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5;
    g.lineTo(16 * sn * sn * sn * k, -y * k);
  }
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.14)'; g.fill();
  g.lineWidth = 7; g.stroke();
  g.restore();
  return new THREE.CanvasTexture(cv);
})();

/* the crystals drift down through a box that rides ahead of the camera, each turning slowly */
const flakeBox = { uBoxC: { value: new THREE.Vector3() }, uFlakes: { value: flakeAtlas } };
bgLayer(170, (o) => {
  o.p.set(rand(), rand(), rand());
  o.size = rand() < 0.15 ? rr(0.38, 0.56) : rr(0.15, 0.36);
  o.speed = rr(0.3, 0.65); o.phase = rand();
  o.c.copy(rand() < 0.7 ? WHITE : PALE).multiplyScalar(rr(0.42, 0.7));
}, BG_HEAD + BOX_WRAP + /* glsl */`
  const vec3 FSIZE = vec3(36.0, 24.0, 36.0);
  varying float vRot, vIdx;
  void main() {
    vec3 p = position * FSIZE;
    p.y -= uTime * aSpeed;
    p.x += sin(uTime * 0.35 * aSpeed + aPhase * 6.2831853) * 0.9 + uTime * 0.08;
    p.z += cos(uTime * 0.3 * aSpeed + aPhase * 10.0) * 0.6;
    float edge = wrapBox(p, FSIZE);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    gl_PointSize = min(aSize * uScale / max(depth, 0.5), 240.0);
    float tw = 0.7 + 0.3 * sin(uTime * (1.1 + aSpeed) + aPhase * 40.0);
    vAlpha = uFade * tw * (1.0 - smoothstep(0.8, 1.0, edge)) * smoothstep(2.2, 4.5, depth);
    /* about one crystal in twenty-five is a little pink heart, which sways instead of spinning */
    float heart = step(fract(aPhase * 53.0), 0.04);
    vRot = heart > 0.5 ? 0.3 * sin(uTime * 0.7 + aPhase * 30.0) : aPhase * 6.2831853 + uTime * (aSpeed - 0.47) * 1.2;
    vIdx = heart > 0.5 ? 4.0 : floor(fract(aPhase * 17.0) * 4.0);
    vColor = mix(aColor, vec3(1.0, 0.6, 0.76) * 0.66, heart);
    gl_Position = projectionMatrix * mv;
    ${CULL}
  }`, /* glsl */`
  uniform sampler2D uFlakes;
  varying vec3 vColor; varying float vAlpha;
  varying float vRot, vIdx;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float cs = cos(vRot), sn = sin(vRot);
    c = mat2(cs, sn, -sn, cs) * c + 0.5;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) discard;
    vec2 cell = vIdx > 3.5 ? vec2(0.0, 1.0) : vec2(vIdx, 0.0);
    float m = texture2D(uFlakes, vec2((cell.x + c.x) * 0.25, 1.0 - (cell.y + c.y) * 0.5)).a;
    gl_FragColor = vec4(vColor * m * vAlpha, 1.0);
  }`, flakeBox);

/* shooting stars: a head with a pink-tinted tail made of points */
const meteorGeo = new THREE.BufferGeometry();
{
  const n = 110, T = new Float32Array(n);
  for (let i = 0; i < n; i++) T[i] = i / (n - 1);
  meteorGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  meteorGeo.setAttribute('aT', new THREE.BufferAttribute(T, 1));
}
const meteors = [0, 1, 2].map(() => {
  const u = { uHead: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(1, 0, 0) }, uLen: { value: 0 }, uAlpha: { value: 0 }, uScale: uniforms.uScale };
  const pts = new THREE.Points(meteorGeo, new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform vec3 uHead, uDir; uniform float uLen, uAlpha, uScale;
      attribute float aT;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(uHead - uDir * aT * uLen, 1.0);
        float ps = mix(0.11, 0.03, aT) * uScale / -mv.z;
        gl_PointSize = max(ps, 1.0);
        vAlpha = uAlpha * pow(1.0 - aT, 1.7) * min(1.0, ps);
        vColor = mix(vec3(1.0, 0.97, 0.99), vec3(1.0, 0.55, 0.78), aT) * 0.42;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: DOT_FRAG,
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  return { u, active: false, t: 0, life: 1, speed: 20, head0: new THREE.Vector3(), dir: new THREE.Vector3() };
});
let nextMeteor = REDUCED ? Infinity : 8.5, meteorBurst = 0;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
function updateBackground(dt) {
  /* the snow boxes ride along ahead of the camera */
  camera.getWorldDirection(_f);
  snowBox.uBoxC.value.copy(camera.position).addScaledVector(_f, 16);
  flakeBox.uBoxC.value.copy(camera.position).addScaledVector(_f, 13);

  nextMeteor -= dt;
  if (nextMeteor <= 0) {
    const m = meteors.find((x) => !x.active);
    if (m) {
      /* start in the upper part of whatever the camera is looking at, and streak across it */
      _r.crossVectors(_f, camera.up).normalize();
      _u.crossVectors(_r, _f);
      const th = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), side = rand() < 0.5 ? -1 : 1, d = rr(30, 44);
      m.head0.copy(camera.position).addScaledVector(_f, d)
        .addScaledVector(_r, -side * rr(0.1, 0.9) * th * camera.aspect * d)
        .addScaledVector(_u, rr(0.25, 0.8) * th * d);
      m.dir.copy(_r).multiplyScalar(side * rr(0.75, 1)).addScaledVector(_u, -rr(0.32, 0.58)).addScaledVector(_f, rr(-0.15, 0.15)).normalize();
      m.speed = rr(17, 25); m.life = rr(0.9, 1.5); m.t = 0; m.active = true;
    }
    /* a burst (the Christmas moment) sends a few in quick succession */
    if (meteorBurst > 0) { meteorBurst--; nextMeteor = 0.45; } else nextMeteor = rr(3.5, 8.5);
  }
  for (const m of meteors) {
    if (!m.active) continue;
    m.t += dt;
    const f = m.t / m.life;
    if (f >= 1) { m.active = false; m.u.uAlpha.value = 0; continue; }
    m.u.uHead.value.copy(m.head0).addScaledVector(m.dir, m.speed * m.t);
    m.u.uDir.value.copy(m.dir);
    m.u.uLen.value = Math.min(1, m.t * 2.2) * 8.5;
    m.u.uAlpha.value = Math.sin(Math.PI * f) * snowUniforms.uFade.value;
  }
}

/* ---------- post-processing: a soft bloom, nothing else ---------- */
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.0, 0.22);
/* keep the glow tight: the widest blur levels otherwise wash the whole screen grey */
bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.7, 0.36, 0.1, 0.02];
composer.addPass(bloom);
composer.addPass(new OutputPass());
/* levels: crush the faint glow floor to true black so the stage stays clean */
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec3 c = texture2D(tDiffuse, vUv).rgb; c = clamp((c - 0.02) / 0.98, 0.0, 1.0); gl_FragColor = vec4(c, 1.0); }',
}));

/* ---------- layout: tree right of centre on wide screens, lower-centre on phones ---------- */
let camDist = 14, portrait = false, orbitRate = 0.12;
let LOOK_Y = 3.1;
function layout() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight), aspect = w / h;
  portrait = aspect < 0.9;
  /* a slightly wider lens on phones lets the camera sit closer, so circling shows more depth */
  camera.fov = portrait ? 44 : 36;
  camera.aspect = aspect;
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camDist = portrait ? Math.max(9.4 / (2 * t), 7.4 / (2 * t * aspect)) : Math.max(9.8 / (2 * t), 9 / (2 * t * aspect * 0.62));
  LOOK_Y = portrait ? 2.9 : 3.25;
  /* the sky wheels past at the orbit rate, so circle a little slower on narrow screens */
  orbitRate = REDUCED ? 0 : portrait ? 0.085 : 0.12;
  camera.setViewOffset(w, h, portrait ? 0 : -w * 0.15, portrait ? -h * 0.1 : 0, w, h);
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  uniforms.uScale.value = (h * dpr) / (2 * t);
}
layout();
addEventListener('resize', layout);

/* ---------- the camera: glides in from far above while the tree gathers, then circles it for good,
   drifting in close to the star every so often ---------- */
const FLY_TIME = 8, FLY_FROM = 3, FLY_SWEEP = 1.7, SWELL_EVERY = 36, ZOOM_MIN = 0.42, ZOOM_MAX = 1.8;
const DIR = -1; /* circle the same way the tree used to turn */
const rig = { az: 0.6, azVel: 0, tilt: 0, zoom: 1, zoomTo: 1, idle: 99, auto: 1, clock: 0, camAz: 0, camEl: 0 };
const target = new THREE.Vector3();
/* the star's secret: 0 = tree, 1 = heart */
let heartGoal = 0, heartP = 0, heartAmt = 0;

function moveCamera(dt) {
  rig.idle += dt;
  /* hand the camera back to the slow orbit a few seconds after the last touch */
  rig.auto = lerp(rig.auto, rig.idle > 3 ? 1 : 0, 1 - Math.exp(-dt * 0.9));
  rig.clock += dt * rig.auto;
  if (rig.idle > 9) {
    const relax = 1 - Math.exp(-dt * 0.3);
    rig.zoomTo = lerp(rig.zoomTo, 1, relax);
    rig.tilt = lerp(rig.tilt, 0, relax);
  }
  rig.zoom = lerp(rig.zoom, rig.zoomTo, 1 - Math.exp(-dt * 6));
  if (!dragging) { rig.az += rig.azVel * dt; rig.azVel *= Math.exp(-dt * 1.5); }
  rig.az += DIR * orbitRate * rig.auto * dt;

  /* the opening: a long glide in from far above, sweeping round as it comes */
  const fly = REDUCED ? 1 : easeInOut(clamp((time - 0.2) / FLY_TIME, 0, 1));
  /* the swell: rest wide for a while, then drift in close to the top of the tree and back out */
  const u = (Math.max(0, rig.clock - FLY_TIME + 7) / SWELL_EVERY) % 1;
  /* while the heart shows, the camera holds back to frame it (a touch closer on wide screens) */
  const swell = (REDUCED || u < 0.42 ? 0 : Math.pow(Math.sin((Math.PI * (u - 0.42)) / 0.58), 2)) * (1 - heartAmt);
  const dist = clamp(camDist * lerp(FLY_FROM, 1, fly) * lerp(1, 0.58, swell) * lerp(1, portrait ? 1 : 0.9, heartAmt) * rig.zoom, 5.5, camDist * 4);
  /* the closer the camera, the higher it looks, so the star (or the heart) stays in frame */
  const near = smooth(0, 1, (1 - dist / camDist) / 0.42);
  target.set(0, lerp(LOOK_Y, lerp(H * 0.75, uniforms.uHeartY.value, heartAmt), near), 0);

  parallax.lerp(pointer, 1 - Math.exp(-dt * 1.5));
  const el = clamp(lerp(0.72, 0.22 + (REDUCED ? 0 : 0.06 * Math.sin(rig.clock * 0.146)), fly) + 0.05 * near + rig.tilt + parallax.y * 0.03, -0.12, 1.15);
  const az = rig.az + DIR * FLY_SWEEP * (fly - 1) + parallax.x * 0.05;
  rig.camAz = az; rig.camEl = el;
  const hr = Math.cos(el) * dist;
  camera.position.set(Math.sin(az) * hr, target.y + Math.sin(el) * dist, Math.cos(az) * hr);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

/* ---------- interaction: drag to go round, pinch or scroll to zoom, tap to scatter ---------- */
const pointers = new Map();
let dragging = false, moved = false, downX = 0, downY = 0, downTime = 0, lastMove = 0, pinchFrom = 1, zoomFrom = 1, scatterT = -1;
const pointer = new THREE.Vector2(), parallax = new THREE.Vector2();
const spread = () => { const [a, b] = pointers.values(); return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)); };
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  rig.idle = 0;
  if (pointers.size === 1) {
    dragging = true; moved = false; rig.azVel = 0;
    downX = e.clientX; downY = e.clientY; downTime = lastMove = performance.now();
    canvas.classList.add('dragging');
  } else { moved = true; pinchFrom = spread(); zoomFrom = rig.zoomTo; }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (!pointers.size) canvas.classList.toggle('over-star', onStar(e.clientX, e.clientY));
  }
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  rig.idle = 0;
  if (pointers.size > 1) { rig.zoomTo = clamp((zoomFrom * pinchFrom) / spread(), ZOOM_MIN, ZOOM_MAX); return; }
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) moved = true;
  const now = performance.now(), da = -(dx / innerWidth) * 3.4;
  rig.az += da;
  rig.azVel = lerp(rig.azVel, da / Math.max(0.008, (now - lastMove) / 1000), 0.5);
  rig.tilt = clamp(rig.tilt + (dy / innerHeight) * 1.6, -0.3, 0.75);
  lastMove = now;
});
const endPointer = (e) => {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size) { lastMove = performance.now(); return; }
  dragging = false; canvas.classList.remove('dragging');
  if (performance.now() - lastMove > 90) rig.azVel = 0;
  if (!moved && performance.now() - downTime < 400) onTap(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  rig.idle = 0;
  const step = e.deltaY * (e.deltaMode === 1 ? 16 : 1) * (e.ctrlKey ? 0.01 : 0.0015);
  rig.zoomTo = clamp(rig.zoomTo * Math.exp(step), ZOOM_MIN, ZOOM_MAX);
}, { passive: false });
/* Safari's own pinch-to-zoom would scale the page instead of the scene */
document.addEventListener('gesturestart', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && secret?.isOpen()) { secret.close(); return; }
  if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); if (secret?.isOpen()) secret.close(); else scatter(); return; }
  const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], '+': [0, -1], '=': [0, -1], '-': [0, 1] }[e.key];
  if (!k) return;
  e.preventDefault(); rig.idle = 0;
  rig.azVel += k[0] * 0.6;
  rig.zoomTo = clamp(rig.zoomTo * Math.exp(k[1] * 0.18), ZOOM_MIN, ZOOM_MAX);
});
function scatter() { if (scatterT < 0 || scatterT > 1.2) { scatterT = 0; rig.azVel += DIR * 0.35; } }
/* when the countdown reaches Christmas Day: the tree bursts and a few shooting stars fall */
addEventListener('christmas', () => { secret?.close(); scatter(); if (!REDUCED) { meteorBurst = 2; nextMeteor = 0; } });

/* ---------- the star's secret: tap the star and the tree becomes a heart, with a message ---------- */
const secret = window.__secret;
const _sp = new THREE.Vector3(), _sv = new THREE.Vector3(), _he = new THREE.Euler(), _hm = new THREE.Matrix4();
let starReady = false, secretFound = false, starFlash = 0, backHintShown = false;
/* where the star is on screen, and how close a tap has to land (never smaller than a fingertip) */
function starScreen() {
  _sp.copy(glint.position);
  tree.localToWorld(_sp);
  const depth = -_sv.copy(_sp).applyMatrix4(camera.matrixWorldInverse).z;
  if (depth < 0.5) return null;
  _sp.project(camera);
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight), t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  /* the target is the star's glow (0.6 units round it), so a tap on the tree just below still scatters it */
  return { x: (_sp.x + 1) * 0.5 * w, y: (1 - _sp.y) * 0.5 * h, r: Math.max(38, (0.3 * h) / (t * depth)) };
}
function onStar(x, y) {
  if (!secret || !starReady || heartGoal) return false;
  const s = starScreen();
  return !!s && Math.hypot(x - s.x, y - s.y) < s.r;
}
function onTap(x, y) {
  if (secret?.isOpen()) secret.close();
  else if (onStar(x, y)) secret.open();
  else scatter();
}
/* a heartbeat: a strong beat and a softer one, about fifty a minute */
const beatAt = (t) => { const p = (t / 1.2) % 1; return Math.exp(-Math.pow((p - 0.06) / 0.045, 2)) + 0.6 * Math.exp(-Math.pow((p - 0.27) / 0.055, 2)); };

/* ---------- the inscription fades in as the camera arrives; quiet hints at the bottom ---------- */
const hint = document.getElementById('hint');
const fine = matchMedia('(pointer: fine)').matches;
let hintTimer = 0;
function showHint(text, ms) {
  hint.textContent = text;
  hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove('show'), ms);
}
setTimeout(() => document.body.classList.add('ready'), REDUCED ? 0 : 4500);
setTimeout(() => { if (!heartGoal) showHint(fine ? 'drag to go around · scroll to zoom · click to scatter' : 'drag to go around · pinch to zoom · tap to scatter', 7000); }, REDUCED ? 800 : 9000);
/* until she finds it, a nudge toward the star now and then */
const nudge = () => { if (secretFound) return; showHint('the star is keeping a secret for you', 7000); setTimeout(nudge, 80000); };
setTimeout(nudge, REDUCED ? 20000 : 30000);

addEventListener('secretchange', (e) => {
  heartGoal = e.detail.open ? 1 : 0;
  canvas.classList.remove('over-star');
  if (!e.detail.open) { if (hint.textContent.includes('go back')) hint.classList.remove('show'); return; }
  secretFound = true; starFlash = 1; rig.idle = Math.min(rig.idle, 2);
  hint.classList.remove('show');
  if (!backHintShown) {
    backHintShown = true;
    setTimeout(() => { if (heartGoal) showHint(fine ? 'click anywhere to go back to the tree' : 'tap anywhere to go back to the tree', 5000); }, 9000);
  }
});
/* it may have opened before this part loaded (on 8 December it opens by itself) */
if (secret?.isOpen()) { heartGoal = 1; secretFound = true; }

/* ---------- animation loop ---------- */
const clock = new THREE.Clock();
let time = 0, frames = 0, slowFrames = 0;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  /* with reduced motion the camera stays put unless dragged, and the tree turns slowly instead */
  if (REDUCED) tree.rotation.y += 0.08 * dt;

  const intro = REDUCED ? 1.3 : clamp((time - 0.4) / 4.4, 0, 1) * 1.3;
  uniforms.uIntro.value = intro;
  uniforms.uTime.value = time;
  uniforms.uPulse.value = (time * 0.045) % 1;
  snowUniforms.uTime.value = time;
  snowUniforms.uFade.value = REDUCED ? 1 : smooth(0, 1.8, time);
  /* the heart forms over a few seconds and melts back a little faster */
  heartP = heartGoal ? Math.min(1, heartP + dt / (REDUCED ? 0.8 : 2.8)) : Math.max(0, heartP - dt / (REDUCED ? 0.6 : 2.2));
  heartAmt = easeInOut(heartP);
  moveCamera(dt);
  updateBackground(dt);
  uniforms.uHeart.value = heartAmt;
  uniforms.uBeat.value = REDUCED ? 0 : beatAt(time) * smooth(0.6, 1, heartAmt);
  if (heartAmt > 0) {
    /* it always faces the camera, tipped back toward it and swaying a little so it reads as solid */
    _he.set(-rig.camEl * 0.9, rig.camAz - tree.rotation.y + (REDUCED ? 0 : 0.32 * Math.sin(time * 0.42)), 0, 'YXZ');
    uniforms.uHRot.value.setFromMatrix4(_hm.makeRotationFromEuler(_he));
  }

  if (scatterT >= 0) {
    scatterT += dt;
    const up = 0.4, down = 2.6;
    uniforms.uScatter.value = scatterT < up ? easeOut(scatterT / up) : 1 - easeInOut(Math.min(1, (scatterT - up) / down));
    if (scatterT > up + down) { scatterT = -1; uniforms.uScatter.value = 0; }
  }

  const reveal = REDUCED ? 1 : smooth(3.6, 5.4, time);
  starReady = reveal > 0.6;
  /* every so often the star swells a little, as if it wants to be tapped; tapped, it flares, then
     fades as the heart takes its place */
  const beckon = REDUCED ? 0 : Math.pow(Math.max(0, Math.sin(((time - 20) * TAU) / 11)), 24) * smooth(18, 21, time) * (secretFound ? 0.5 : 1);
  starFlash = Math.max(0, starFlash - dt * 1.4);
  const flare = starFlash > 0 ? Math.sin(Math.PI * (1 - starFlash)) : 0;
  glint.material.opacity = reveal * (0.75 + 0.25 * Math.sin(time * 1.6) + 0.3 * beckon + 0.6 * flare) * (1 - uniforms.uScatter.value * 0.8) * (1 - heartAmt);
  glint.material.rotation = Math.sin(time * 0.25) * 0.15 + flare * 0.5;
  glint.scale.setScalar((1.2 + 0.12 * Math.sin(time * 1.6)) * (1 + 0.45 * beckon + 1.3 * flare));
  haze.material.opacity = 0.03 * smooth(1.5, 4.5, time);

  composer.render();

  frames++;
  if (frames > 90 && dt > 0.026) slowFrames++;
  if (frames % 120 === 0) {
    if (slowFrames > 50 && dpr > 1) { dpr = Math.max(1, dpr - 0.35); layout(); }
    slowFrames = 0;
  }
});
window.__treeReady = true;
