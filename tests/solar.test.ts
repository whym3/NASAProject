import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eclToRadec, planetAt, type SolarData } from '../src/sky/solar';

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
  it('ships a kind, a name, a sky position and a date per small body', () => {
    expect(data.xyz.length).toBe(data.kind.length * 3);
    expect(data.names.length).toBe(data.kind.length);
    expect(data.radec.length).toBe(data.kind.length * 2);
    expect(data.mjd.length).toBe(data.kind.length);
    expect(Math.max(...data.kind)).toBeLessThan(data.kinds.length);
  });
});
