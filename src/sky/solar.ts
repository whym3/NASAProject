// The Solar System in 3D, for the full-screen view: the Sun, the planets where they are today on
// their orbits, the small bodies SPHEREx photographed where it saw them, and the real bright
// stars far behind. Distances are true to scale; the bodies are drawn far larger than life.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { radecToVec } from './project';

export interface Planet { id: string; name: string; epochJd: number; a: number; e: number; i: number; node: number; peri: number; meanAnomaly: number; meanMotion: number }
export interface SolarData { credit: string; planets: Planet[]; kinds: string[]; xyz: number[]; kind: number[]; names: string[]; radec: number[]; mjd: number[] }

/** Something chosen in the view. `ra`/`dec`: where it is in our sky (for a small body, where SPHEREx saw it). */
export interface Picked { kind: 'sun' | 'planet' | 'small' | 'star'; id: string; name: string; type: string; ra: number; dec: number; mjd?: number; mag?: number; at: THREE.Vector3 }

const DEG = Math.PI / 180;
const OBLIQUITY = 23.4392911 * DEG;
const AU = 10; // scene units per astronomical unit

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

export interface Solar {
  /** Screen position of the Sun and each planet (x is NaN when behind the camera), and its distance from the camera. */
  labels(): { id: string; name: string; x: number; y: number; far: number }[];
  /** What is drawn under a point of the canvas (CSS pixels), if anything: planets first, then small bodies, then stars. */
  pick(x: number, y: number): Picked | null;
  /** Canvas position (CSS pixels) of a point of the scene, or null when it is behind the camera. */
  project(at: THREE.Vector3): { x: number; y: number } | null;
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

  // The Sun: lit from within, with a soft halo, and the only light in the scene.
  const sun = new THREE.Mesh(keep(new THREE.SphereGeometry(1.7, 48, 24)), keep(new THREE.MeshBasicMaterial({ color: 0xffd27a })));
  scene.add(sun);
  const halo = document.createElement('canvas');
  halo.width = halo.height = 128;
  const hg = halo.getContext('2d')!, rg = hg.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,214,140,0.9)'); rg.addColorStop(0.25, 'rgba(255,170,80,0.35)'); rg.addColorStop(1, 'rgba(255,140,60,0)');
  hg.fillStyle = rg; hg.fillRect(0, 0, 128, 128);
  const glow = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(new THREE.CanvasTexture(halo)), blending: THREE.AdditiveBlending, depthWrite: false })));
  glow.scale.setScalar(14);
  scene.add(glow);
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
    scene.add(mesh);
    bodies.push({ id: el.id, name: el.name, at: mesh.position, mesh, r: look.r, helio });
    const path = Array.from({ length: 256 }, (_, k) => toScene(planetAt(el, 0, (k / 256) * Math.PI * 2)));
    const line = new THREE.LineLoop(
      keep(new THREE.BufferGeometry().setFromPoints(path)),
      keep(new THREE.LineBasicMaterial({ color: el.id === 'earth' ? 0x7fb2ff : 0x9aa4b4, transparent: true, opacity: el.id === 'earth' ? 0.7 : 0.28 })),
    );
    scene.add(line);
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
  scene.add(new THREE.Points(keep(rocks), keep(new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }))));

  // The real stars, on a sphere far beyond everything, in their true directions.
  let starPos: Float32Array | null = null;
  if (stars) {
    const m = stars.length / 4, sp = new Float32Array(m * 3), sc = new Float32Array(m * 3);
    const ce = Math.cos(OBLIQUITY), se = Math.sin(OBLIQUITY);
    for (let k = 0; k < m; k++) {
      const [x, y, z] = radecToVec(stars[k * 4], stars[k * 4 + 1]); // equatorial unit vector
      toScene([x, y * ce + z * se, -y * se + z * ce], 9000).toArray(sp, k * 3);
      const b = Math.min(1, Math.max(0.08, (6.5 - stars[k * 4 + 2]) / 7));
      sc[k * 3] = sc[k * 3 + 1] = sc[k * 3 + 2] = b;
    }
    starPos = sp;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    g.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    scene.add(new THREE.Points(keep(g), keep(new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }))));
  }

  // Drag to turn around the Sun, wheel or pinch to zoom; arrow keys with Shift turn, without pan.
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 6;
  controls.maxDistance = 1500;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.25;
  controls.listenToKeyEvents(keys);
  const stop = () => { controls.autoRotate = false; };
  controls.addEventListener('start', stop);

  renderer.setAnimationLoop(() => {
    if (document.hidden) return;
    for (const b of bodies) b.mesh.rotation.y += reduced ? 0 : 0.004;
    controls.update();
    renderer.render(scene, camera);
  });

  const v = new THREE.Vector3();
  const project = (at: THREE.Vector3) => {
    v.copy(at).project(camera);
    return v.z < 1 ? { x: ((v.x + 1) * canvas.clientWidth) / 2, y: ((1 - v.y) * canvas.clientHeight) / 2 } : null;
  };
  // Nearest of a flat list of scene positions to (x, y), within `reach` pixels.
  const nearest = (list: Float32Array, x: number, y: number, reach: number) => {
    let best = -1, bd = reach;
    for (let k = 0; k < list.length / 3; k++) {
      const q = project(v.fromArray(list, k * 3));
      const d = q ? Math.hypot(q.x - x, q.y - y) : Infinity;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  const earth = bodies.find((b) => b.id === 'earth')?.helio ?? [0, 0, 0];
  const px = () => canvas.clientHeight / 2 / Math.tan((camera.fov * DEG) / 2); // pixels per unit at unit distance
  const pickAt = (x: number, y: number): Picked | null => {
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
    const j = starPos && stars ? nearest(starPos, x, y, 8) : -1;
    if (j >= 0 && stars && starPos) {
      return { kind: 'star', id: `st${j}`, name: '', type: 'Star', ra: stars[j * 4], dec: stars[j * 4 + 1], mag: stars[j * 4 + 2], at: new THREE.Vector3().fromArray(starPos, j * 3) };
    }
    return null;
  };
  return {
    pick(x, y) {
      const hit = pickAt(x, y);
      if (hit) stop(); // the view holds still while something is chosen
      return hit;
    },
    project,
    labels() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      return [{ id: 'sun', name: 'Sun', at: sun.position }, ...bodies].map((b) => {
        v.copy(b.at).project(camera);
        const far = camera.position.distanceTo(b.at);
        return { id: b.id, name: b.name, x: v.z < 1 ? (v.x + 1) * w / 2 : NaN, y: (1 - v.y) * h / 2, far };
      });
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
