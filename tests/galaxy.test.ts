import { describe, expect, it } from 'vitest';
import { buildGalaxy, LANDMARKS, R0, SUN } from '../src/sky/galaxy';

describe('the model Milky Way', () => {
  const { pos, col } = buildGalaxy(20000);
  it('builds every point, the same on every visit', () => {
    expect(pos.length).toBe(60000);
    expect(col.length).toBe(60000);
    expect(buildGalaxy(20000).pos).toEqual(pos);
  });
  it('leaves the Sun its own clear neighbourhood, R0 from the centre', () => {
    expect(Math.hypot(...SUN)).toBeCloseTo(R0, 1);
    for (let k = 0; k < pos.length; k += 3) expect(Math.hypot(pos[k] - SUN[0], pos[k + 1] - SUN[1], pos[k + 2] - SUN[2])).toBeGreaterThanOrEqual(0.3);
  });
  it('is a thin disc about 30 kpc across', () => {
    let far = 0, thick = 0;
    for (let k = 0; k < pos.length; k += 3) { far = Math.max(far, Math.hypot(pos[k], pos[k + 1])); thick += Math.abs(pos[k + 2]); }
    expect(far).toBeLessThan(18);
    expect(thick / (pos.length / 3)).toBeLessThan(0.4);
  });
  it('lists real objects with sane positions, Sagittarius A* where the model has its centre', () => {
    for (const l of LANDMARKS) {
      expect(l.ra).toBeGreaterThanOrEqual(0); expect(l.ra).toBeLessThan(360);
      expect(Math.abs(l.dec)).toBeLessThanOrEqual(90); expect(l.kpc).toBeGreaterThan(0);
    }
    const sgr = LANDMARKS[0], centre = { ra: 266.405, dec: -28.936 }; // the Galactic centre the scene is built on
    const r = Math.PI / 180;
    const sep = Math.acos(Math.sin(sgr.dec * r) * Math.sin(centre.dec * r) + Math.cos(sgr.dec * r) * Math.cos(centre.dec * r) * Math.cos((sgr.ra - centre.ra) * r)) / r;
    expect(sep).toBeLessThan(0.1);
    expect(Math.abs(sgr.kpc - R0)).toBeLessThan(0.1);
  });
});
