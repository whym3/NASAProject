// A schematic Milky Way for the galaxy view: a point cloud drawn from a structural model, not a
// map of real stars. The model (bar, two major and two minor arms, the Orion Spur the Sun sits
// in, bulge and disc) follows Blinking Sky's (github.com/Paulhb7/blinking-sky, MIT), turned into
// these axes. Kiloparsecs, origin at the centre: x points from the Sun to the centre, z to the
// north Galactic pole, y toward Galactic longitude 90°. The Sun sits at (-R0, 0, Z0).

const DEG = Math.PI / 180;
export const R0 = 8.2; // the Sun's distance from the centre, kpc (GRAVITY 2019: 8.18)
const Z0 = 0.02; // the Sun's height above the plane, kpc
const DISC = 15.5;
const ARM_START = 4.6; // where the arms leave the ends of the bar
const K = Math.tan(12 * DEG); // pitch of the arms
const BAR = 153 * DEG, BAR_HALF = 4.5; // near end of the bar at positive longitude, 27° from the Sun–centre line
// Scutum–Centaurus and Perseus are the major arms; Norma and Sagittarius–Carina the minor ones.
const ARMS = [{ phase: 153 * DEG, weight: 0.32 }, { phase: -27 * DEG, weight: 0.32 }, { phase: 63 * DEG, weight: 0.18 }, { phase: 243 * DEG, weight: 0.18 }];
const SPUR = { radius: 8.35, inner: 7.4, outer: 9.3 }; // the Orion Spur, through the Sun

/** Angle of an arm at radius r. It grows outward: trailing arms for the Milky Way's clockwise turn seen from the north. */
export const armAngle = (phase: number, r: number) => phase + Math.log(r / ARM_START) / K;
const spurAngle = (r: number) => Math.PI + Math.log(r / SPUR.radius) / K;

/** `n` points of the galaxy (kpc) with colours (linear RGB, brightness folded in). None within 0.3 kpc of the Sun. */
export function buildGalaxy(n: number) {
  let seed = 20261118; // seeded, so the galaxy looks the same on every visit
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const radius = (min: number, max: number, scale: number) => min - scale * Math.log(1 - rnd() * (1 - Math.exp(-(max - min) / scale)));
  const arm = () => { let u = rnd(); for (const a of ARMS) { u -= a.weight; if (u <= 0) return a; } return ARMS[0]; };
  // A point scattered about an arm's centre line; `off` is how far out it lies, 0 to 1.
  const along = (r: number, phi: number, width: number, height: number) => {
    const dr = gauss(), dp = gauss(), rr = r + dr * width, pp = phi + (dp * width) / r;
    return { p: [rr * Math.cos(pp), rr * Math.sin(pp), gauss() * height], off: Math.min(1, Math.hypot(dr, dp) / 2.5) };
  };
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const cb = Math.cos(BAR), sb = Math.sin(BAR);
  let i = 0;
  while (i < n) {
    const u = rnd(), f = 0.55 + 0.45 * rnd();
    let p: number[], c: number[];
    if (u < 0.07) { // the bulge: old, warm stars
      p = [gauss() * 0.7, gauss() * 0.7, gauss() * 0.45];
      c = [1.0 * f, 0.8 * f, 0.55 * f];
    } else if (u < 0.17) { // the bar
      const a = Math.max(-BAR_HALF, Math.min(BAR_HALF, gauss() * 2)), s = gauss() * 0.55;
      p = [a * cb - s * sb, a * sb + s * cb, gauss() * 0.25];
      c = [1.0 * f, 0.84 * f, 0.62 * f];
    } else if (u < 0.42) { // the disc between the arms: fainter, older stars
      const r = radius(1, DISC + 0.5, 3.5), th = rnd() * 2 * Math.PI;
      p = [r * Math.cos(th), r * Math.sin(th), gauss() * (0.12 + 0.01 * r)];
      c = [0.95 * f * 0.45, 0.9 * f * 0.45, 0.82 * f * 0.45];
    } else if (u < 0.45) { // the Orion Spur
      const r = SPUR.inner + rnd() * (SPUR.outer - SPUR.inner);
      p = along(r, spurAngle(r), 0.18, 0.08).p;
      c = [0.7 * f, 0.8 * f, 1.0 * f];
    } else { // the arms: young blue-white stars, bright along the middle, and pink glowing gas now and then
      const r = radius(ARM_START, DISC, 4), q = along(r, armAngle(arm().phase, r), 0.22 + 0.035 * r, 0.08 + 0.008 * r);
      p = q.p;
      const b = f * (1 - 0.55 * q.off);
      c = rnd() < 0.05 ? [1.0 * b, 0.42 * b, 0.6 * b] : [0.66 * b, 0.78 * b, 1.0 * b];
    }
    if (Math.hypot(p[0] + R0, p[1], p[2] - Z0) < 0.3) continue; // the Sun's own neighbourhood stays clear: the Solar System sits there
    pos.set(p, i * 3);
    col.set(c, i * 3);
    i++;
  }
  return { pos, col };
}

/** The Sun, in these axes. */
export const SUN: [number, number, number] = [-R0, 0, Z0];

/** Real objects in and around the Milky Way, placed by their sky position (J2000, degrees) and distance (kpc, rounded published values). */
export interface Landmark { name: string; type: string; ra: number; dec: number; kpc: number; note: string }
export const LANDMARKS: Landmark[] = [
  { name: 'Sagittarius A*', type: 'Black hole', ra: 266.41684, dec: -29.00781, kpc: 8.18, note: 'The black hole at the centre of the Milky Way, four million times the mass of the Sun. Dust hides it from visible light; infrared, like SPHEREx sees, gets through.' },
  { name: 'Orion Nebula', type: 'Star-forming nebula', ra: 83.822, dec: -5.391, kpc: 0.41, note: 'The nearest big nursery of stars, in our own arm of the galaxy.' },
  { name: 'Pleiades', type: 'Open star cluster', ra: 56.75, dec: 24.117, kpc: 0.136, note: 'A young cluster of hot blue stars, close enough to see without a telescope.' },
  { name: 'Lagoon Nebula', type: 'Star-forming nebula', ra: 270.904, dec: -24.387, kpc: 1.25, note: 'A cloud of glowing gas in the next arm in, toward the centre.' },
  { name: 'Eagle Nebula', type: 'Star-forming nebula', ra: 274.7, dec: -13.807, kpc: 1.74, note: 'Home of the Pillars of Creation, columns of gas where stars are forming.' },
  { name: 'Carina Nebula', type: 'Star-forming nebula', ra: 161.265, dec: -59.867, kpc: 2.3, note: 'One of the largest star-forming regions in the galaxy, around the giant star Eta Carinae.' },
  { name: 'Crab Nebula', type: 'Supernova remnant', ra: 83.633, dec: 22.0145, kpc: 2.0, note: 'What is left of a star seen to explode in 1054, with a spinning neutron star at its heart.' },
  { name: 'Cassiopeia A', type: 'Supernova remnant', ra: 350.8584, dec: 58.8117, kpc: 3.4, note: 'The youngest known supernova remnant in the galaxy, about 350 years old.' },
  { name: 'Cygnus X-1', type: 'Black hole and star', ra: 299.5903, dec: 35.2016, kpc: 2.22, note: 'The first black hole ever identified, pulling gas from a giant companion star.' },
  { name: 'Omega Centauri', type: 'Globular cluster', ra: 201.697, dec: -47.4795, kpc: 5.43, note: 'About ten million old stars in one ball: the biggest cluster of the Milky Way.' },
  { name: '47 Tucanae', type: 'Globular cluster', ra: 6.0236, dec: -72.0813, kpc: 4.5, note: 'A dense, ancient cluster of stars above the plane of the galaxy.' },
  { name: 'M13', type: 'Globular cluster', ra: 250.4235, dec: 36.4613, kpc: 7.1, note: 'The Great Cluster in Hercules: some 300,000 stars, high above the disc.' },
  { name: 'Large Magellanic Cloud', type: 'Satellite galaxy', ra: 80.894, dec: -69.756, kpc: 49.6, note: 'A small galaxy orbiting the Milky Way, outside the disc.' },
  { name: 'Small Magellanic Cloud', type: 'Satellite galaxy', ra: 13.187, dec: -72.829, kpc: 62, note: 'The Large Cloud’s smaller partner, also orbiting the Milky Way.' },
  { name: 'Sagittarius Dwarf', type: 'Satellite galaxy', ra: 283.764, dec: -30.48, kpc: 26, note: 'A small galaxy being torn apart by the Milky Way, on the far side of the centre.' },
];
