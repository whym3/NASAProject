import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { toScreen } from '../src/sky/project';
import { eclToRadec, planetAt, skyAt, skyCamera, type SolarData } from '../src/sky/solar';

const data: SolarData = JSON.parse(readFileSync('public/sky/solar.json', 'utf8'));
const el = (id: string) => data.planets.find((p) => p.id === id)!;
const jd = (iso: string) => Date.parse(iso) / 86400000 + 2440587.5;
const lon = ([x, y]: number[]) => ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

describe('planetAt', () => {
  it('puts the Earth opposite the Sun: at the March equinox the Sun is at longitude 0, so the Earth is at 180', () => {
    const p = planetAt(el('earth'), jd('2026-03-20T14:46Z'));
    expect(Math.abs(lon(p) - 180)).toBeLessThan(1);
    expect(Math.hypot(...p)).toBeCloseTo(0.996, 2);
  });
  it('keeps every planet within its perihelion and aphelion', () => {
    for (const p of data.planets) {
      const r = Math.hypot(...planetAt(p, jd('2026-11-18T00:00Z')));
      expect(r).toBeGreaterThanOrEqual(p.a * (1 - p.e) - 1e-9);
      expect(r).toBeLessThanOrEqual(p.a * (1 + p.e) + 1e-9);
    }
  });
  it('puts the Sun where the almanac has it on 18 November 2026 (RA 15h 33m, Dec -19.25)', () => {
    const { ra, dec } = eclToRadec(planetAt(el('earth'), jd('2026-11-18T00:00Z')).map((v) => -v));
    expect(Math.abs(ra - 233.2)).toBeLessThan(0.5);
    expect(Math.abs(dec + 19.25)).toBeLessThan(0.3);
  });
  it('draws the stars and constellations in the same directions as the planets: Earth to Jupiter points at its RA and Dec', () => {
    const t = jd('2026-11-18T00:00Z'), e = planetAt(el('earth'), t), j = planetAt(el('jupiter'), t);
    const g = j.map((v, i) => v - e[i]);
    const { ra, dec } = eclToRadec(g);
    const sky = skyAt(ra, dec).normalize();
    const scene = [g[0], g[2], -g[1]], n = Math.hypot(...scene); // the scene's axes, as in toScene
    expect(sky.x * scene[0] / n + sky.y * scene[1] / n + sky.z * scene[2] / n).toBeGreaterThan(Math.cos(1e-6));
  });
  it('ships a kind, a name, a sky position and a date per small body', () => {
    expect(data.xyz.length).toBe(data.kind.length * 3);
    expect(data.names.length).toBe(data.kind.length);
    expect(data.radec.length).toBe(data.kind.length * 2);
    expect(data.mjd.length).toBe(data.kind.length);
    expect(Math.max(...data.kind)).toBeLessThan(data.kinds.length);
  });
  it('starts the 3D view on the sky map\'s own picture: real stars land on the same pixels near the middle', () => {
    const W = 1440, H = 900, at = { ra: 262, dec: 8, fov: 62 }; // the map's opening view, on Ophiuchus
    const { look, up, fov } = skyCamera(at, W, H);
    const cam = new THREE.PerspectiveCamera(fov, W / H, 0.1, 100);
    cam.up.copy(up);
    cam.lookAt(look);
    cam.updateMatrixWorld();
    const flat = { ...at, width: W, height: H };
    const px = (ra: number, dec: number) => { const v = skyAt(ra, dec).normalize().project(cam); return { x: (v.x + 1) * W / 2, y: (1 - v.y) * H / 2 }; };
    // Barnard's Star (3.5° off centre) and Rasalhague (about 5° off) agree to the pixel. Antares, 37° off, cannot: perspective
    // stretches the edges (r = S tan θ against the map's S·2 tan(θ/2)), which predicts 68 px here.
    for (const [ra, dec, tol] of [[262, 8, 0.5], [269.452, 4.693, 2], [263.734, 12.56, 2], [247.352, -26.432, 75]]) {
      const a = px(ra, dec), b = toScreen(flat, ra, dec)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(tol);
    }
    // North up, east on the left, as on the map.
    expect(px(262, 20).y).toBeLessThan(H / 2);
    expect(px(270, 8).x).toBeLessThan(W / 2);
  });
});
