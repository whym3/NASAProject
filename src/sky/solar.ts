// The Solar System in 3D, for the full-screen view: the Sun, the planets where they are today on
// their orbits, the small bodies SPHEREx photographed where it saw them, and the real bright
// stars far behind. Distances are true to scale; the bodies are drawn far larger than life.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildGalaxy, LANDMARKS, SUN } from './galaxy';
import { radecToVec } from './project';

export interface Planet { id: string; name: string; epochJd: number; a: number; e: number; i: number; node: number; peri: number; meanAnomaly: number; meanMotion: number }
export interface SolarData { credit: string; planets: Planet[]; kinds: string[]; xyz: number[]; kind: number[]; names: string[]; radec: number[]; mjd: number[] }

/** Something chosen in the view. `ra`/`dec`: where it is in our sky (for a small body, where SPHEREx saw it). */
export interface Picked { kind: 'sun' | 'planet' | 'small' | 'star' | 'place'; id: string; name: string; type: string; ra: number; dec: number; mjd?: number; mag?: number; kpc?: number; note?: string; at: THREE.Vector3 }

const DEG = Math.PI / 180;
const OBLIQUITY = 23.4392911 * DEG;
const AU = 10; // scene units per astronomical unit
const SKY = 9000; // radius of the sphere of stars and constellations, which travels with the camera
const KPC = 1000; // scene units per kiloparsec in the galaxy view. Not the planets' scale (that would be 2e9): the two never show together
const GALAXY_STARS = 70000;

/** Heliocentric ecliptic position (au) from orbital elements, by two-body motion. Pass `E` to trace the orbit instead. */
export function planetAt(el: Planet, jd: number, E?: number): [number, number, number] {
  if (E === undefined) {
    const M = (((el.meanAnomaly + el.meanMotion * (jd - el.epochJd)) % 360) + 360) % 360 * DEG;
    E = M;
    for (let k = 0; k < 12; k++) E -= (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  }
  const x = el.a * (Math.cos(E) - el.e), y = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const w = el.peri * DEG, O = el.node * DEG, i = el.i * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  return [
    (cw * cO - sw * sO * ci) * x + (-sw * cO - cw * sO * ci) * y,
    (cw * sO + sw * cO * ci) * x + (-sw * sO + cw * cO * ci) * y,
    sw * si * x + cw * si * y,
  ];
}

/** Direction of an ecliptic vector as right ascension and declination, in degrees. */
export function eclToRadec([x, y, z]: number[]) {
  const ye = y * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY), ze = y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  return { ra: ((Math.atan2(ye, x) / DEG) + 360) % 360, dec: Math.asin(ze / Math.hypot(x, y, z)) / DEG };
}

/** A direction on the sky (RA, Dec in degrees) as a point on the sky sphere, in scene axes. */
export function skyAt(ra: number, dec: number) {
  const [x, y, z] = radecToVec(ra, dec); // equatorial unit vector
  const ce = Math.cos(OBLIQUITY), se = Math.sin(OBLIQUITY);
  return toScene([x, y * ce + z * se, -y * se + z * ce], SKY);
}

/** The sky map's look as a perspective camera: its direction, north as up, and the vertical field of view that gives
 * the map's scale at the centre (stereographic there: shorter side / 2 / (2 tan(fov / 4)) pixels per radian). */
export function skyCamera(at: SkyLook, width: number, height: number) {
  const fov = (2 * Math.atan((height / Math.min(width, height)) * 2 * Math.tan((at.fov * DEG) / 4))) / DEG;
  return { look: skyAt(at.ra, at.dec).normalize(), up: skyAt(0, 90).normalize(), fov };
}

/** Ecliptic (au) to scene: the plane of the planets is the scene's floor, ecliptic north is up. */
const toScene = ([x, y, z]: number[], s = AU) => new THREE.Vector3(x * s, z * s, -y * s);

// How each body is drawn: size in scene units (not to scale), colour bands from pole to pole.
const LOOK: Record<string, { r: number; bands: string[]; ring?: boolean }> = {
  mercury: { r: 0.35, bands: ['#8c8580', '#a59e97', '#7d7772'] },
  venus: { r: 0.6, bands: ['#e8d6a8', '#d9c08a', '#e8d6a8'] },
  earth: { r: 0.62, bands: ['#e9eef5', '#2f6fb1', '#3c8a4e', '#2f6fb1', '#e9eef5'] },
  mars: { r: 0.45, bands: ['#d8c3b0', '#b5532e', '#9e4426', '#b5532e'] },
  jupiter: { r: 2.1, bands: ['#c9b597', '#e8dcc6', '#b0805a', '#efe6d4', '#a8714c', '#e3d3b8', '#c9b597'] },
  saturn: { r: 1.8, bands: ['#d8c79c', '#e9dcb6', '#c7b07c', '#efe3c2', '#cdb98a'], ring: true },
  uranus: { r: 1.2, bands: ['#a9dbe0', '#bfe6ea', '#a9dbe0'] },
  neptune: { r: 1.15, bands: ['#3f63c9', '#5378dc', '#3a5bbd'] },
  pluto: { r: 0.3, bands: ['#cdb9a2', '#e4d6c3', '#a88f78'] },
};
const KIND_COLOR = ['#8fa3b8', '#c9a56a', '#ff7a59', '#b48cff', '#e8f4ff']; // asteroid, trojan, near-Earth, centaur, comet

function bandTexture(bands: string[]) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 128);
  bands.forEach((b, k) => grad.addColorStop(k / (bands.length - 1), b));
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Where the flat sky map is looking: its centre and its field of view across the shorter side, degrees. */
export interface SkyLook { ra: number; dec: number; fov: number }

export interface Solar {
  /** Screen position of the Sun and each planet (x is NaN when behind the camera or behind the Sun), and its distance from the camera. */
  labels(): { id: string; name: string; x: number; y: number; far: number }[];
  /** What is drawn under a point of the canvas (CSS pixels), if anything: planets first, then small bodies, then stars. */
  pick(x: number, y: number): Picked | null;
  /** Canvas position (CSS pixels) of a point of the scene (`onSky`: of the sky sphere), or null when it is behind the camera. */
  project(at: THREE.Vector3, onSky?: boolean): { x: number; y: number } | null;
  /** Starts the view at the Earth, looking where the sky map looks (the same stars in the same places), with nothing else showing yet. */
  arrive(at: SkyLook): void;
  /** Moves, in one continuous glide, to the Solar System, out to the whole Milky Way, or back to the Earth
   * looking where the sky map looks (`sky`), calling `done` at the end of that last one. */
  setView(view: 'solar' | 'galaxy' | 'sky', at?: SkyLook, done?: () => void): void;
  /** Canvas positions of the Sun and then each landmark in the galaxy view, in LANDMARKS order (x is NaN while the galaxy is not showing). */
  galaxyLabels(): { x: number; y: number }[];
  /** Draws the constellation figures on the sky sphere. */
  setFigures(list: { name: string; ra: number; dec: number; lines: number[][] }[]): void;
  /** Shows or hides the constellation lines. */
  showFigures(on: boolean): void;
  /** Flies close to the Sun or the Earth, and turns around it from then on. */
  focus(id: 'sun' | 'earth'): void;
  /** Canvas position of each figure's name (x is NaN when behind the camera), in the order given. */
  figureLabels(): { x: number; y: number }[];
  /** Multiplies the camera's distance from the Sun by `factor`. */
  zoom(factor: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createSolar(canvas: HTMLCanvasElement, keys: HTMLElement, data: SolarData, stars: Float32Array | null, reduced: boolean): Solar {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x05070d);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 20000);
  camera.position.copy(toScene([0, -2.2, 1.1]).setLength(95)); // a little above the plane, the inner planets in view

  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { own.push(x); return x; };

  // Everything at the scale of the planets, so it can fade out together on the way to the galaxy.
  const solar = new THREE.Group();
  scene.add(solar);

  // The Sun: lit from within, with a soft halo, and the only light in the scene.
  const sun = new THREE.Mesh(keep(new THREE.SphereGeometry(1.7, 48, 24)), keep(new THREE.MeshBasicMaterial({ color: 0xffd27a })));
  solar.add(sun);
  const halo = document.createElement('canvas');
  halo.width = halo.height = 128;
  const hg = halo.getContext('2d')!, rg = hg.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,214,140,0.9)'); rg.addColorStop(0.25, 'rgba(255,170,80,0.35)'); rg.addColorStop(1, 'rgba(255,140,60,0)');
  hg.fillStyle = rg; hg.fillRect(0, 0, 128, 128);
  const glow = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(new THREE.CanvasTexture(halo)), blending: THREE.AdditiveBlending, depthWrite: false })));
  glow.scale.setScalar(14);
  solar.add(glow);
  scene.add(new THREE.PointLight(0xfff1dc, 3.2, 0, 0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.08));

  // The planets, today, each with its orbit.
  const today = Date.now() / 86400000 + 2440587.5;
  const bodies: { id: string; name: string; at: THREE.Vector3; mesh: THREE.Mesh; r: number; helio: number[] }[] = [];
  for (const el of data.planets) {
    const look = LOOK[el.id] ?? { r: 0.4, bands: ['#999', '#bbb'] };
    const mesh = new THREE.Mesh(keep(new THREE.SphereGeometry(look.r, 40, 20)), keep(new THREE.MeshStandardMaterial({ map: keep(bandTexture(look.bands)), roughness: 0.9, metalness: 0 })));
    const helio = planetAt(el, today);
    mesh.position.copy(toScene(helio));
    if (look.ring) {
      const ring = new THREE.Mesh(keep(new THREE.RingGeometry(look.r * 1.3, look.r * 2.3, 96)), keep(new THREE.MeshStandardMaterial({ color: 0xd9c89e, side: THREE.DoubleSide, transparent: true, opacity: 0.7, roughness: 1 })));
      ring.rotation.x = -Math.PI / 2 + 26.7 * DEG; // Saturn's tilt
      mesh.add(ring);
    }
    solar.add(mesh);
    bodies.push({ id: el.id, name: el.name, at: mesh.position, mesh, r: look.r, helio });
    const path = Array.from({ length: 256 }, (_, k) => toScene(planetAt(el, 0, (k / 256) * Math.PI * 2)));
    const line = new THREE.LineLoop(
      keep(new THREE.BufferGeometry().setFromPoints(path)),
      keep(new THREE.LineBasicMaterial({ color: el.id === 'earth' ? 0x7fb2ff : 0x9aa4b4, transparent: true, opacity: el.id === 'earth' ? 0.7 : 0.28 })),
    );
    solar.add(line);
  }

  // The small bodies SPHEREx photographed, where it saw them.
  const n = data.kind.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const palette = KIND_COLOR.map((c) => new THREE.Color(c));
  for (let k = 0; k < n; k++) {
    toScene([data.xyz[k * 3], data.xyz[k * 3 + 1], data.xyz[k * 3 + 2]]).toArray(pos, k * 3);
    palette[data.kind[k]].toArray(col, k * 3);
  }
  const rocks = new THREE.BufferGeometry();
  rocks.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rocks.setAttribute('color', new THREE.BufferAttribute(col, 3));
  solar.add(new THREE.Points(keep(rocks), keep(new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }))));

  // The real stars, on a sphere far beyond everything that moves with the camera, so each stays
  // in its true direction wherever the camera goes (as the real ones do: they are that far away).
  const sky = new THREE.Group();
  scene.add(sky);
  let starPos: Float32Array | null = null;
  const skyFades: { m: THREE.Material & { opacity: number }; base: number; veiled: boolean }[] = [];
  if (stars) {
    const m = stars.length / 4, sp = new Float32Array(m * 3), sc = new Float32Array(m * 3);
    for (let k = 0; k < m; k++) {
      skyAt(stars[k * 4], stars[k * 4 + 1]).toArray(sp, k * 3);
      const b = Math.min(1, Math.max(0.08, (6.5 - stars[k * 4 + 2]) / 7));
      sc[k * 3] = sc[k * 3 + 1] = sc[k * 3 + 2] = b;
    }
    starPos = sp;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    g.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    const mat = keep(new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true }));
    sky.add(new THREE.Points(keep(g), mat));
    skyFades.push({ m: mat, base: 1, veiled: false });
  }
  let figureAt: THREE.Vector3[] = [];
  let figureLines: THREE.LineSegments | null = null;

  // The Milky Way photograph the flat sky map shows, on the inside of the sky sphere, looked up and coloured the
  // same way (see glowFragment in scene.ts). It shows only while this view stands in for the map, from the Earth.
  const bandUniforms = { uMap: { value: null as THREE.Texture | null }, uGlow: { value: 0 }, uCe: { value: Math.cos(OBLIQUITY) }, uSe: { value: Math.sin(OBLIQUITY) } };
  const band = new THREE.Mesh(keep(new THREE.SphereGeometry(SKY * 0.98, 64, 32)), keep(new THREE.ShaderMaterial({
    uniforms: bandUniforms, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uMap; uniform float uGlow, uCe, uSe; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 e = vec3(d.x, -d.z, d.y); // scene to ecliptic axes, undoing toScene
        vec3 q = vec3(e.x, e.y * uCe - e.z * uSe, e.y * uSe + e.z * uCe); // ecliptic to equatorial
        float ra = atan(q.y, q.x), dec = asin(clamp(q.z, -1.0, 1.0));
        vec3 c = texture2D(uMap, vec2(fract(0.5 - ra / 6.2831853), 0.5 + dec / 3.1415927)).rgb;
        float l = dot(c, vec3(0.3, 0.59, 0.11));
        c = clamp(mix(vec3(l), c, 1.7), 0.0, 1.0);
        gl_FragColor = vec4(c * smoothstep(0.05, 0.42, l) * uGlow, 1.0);
      }`,
  })));
  band.renderOrder = -1; // under the stars
  band.visible = false;
  sky.add(band);
  new THREE.TextureLoader().load('/sky/milkyway.webp', (t) => { // already in the browser's cache from the sky map
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    bandUniforms.uMap.value = keep(t);
  });

  // The Milky Way (see galaxy.ts), turned into these axes: its centre toward Sagittarius, its
  // plane tipped about 60° to the planets', as in the real sky. Built the first time it is wanted.
  const toward = skyAt(266.405, -28.936).normalize(), pole = skyAt(192.859, 27.128).normalize();
  const side = new THREE.Vector3().crossVectors(pole, toward); // Galactic longitude 90°
  const fromGalaxy = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(0, 0, 0)
    .addScaledVector(toward, (x - SUN[0]) * KPC).addScaledVector(side, (y - SUN[1]) * KPC).addScaledVector(pole, (z - SUN[2]) * KPC);
  const centre = fromGalaxy(0, 0, 0);
  // Real objects at their measured distances, from the Sun (the scene's origin) along their sky direction.
  const landmarks = LANDMARKS.map((l) => skyAt(l.ra, l.dec).setLength(l.kpc * KPC));
  const galaxyUniforms = { uScale: { value: 1 }, uAlpha: { value: 0 } };
  let galaxy: THREE.Points | null = null;
  const buildMilkyWay = () => {
    if (galaxy) return;
    const { pos: g, col: c } = buildGalaxy(GALAXY_STARS), p = new Float32Array(g.length), w = new THREE.Vector3();
    for (let k = 0; k < g.length; k += 3) fromGalaxy(g[k], g[k + 1], g[k + 2], w).toArray(p, k);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('aCol', new THREE.BufferAttribute(c, 3));
    galaxy = new THREE.Points(keep(geo), keep(new THREE.ShaderMaterial({
      uniforms: galaxyUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      // Each star a soft dot of 1 to 4 pixels: never a blob, however close the camera comes.
      vertexShader: `attribute vec3 aCol; uniform float uScale, uAlpha; varying vec3 vC;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uScale * 90.0 / -mv.z, 1.0, 4.0); vC = aCol * 0.55 * uAlpha; }`,
      fragmentShader: `varying vec3 vC; void main() { float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(vC * a, 1.0); }`,
    })));
    galaxy.frustumCulled = false;
    scene.add(galaxy);
  };

  // How much of each scale shows, from the camera's distance to the Sun: the planets go first,
  // then the sky around us, while the galaxy comes up. The same rule both ways.
  const fades: { m: THREE.Material & { opacity: number }; base: number }[] = [];
  solar.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material & { opacity: number } | undefined;
    if (m && !fades.some((f) => f.m === m)) { m.transparent = true; fades.push({ m, base: m.opacity }); }
  });
  const ramp = (d: number, a: number, b: number) => THREE.MathUtils.smoothstep(Math.log(d), Math.log(a), Math.log(b));
  let solarA = 1, skyA = 1, galaxyA = 0;

  // Drag to turn around the Sun, wheel or pinch to zoom; arrow keys with Shift turn, without pan.
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 6;
  controls.maxDistance = 1500;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.25;
  controls.listenToKeyEvents(keys);
  const stop = () => { controls.autoRotate = false; };
  // A flight to the Sun or the Earth: the point turned around and the distance glide together.
  let fly: { t: number; from: THREE.Vector3; to: THREE.Vector3; d0: number; d1: number } | null = null;
  controls.addEventListener('start', () => { stop(); fly = null; }); // a drag takes over from a flight
  // The move between the scales: the distance grows (or shrinks) by the same factor each moment,
  // the point turned around slides from the Sun to the galaxy's centre in step with it, and the
  // viewing angle swings from the planets' to one high above the Milky Way.
  const solarDir = toScene([0, -2.2, 1.1]).normalize();
  const galaxyDir = new THREE.Vector3().addScaledVector(pole, 0.62).addScaledVector(toward, -0.78).normalize();
  let trip: {
    t: number; from: THREE.Vector3; to: THREE.Vector3; d0: number; d1: number; dir0: THREE.Vector3; dir1: THREE.Vector3;
    fov0: number; fov1: number; up0: THREE.Vector3; up1: THREE.Vector3; veil0: number; end: 'solar' | 'galaxy' | 'sky'; done?: () => void;
  } | null = null;
  // How much of the Solar System's own things show (planets, orbits, small bodies, figure lines): none while the view
  // is standing in for the flat sky map, all once it has pulled away.
  let veil = 1;
  const north = skyAt(0, 90).normalize(), ecliptic = new THREE.Vector3(0, 1, 0);
  // The sky map's look, as a camera at the Earth: the same centre, north up, and the same scale at the centre
  // (stereographic there: shorter side / 2 / (2 tan(fov / 4)) pixels per radian).
  const earthLook = (at: SkyLook) => {
    const { look, fov } = skyCamera(at, canvas.clientWidth || 1, canvas.clientHeight || 1), from = bodies.find((b) => b.id === 'earth')!.at;
    return { target: from.clone().addScaledVector(look, 2), dir: look.clone().negate(), d: 2, fov };
  };
  const smooth = THREE.MathUtils.smoothstep;
  let last = 0;

  renderer.setAnimationLoop((time) => {
    const dt = Math.min(0.1, (time - last) / 1000);
    last = time;
    if (fly) {
      fly.t = reduced ? 1 : Math.min(1, fly.t + dt / 1.8);
      const k = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2; // ease in and out
      const away = camera.position.clone().sub(controls.target).normalize();
      controls.target.lerpVectors(fly.from, fly.to, k);
      camera.position.copy(controls.target).addScaledVector(away, fly.d0 + (fly.d1 - fly.d0) * k);
      if (fly.t >= 1) fly = null;
    }
    if (trip) {
      trip.t = reduced ? 1 : Math.min(1, trip.t + dt / 4);
      const k = trip.t < 0.5 ? 4 * trip.t ** 3 : 1 - (-2 * trip.t + 2) ** 3 / 2;
      const d = trip.d0 * (trip.d1 / trip.d0) ** k;
      controls.target.lerpVectors(trip.from, trip.to, (d - trip.d0) / (trip.d1 - trip.d0));
      // Turn the viewing direction the short way round, even between nearly opposite directions.
      const turn = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(trip.dir0, trip.dir1), k);
      camera.position.copy(controls.target).addScaledVector(trip.dir0.clone().applyQuaternion(turn), d);
      camera.up.lerpVectors(trip.up0, trip.up1, k).normalize();
      camera.fov = trip.fov0 + (trip.fov1 - trip.fov0) * k;
      camera.updateProjectionMatrix();
      // Leaving the sky map, the Solar System's things come up as the camera pulls away; going back, they go first.
      veil = trip.end === 'sky' ? trip.veil0 * (1 - smooth(k, 0.5, 0.9)) : trip.veil0 + (1 - trip.veil0) * smooth(k, 0.08, 0.45);
      if (trip.t >= 1) {
        const { end, done } = trip;
        trip = null;
        if (end === 'sky') done?.(); // stays standing in for the sky map, controls off, until it is taken away
        else {
          Object.assign(controls, end === 'galaxy' ? { minDistance: 2500, maxDistance: 120000 } : { minDistance: 6, maxDistance: 1500 });
          controls.autoRotate = !reduced; // turns slowly until touched
          controls.enabled = true;
        }
      }
    }
    // The fades, and a camera range that suits the scale it is at.
    const dSun = camera.position.length();
    solarA = 1 - ramp(dSun, 1600, 4500);
    skyA = 1 - ramp(dSun, 1800, 5000);
    galaxyA = ramp(dSun, 2200, 9000);
    solar.visible = solarA * veil > 0.005;
    for (const f of fades) f.m.opacity = f.base * solarA * veil;
    sky.visible = skyA > 0.005;
    for (const f of skyFades) f.m.opacity = f.base * skyA * (f.veiled ? veil : 1);
    bandUniforms.uGlow.value = (1 - veil) * skyA;
    band.visible = !!bandUniforms.uMap.value && bandUniforms.uGlow.value > 0.005;
    if (galaxy) { galaxy.visible = galaxyA > 0.005; galaxyUniforms.uAlpha.value = galaxyA; galaxyUniforms.uScale.value = px() * renderer.getPixelRatio(); }
    const near = Math.min(5, Math.max(0.05, dSun / 30000)), far = Math.max(20000, dSun * 3 + 40000);
    if (near !== camera.near || far !== camera.far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
    if (document.hidden) return;
    for (const b of bodies) b.mesh.rotation.y += reduced ? 0 : 0.004;
    controls.update();
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  });

  const v = new THREE.Vector3();
  const project = (at: THREE.Vector3, onSky = false) => {
    v.copy(at);
    if (onSky) v.add(camera.position); // the sky sphere rides with the camera
    v.project(camera);
    return v.z < 1 ? { x: ((v.x + 1) * canvas.clientWidth) / 2, y: ((1 - v.y) * canvas.clientHeight) / 2 } : null;
  };
  // Nearest of a flat list of scene positions to (x, y), within `reach` pixels.
  const nearest = (list: Float32Array, x: number, y: number, reach: number, onSky = false) => {
    let best = -1, bd = reach;
    for (let k = 0; k < list.length / 3; k++) {
      const q = project(v.fromArray(list, k * 3), onSky);
      const d = q ? Math.hypot(q.x - x, q.y - y) : Infinity;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  const earth = bodies.find((b) => b.id === 'earth')?.helio ?? [0, 0, 0];
  const px = (): number => canvas.clientHeight / 2 / Math.tan((camera.fov * DEG) / 2); // pixels per unit at unit distance
  const pickAt = (x: number, y: number): Picked | null => {
    if (trip || veil < 0.5) return null; // nothing to choose on the way, or while standing in for the sky map
    if (galaxyA > 0.5) { // the galaxy view: the Sun, or one of the real objects placed in it
      let best = -1, bd = 14;
      [new THREE.Vector3(), ...landmarks].forEach((at, k) => {
        const q = project(at), d = q ? Math.hypot(q.x - x, q.y - y) : Infinity;
        if (d < bd) { bd = d; best = k; }
      });
      if (best === 0) return { kind: 'sun', id: 'home', name: 'The Sun', type: 'Our star', ra: NaN, dec: NaN, at: new THREE.Vector3() };
      if (best < 0) return null;
      const l = LANDMARKS[best - 1];
      return { kind: 'place', id: `lm${best - 1}`, name: l.name, type: l.type, ra: l.ra, dec: l.dec, kpc: l.kpc, note: l.note, at: landmarks[best - 1].clone() };
    }
    if (solarA < 0.5) return null;
    // The Sun and the planets: anywhere on the disc, or a few pixels off it.
    let hit: Picked | null = null, bd = Infinity;
    for (const b of [{ id: 'sun', name: 'Sun', at: sun.position, r: 1.7, helio: [0, 0, 0] }, ...bodies]) {
      const q = project(b.at);
      if (!q) continue;
      const d = Math.hypot(q.x - x, q.y - y), reach = Math.max(12, (b.r * px()) / camera.position.distanceTo(b.at) + 4);
      if (d > reach || d >= bd) continue;
      bd = d;
      const geo = [b.helio[0] - earth[0], b.helio[1] - earth[1], b.helio[2] - earth[2]];
      const { ra, dec } = b.id === 'earth' ? { ra: NaN, dec: NaN } : eclToRadec(geo);
      hit = { kind: b.id === 'sun' ? 'sun' : 'planet', id: b.id, name: b.name, type: b.id === 'sun' ? 'Star' : b.id === 'pluto' ? 'Dwarf planet' : 'Planet', ra, dec, at: b.at.clone() };
    }
    if (hit) return hit;
    const k = nearest(pos, x, y, 9);
    if (k >= 0) {
      return { kind: 'small', id: `sb${k}`, name: data.names[k], type: data.kinds[data.kind[k]], ra: data.radec[k * 2], dec: data.radec[k * 2 + 1], mjd: data.mjd[k], at: new THREE.Vector3().fromArray(pos, k * 3) };
    }
    const j = starPos && stars ? nearest(starPos, x, y, 8, true) : -1;
    if (j >= 0 && stars && starPos) {
      return { kind: 'star', id: `st${j}`, name: '', type: 'Star', ra: stars[j * 4], dec: stars[j * 4 + 1], mag: stars[j * 4 + 2], at: new THREE.Vector3().fromArray(starPos, j * 3) };
    }
    return null;
  };
  return {
    setFigures(list) {
      const pts: THREE.Vector3[] = [];
      for (const f of list) for (const l of f.lines) for (let i = 0; i + 3 < l.length; i += 2) pts.push(skyAt(l[i], l[i + 1]), skyAt(l[i + 2], l[i + 3]));
      const m = keep(new THREE.LineBasicMaterial({ color: 0x7f9fd6, transparent: true, opacity: 0.32, depthWrite: false }));
      figureLines = new THREE.LineSegments(keep(new THREE.BufferGeometry().setFromPoints(pts)), m);
      skyFades.push({ m, base: 0.32, veiled: true }); // the flat map shows no lines unless asked: they come with the Solar System
      sky.add(figureLines);
      figureAt = list.map((f) => skyAt(f.ra, f.dec));
    },
    showFigures(on) {
      if (figureLines) figureLines.visible = on;
    },
    focus(id) {
      const to = id === 'sun' ? sun.position : bodies.find((b) => b.id === 'earth')?.at;
      if (!to) return;
      stop();
      controls.minDistance = id === 'sun' ? 3 : 1.4; // never inside the body
      fly = { t: 0, from: controls.target.clone(), to, d0: camera.position.distanceTo(controls.target), d1: id === 'sun' ? 7 : 4.5 };
    },
    figureLabels() {
      return figureAt.map((at) => (skyA * veil > 0.3 && project(at, true)) || { x: NaN, y: NaN });
    },
    pick(x, y) {
      const hit = pickAt(x, y);
      if (hit) stop(); // the view holds still while something is chosen
      return hit;
    },
    project,
    labels() {
      const w = canvas.clientWidth, h = canvas.clientHeight, gone = solarA * veil < 0.3;
      const sunFar = camera.position.distanceTo(sun.position), sunR = (1.7 * px()) / sunFar, s0 = project(sun.position);
      return [{ id: 'sun', name: 'Sun', at: sun.position }, ...bodies].map((b) => {
        v.copy(b.at).project(camera);
        const far = camera.position.distanceTo(b.at), x = (v.x + 1) * w / 2, y = (1 - v.y) * h / 2;
        const hid = v.z >= 1 || (b.id !== 'sun' && !!s0 && far > sunFar && Math.hypot(x - s0.x, y - s0.y) < sunR); // behind the camera, or behind the Sun
        return { id: b.id, name: b.name, x: hid || gone ? NaN : x, y, far };
      });
    },
    arrive(at) {
      const e = earthLook(at);
      stop();
      controls.enabled = false;
      controls.target.copy(e.target);
      camera.position.copy(e.target).addScaledVector(e.dir, e.d);
      camera.up.copy(north);
      camera.fov = e.fov;
      camera.updateProjectionMatrix();
      camera.lookAt(e.target);
      veil = 0;
    },
    setView(view, at, done) {
      if (view === 'galaxy') buildMilkyWay();
      stop();
      fly = null;
      controls.enabled = false; // the move runs to its end
      controls.minDistance = 0;
      controls.maxDistance = Infinity;
      const e = view === 'sky' && at ? earthLook(at) : null;
      trip = {
        t: 0, from: controls.target.clone(), d0: camera.position.distanceTo(controls.target),
        dir0: camera.position.clone().sub(controls.target).normalize(), fov0: camera.fov, up0: camera.up.clone(), veil0: veil,
        ...(e ? { to: e.target, d1: e.d, dir1: e.dir, fov1: e.fov, up1: north }
          : view === 'galaxy' ? { to: centre.clone(), d1: 42000, dir1: galaxyDir, fov1: 45, up1: ecliptic }
          : { to: new THREE.Vector3(), d1: 95, dir1: solarDir, fov1: 45, up1: ecliptic }),
        end: e ? 'sky' : view === 'galaxy' ? 'galaxy' : 'solar', done,
      };
    },
    galaxyLabels() {
      const on = galaxyA > 0.5;
      return [new THREE.Vector3(), ...landmarks].map((at) => (on && project(at)) || { x: NaN, y: NaN });
    },
    zoom(f) { stop(); controls.dollyIn(f); }, // multiplies the distance by f: below 1 moves closer
    resize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    dispose() {
      renderer.setAnimationLoop(null);
      controls.dispose();
      own.forEach((o) => o.dispose());
      renderer.dispose();
    },
  };
}
