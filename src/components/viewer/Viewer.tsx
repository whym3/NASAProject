'use client';
// The blink comparator. Finds every SPHEREx exposure of a position, reads the needed pixels
// from the public archive bucket, aligns them, and plays the epochs.
import { gsap } from 'gsap';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hop } from '@/components/Hop';
import { Ruler } from '@/components/Ruler';
import { Seek } from '@/components/Seek';
import { formatDec, formatRa, isoDate, mjdToYear, propagate } from '@/lib/astro';
import { openImage } from '@/lib/fits';
import { FLAG_BITS, readFlagWord } from '@/lib/flags';
import { encodeGif, type GifFrame } from '@/lib/gif';
import {
  aperture, buildColourEpochs, buildEpochs, COLOUR_DETS, DETECTORS, displayLimits, haloFlux, loadFrame, makeGrid, median, pool, shiftAdd, sumAll, thin,
  type Epoch, type Frame, type ImageRecord, type Mode,
} from '@/lib/frames';
import { paint, paintRgb, subtract } from '@/lib/render';
import { useTone } from '@/lib/tone';
import { deproject, makeWcs, project, skyToPix } from '@/lib/wcs';
import { LightCurve, type CurveMean, type CurvePoint } from './LightCurve';
import { ReportDialog } from './ReportDialog';
import { Spectrum, type SpecPoint } from './Spectrum';

export interface ViewParams {
  ra: number; dec: number; name?: string;
  fov: number; det: number; mode: Mode; diff: boolean; gaia: boolean; hold: number; ends: boolean; colour: boolean;
  wise: boolean; stack: Stack; pmRa: number; pmDec: number;
  /** Plate to open on (1-based); when given, the blink starts paused there. */
  plate: number;
}

export type Stack = 'none' | 'sum' | 'shift';
interface WiseSource { id: string; ra: number; dec: number; w1: number | null; w2: number | null }
interface FlagTally { key: string; done: number; total: number; rows: { name: string; meaning: string; bad: boolean; count: number }[] }

interface GaiaSource { id: string; ra: number; dec: number; pmRa: number; pmDec: number; g: number | null }

const FOVS = [{ v: 120, l: '2′' }, { v: 300, l: '5′' }, { v: 600, l: '10′' }, { v: 1200, l: '20′' }];
const MODES: { v: Mode; l: string; hint: string }[] = [
  { v: 'pass', l: 'Pass', hint: 'One plate per survey pass, about six months apart. Best for stars and brown dwarfs.' },
  { v: 'burst', l: 'Burst', hint: 'One plate per group of exposures taken minutes apart. For asteroids and comets.' },
  { v: 'single', l: 'Single', hint: 'Every exposure on its own. Each samples a different wavelength, so sources flicker.' },
];

export function Viewer({ initial, embed = false }: { initial: ViewParams; embed?: boolean }) {
  const { ra, dec, name } = initial;
  const [fov, setFovRaw] = useState(initial.fov);
  const [det, setDetRaw] = useState(initial.det);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [diffWanted, setDiff] = useState(initial.diff);
  const [colour, setColourRaw] = useState(initial.colour);
  // Subtraction is a single-detector tool; colour plates are for seeing what things are.

  const [ends, setEnds] = useState(initial.ends);
  const [showGaia, setShowGaia] = useState(initial.gaia);
  const [hold, setHold] = useState(initial.hold);
  const [gain, setGain] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(Math.max(0, initial.plate - 1));

  const [records, setRecords] = useState<ImageRecord[] | null>(null);
  const [error, setError] = useState('');
  // Loaded pixels are tagged with the detector and field they belong to, so a change of either
  // shows an empty plate at once instead of the previous selection.
  const [load, setLoad] = useState<{ key: string; frames: Frame[]; done: number; total: number; failed: number } | null>(null);
  const [gaiaData, setGaia] = useState<{ fov: number; sources: GaiaSource[] } | null>(null);
  const [gaiaErr, setGaiaErr] = useState('');
  const [showWise, setShowWise] = useState(initial.wise);
  const [wiseData, setWise] = useState<{ fov: number; sources: WiseSource[] } | null>(null);
  const [wiseErr, setWiseErr] = useState('');
  const [stackWanted, setStack] = useState<Stack>(initial.stack);
  const [pmText, setPmText] = useState({ ra: String(initial.pmRa), dec: String(initial.pmDec) });
  const [flags, setFlags] = useState<FlagTally | null>(null);
  const [exporting, setExporting] = useState(false);
  // Adding plates together and shift-and-add are single-detector tools too.
  const stack: Stack = colour ? 'none' : stackWanted;
  const pm = useMemo(() => ({ ra: Number(pmText.ra) || 0, dec: Number(pmText.dec) || 0 }), [pmText]);
  const diff = diffWanted && !colour && stack === 'none';
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null);
  const [spec, setSpec] = useState<{ points: SpecPoint[]; done: number; total: number } | null>(null);
  const [copied, setCopied] = useState('');
  // Reporting: 'picking' waits for a click on the plate, 'open' shows the form.
  const [report, setReport] = useState<'closed' | 'picking' | 'open'>('closed');

  const canvas = useRef<HTMLCanvasElement>(null);
  const tone = useTone();
  const grid = useMemo(() => makeGrid(ra, dec, fov), [ra, dec, fov]);
  const loadKey = `${colour ? 'rgb' : det}:${fov}`;
  const current = load && load.key === loadKey ? load : null;
  const frames = useMemo(() => current?.frames ?? [], [current]);
  const progress = { done: current?.done ?? 0, total: current?.total ?? 0, failed: current?.failed ?? 0 };
  const gaia = gaiaData && gaiaData.fov === fov ? gaiaData.sources : null;
  const wise = wiseData && wiseData.fov === fov ? wiseData.sources : null;
  const setDet = useCallback((d: number) => { setDetRaw(d); setColourRaw(false); setIdx(0); setMark(null); }, []);
  const setColour = useCallback((on: boolean) => { setColourRaw(on); setIdx(0); }, []);
  const setFov = (f: number) => { setFovRaw(f); setIdx(0); setMark(null); };

  // 1. Which exposures cover this position?
  useEffect(() => {
    const ac = new AbortController();
    // The archive often answers 502 or 503 when busy, so ask up to three times before giving up.
    (async () => {
      let message = 'The archive did not answer.';
      for (let attempt = 0; attempt < 3 && !ac.signal.aborted; attempt++) {
        try {
          const r = await fetch(`/api/frames?ra=${ra}&dec=${dec}`, { signal: ac.signal });
          const j = await r.json();
          if (r.ok) { setError(''); setRecords(j.images as ImageRecord[]); return; }
          message = j.error ?? message;
          if (r.status === 400) break;
        } catch { /* network error: retry */ }
        if (attempt < 2) { setError('The archive is busy. Trying again.'); await new Promise((res) => setTimeout(res, 2500)); }
      }
      if (!ac.signal.aborted) setError(message);
    })();
    return () => ac.abort();
  }, [ra, dec]);

  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    records?.forEach((r) => { c[r.det] = (c[r.det] ?? 0) + 1; });
    return c;
  }, [records]);

  // 2. Read the pixels for the chosen detector, a few files at a time, showing frames as they land.
  useEffect(() => {
    if (!records) return;
    const ac = new AbortController();
    // Colour needs three detectors, so each gets fewer exposures to keep the wait reasonable.
    const wanted: readonly number[] = colour ? COLOUR_DETS : [det];
    const each = fov >= 600 ? (colour ? 24 : 48) : colour ? 60 : 120;
    const mine = wanted.flatMap((d) => thin(records.filter((r) => r.det === d), each));
    const got: Frame[] = [];
    let done = 0, failed = 0, last = 0;
    const flush = (force = false) => {
      const now = performance.now();
      if (!force && now - last < 350) return;
      last = now;
      setLoad({ key: loadKey, frames: [...got], done, total: mine.length, failed });
    };
    pool(mine, 8, (r) => loadFrame(r, grid, ac.signal), (f, _r, err) => {
      if (ac.signal.aborted) return;
      done++;
      if (f && f.coverage > 0.2) got.push(f); else if (err) failed++;
      flush();
    }).then(() => {
      if (ac.signal.aborted) return;
      flush(true);
      if (!initial.plate && !matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(true);
    });
    return () => ac.abort();
  }, [records, det, grid, fov, loadKey, colour, initial.plate]);

  const epochs: Epoch[] = useMemo(
    () => {
      if (!frames.length) return [];
      if (colour) return buildColourEpochs(frames);
      if (stack === 'sum') return [sumAll(frames)];
      if (stack === 'shift') return [shiftAdd(frames, grid, pm.ra, pm.dec)];
      return buildEpochs(frames, mode);
    },
    [frames, mode, colour, stack, pm, grid],
  );
  // Each colour channel gets its own limits, taken from the pass with the most exposures in it.
  const rgbLimits = useMemo(() => {
    if (!colour) return null;
    return [0, 1, 2].map((c) => {
      const imgs = epochs.map((e) => e.rgb?.[c]).filter((x): x is Float32Array => !!x);
      return imgs.length ? displayLimits(imgs) : null;
    });
  }, [epochs, colour]);
  // Display limits come from the deepest plate, so a thin plate looks as noisy as it is.
  const limits = useMemo(() => {
    const deepest = epochs.reduce<Epoch | null>((best, e) => (!best || e.frames.length > best.frames.length ? e : best), null);
    return displayLimits(deepest ? [deepest.data] : []);
  }, [epochs]);
  const order = useMemo(() => {
    if (epochs.length < 2) return epochs.map((_, i) => i);
    if (ends) return [0, epochs.length - 1];
    return epochs.map((_, i) => i).filter((i) => !diff || i > 0);
  }, [epochs, ends, diff]);
  const cur = epochs.length ? Math.min(idx, epochs.length - 1) : 0;
  const epoch = epochs[cur];

  // 3. Play on the shared clock.
  const step = useCallback((dir: number) => {
    setIdx((i) => {
      if (!order.length) return 0;
      const at = order.indexOf(i);
      return order[((at < 0 ? 0 : at + dir) + order.length) % order.length];
    });
  }, [order]);
  useEffect(() => {
    if (!playing || order.length < 2) return;
    let last = gsap.ticker.time;
    const tick = (time: number) => {
      if (document.hidden) { last = time; return; }
      if (time - last >= hold / 1000) { last = time; step(1); }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [playing, hold, step, order.length]);

  // 4. Paint.
  useEffect(() => {
    if (!canvas.current || !epoch) return;
    if (colour && epoch.rgb && rgbLimits) { paintRgb(canvas.current, epoch.rgb, grid.n, rgbLimits, gain); return; }
    if (diff && epochs.length > 1) {
      const ref = cur === 0 ? epochs[epochs.length - 1] : epochs[0];
      paint(canvas.current, cur === 0 ? subtract(ref.data, epoch.data) : subtract(epoch.data, ref.data), grid.n, limits, tone, true, gain);
    } else paint(canvas.current, epoch.data, grid.n, limits, tone, false, gain);
  }, [epoch, epochs, cur, diff, limits, tone, gain, grid.n, colour, rgbLimits]);

  // The same picture as on screen, for any plate, onto any canvas (used by the animated export).
  const renderPlate = useCallback((target: HTMLCanvasElement, i: number) => {
    const e = epochs[i];
    if (!e) return;
    if (colour && e.rgb && rgbLimits) paintRgb(target, e.rgb, grid.n, rgbLimits, gain);
    else if (diff && epochs.length > 1) {
      const ref = i === 0 ? epochs[epochs.length - 1] : epochs[0];
      paint(target, i === 0 ? subtract(ref.data, e.data) : subtract(e.data, ref.data), grid.n, limits, tone, true, gain);
    } else paint(target, e.data, grid.n, limits, tone, false, gain);
  }, [epochs, colour, rgbLimits, diff, limits, tone, gain, grid.n]);

  // Keyboard: space, arrows, 1 to 6, D.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' && !t.closest('button, a')) { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'ArrowRight') { setPlaying(false); step(1); }
      else if (e.key === 'ArrowLeft') { setPlaying(false); step(-1); }
      else if (/^[1-6]$/.test(e.key)) setDet(Number(e.key));
      else if (e.key.toLowerCase() === 'd') setDiff((d) => !d);
      else if (e.key.toLowerCase() === 'c') setColourRaw((c) => !c);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [step, setDet]);

  // Keep the address bar shareable.
  const query = useMemo(() => {
    const q = new URLSearchParams({ ra: ra.toFixed(5), dec: dec.toFixed(5), fov: String(fov), det: String(det), mode });
    if (name) q.set('name', name);
    if (diff) q.set('diff', '1');
    if (colour) q.set('rgb', '1');
    if (showWise) q.set('wise', '1');
    if (stack !== 'none') q.set('stack', stack);
    if (stack === 'shift') { q.set('pmra', String(pm.ra)); q.set('pmdec', String(pm.dec)); }
    if (ends) q.set('ends', '1');
    if (showGaia) q.set('gaia', '1');
    if (hold !== 700) q.set('hold', String(hold));
    return q.toString();
  }, [ra, dec, fov, det, mode, name, diff, ends, showGaia, hold, colour, showWise, stack, pm]);
  useEffect(() => { history.replaceState(history.state, '', `${location.pathname}?${query}`); }, [query]);

  // Gaia DR3 overlay.
  useEffect(() => {
    if (!showGaia || gaia) return;
    const ac = new AbortController();
    fetch(`/api/catalog?ra=${ra}&dec=${dec}&r=${Math.min(1200, Math.round(fov * 0.75))}`, { signal: ac.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setGaiaErr(''); setGaia({ fov, sources: (j.sources as GaiaSource[]).slice(0, 80) }); })
      .catch((e) => { if (!ac.signal.aborted) setGaiaErr(e.message || 'Gaia did not answer.'); });
    return () => ac.abort();
  }, [showGaia, gaia, ra, dec, fov]);

  // AllWISE overlay: where mid-infrared sources were in 2010.
  useEffect(() => {
    if (!showWise || wise) return;
    const ac = new AbortController();
    fetch(`/api/catalog?cat=wise&ra=${ra}&dec=${dec}&r=${Math.min(1200, Math.round(fov * 0.75))}`, { signal: ac.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setWiseErr(''); setWise({ fov, sources: (j.sources as WiseSource[]).slice(0, 120) }); })
      .catch((e) => { if (!ac.signal.aborted) setWiseErr(e.message || 'The WISE catalogue did not answer.'); });
    return () => ac.abort();
  }, [showWise, wise, ra, dec, fov]);

  const toPixel = useCallback((sRa: number, sDec: number): [number, number] => {
    const [xi, eta] = project(sRa, sDec, ra, dec);
    return [(grid.n - 1) / 2 - (xi * 3600) / grid.scale, (grid.n - 1) / 2 - (eta * 3600) / grid.scale];
  }, [ra, dec, grid]);

  const stars = useMemo(() => {
    if (!showGaia || !gaia || !epoch) return [];
    const year = mjdToYear(epoch.mjd);
    const y0 = epochs.length ? mjdToYear(epochs[0].mjd) : year;
    const y1 = epochs.length ? mjdToYear(epochs[epochs.length - 1].mjd) : year;
    return gaia.map((s) => {
      const at = (y: number) => toPixel(...propagate(s.ra, s.dec, s.pmRa, s.pmDec, 2016, y));
      const pm = Math.hypot(s.pmRa, s.pmDec);
      return { id: s.id, p: at(year), a: at(y0), b: at(y1), pm, fast: pm >= 100, g: s.g };
    }).filter((s) => s.p[0] > -1 && s.p[0] < grid.n && s.p[1] > -1 && s.p[1] < grid.n);
  }, [showGaia, gaia, epoch, epochs, toPixel, grid.n]);

  // The fastest catalogued star in the field, offered as a starting motion for shift-and-add.
  const fastest = useMemo(() => {
    const best = gaia?.reduce<GaiaSource | null>((b, g) => (!b || Math.hypot(g.pmRa, g.pmDec) > Math.hypot(b.pmRa, b.pmDec) ? g : b), null);
    return best && Math.hypot(best.pmRa, best.pmDec) >= 100 ? best : null;
  }, [gaia]);

  const wiseMarks = useMemo(() => {
    if (!showWise || !wise) return [];
    return wise.map((w) => ({ id: w.id, p: toPixel(w.ra, w.dec) }))
      .filter((w) => w.p[0] > -1 && w.p[0] < grid.n && w.p[1] > -1 && w.p[1] < grid.n);
  }, [showWise, wise, toPixel, grid.n]);

  const clickPlate = (ev: React.MouseEvent<HTMLButtonElement>) => {
    if (ev.detail === 0) { setMark(null); return; }
    const r = ev.currentTarget.getBoundingClientRect();
    setMark({ x: ((ev.clientX - r.left) / r.width) * grid.n - 0.5, y: ((ev.clientY - r.top) / r.height) * grid.n - 0.5 });
    if (report === 'picking') setReport('open');
  };
  const markSky = useMemo(() => {
    if (!mark) return null;
    const xi = (-(mark.x - (grid.n - 1) / 2) * grid.scale) / 3600;
    const eta = (-(mark.y - (grid.n - 1) / 2) * grid.scale) / 3600;
    const [r, d] = deproject(xi, eta, ra, dec);
    return { ra: r, dec: d };
  }, [mark, grid, ra, dec]);

  // Where measurements are taken: the mark if there is one, else the centre.
  const spot = useMemo(() => (mark ? { x: mark.x, y: mark.y } : { x: (grid.n - 1) / 2, y: (grid.n - 1) / 2 }), [mark, grid.n]);

  // Brightness over time, from the exposures already loaded.
  const curve = useMemo(() => {
    // A star bright enough to overflow the detector has no usable core: measure its halo instead.
    const core = frames.map((f) => aperture(f.data, grid, spot.x, spot.y).flux);
    const halo = frames.length > 3 && core.filter(Number.isFinite).length < frames.length * 0.5;
    const flux = halo ? frames.map((f) => haloFlux(f.data, grid, spot.x, spot.y)) : core;
    const points: CurvePoint[] = [];
    frames.forEach((f, i) => { if (Number.isFinite(flux[i])) points.push({ mjd: f.mjd, flux: flux[i], det: f.rec.det }); });
    const means: CurveMean[] = [];
    const groups = colour ? buildColourEpochs(frames) : buildEpochs(frames, mode === 'single' ? 'burst' : mode);
    for (const g of groups) {
      for (const d of new Set(g.frames.map((f) => f.rec.det))) {
        const v = g.frames.filter((f) => f.rec.det === d).map((f) => flux[frames.indexOf(f)]).filter(Number.isFinite);
        if (v.length) means.push({ mjd: g.mjd, flux: median(v), det: d, n: v.length });
      }
    }
    return { points, means, halo };
  }, [frames, grid, spot, colour, mode]);

  // Contamination flags at that spot, for every exposure in the plate on screen.
  const flagAbort = useRef<AbortController | null>(null);
  useEffect(() => () => flagAbort.current?.abort(), []);
  const flagKey = `${epoch?.key ?? ''}:${spot.x.toFixed(1)},${spot.y.toFixed(1)}`;
  const checkFlags = () => {
    if (!epoch) return;
    flagAbort.current?.abort();
    const ac = new AbortController();
    flagAbort.current = ac;
    const list = thin(epoch.frames, 36);
    const at = markSky ?? { ra, dec };
    const counts = new Map<number, number>();
    let done = 0;
    const publish = () => setFlags({
      key: flagKey, done, total: list.length,
      rows: FLAG_BITS.filter((b) => counts.has(b.bit)).map((b) => ({ name: b.name, meaning: b.meaning, bad: b.bad, count: counts.get(b.bit)! }))
        .sort((a, b) => Number(b.bad) - Number(a.bad) || b.count - a.count),
    });
    publish();
    pool(list, 6, async (f) => {
      const img = await openImage(f.rec.key, ac.signal);
      const [x, y] = skyToPix(makeWcs(img.header), at.ra, at.dec);
      return readFlagWord(img, x, y, ac.signal);
    }, (word) => {
      if (ac.signal.aborted) return;
      done++;
      if (word !== null) { for (const b of FLAG_BITS) if ((word >>> b.bit) & 1) counts.set(b.bit, (counts.get(b.bit) ?? 0) + 1); }
      publish();
    });
  };
  const flagsHere = flags && flags.key === flagKey ? flags : null;

  // Spectrum on the fly: a small cutout from every detector, one measurement per exposure.
  const specAbort = useRef<AbortController | null>(null);
  useEffect(() => () => specAbort.current?.abort(), []);
  const measure = () => {
    if (!records) return;
    specAbort.current?.abort();
    const ac = new AbortController();
    specAbort.current = ac;
    const at = markSky ?? { ra, dec };
    const g = makeGrid(at.ra, at.dec, 110);
    const list = DETECTORS.flatMap((d) => thin(records.filter((r) => r.det === d.det), 40));
    const pts: SpecPoint[] = [];
    let done = 0;
    setSpec({ points: [], done: 0, total: list.length });
    pool(list, 8, (r) => loadFrame(r, g, ac.signal), (f) => {
      if (ac.signal.aborted) return;
      done++;
      if (f) {
        const m = aperture(f.data, g, (g.n - 1) / 2, (g.n - 1) / 2);
        if (Number.isFinite(m.flux) && Number.isFinite(f.wave)) pts.push({ wave: f.wave, flux: m.flux, err: m.err, mjd: f.mjd, det: f.rec.det });
      }
      if (done % 6 === 0 || done === list.length) setSpec({ points: [...pts], done, total: list.length });
    });
  };

  const copy = async (what: 'link' | 'embed') => {
    const url = `${location.origin}/${what === 'embed' ? 'embed' : 'view'}?${query}`;
    const text = what === 'embed' ? `<iframe src="${url}" width="900" height="640" style="border:0" title="SPHEREx blink of ${name ?? 'a sky position'}"></iframe>` : url;
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1800); } catch { setCopied('failed'); }
  };
  const savePng = () => {
    if (!canvas.current || !epoch) return;
    const z = Math.max(1, Math.round(960 / grid.n));
    const out = document.createElement('canvas');
    out.width = out.height = grid.n * z;
    const c = out.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.drawImage(canvas.current, 0, 0, out.width, out.height);
    const a = document.createElement('a');
    a.download = `spherex-d${det}-${isoDate(epoch.mjd)}.png`;
    a.href = out.toDataURL('image/png');
    a.click();
  };

  // Animated export: every plate in the current blink, enlarged, dated, as a looping GIF.
  const saveGif = async () => {
    if (!epochs.length || exporting) return;
    setExporting(true);
    await new Promise((r) => setTimeout(r, 30)); // let the button show its busy state
    try {
      const zoom = Math.max(1, Math.round(480 / grid.n));
      const side = grid.n * zoom, bar = 22;
      const small = document.createElement('canvas');
      const big = document.createElement('canvas');
      big.width = side; big.height = side + bar;
      const c = big.getContext('2d', { willReadFrequently: true })!;
      c.imageSmoothingEnabled = false;
      const list = order.length ? order : [0];
      const out: GifFrame[] = list.map((i) => {
        renderPlate(small, i);
        c.fillStyle = colour ? '#101214' : '#e7e9e6';
        c.fillRect(0, 0, side, side + bar);
        c.drawImage(small, 0, 0, side, side);
        c.fillStyle = colour ? '#e7e9e6' : '#101214';
        c.font = '12px ui-monospace, Menlo, monospace';
        c.textBaseline = 'middle';
        const e = epochs[i];
        c.fillText(`${i + 1}/${epochs.length}  ${isoDate(e.mjdMin)}${isoDate(e.mjdMin) === isoDate(e.mjdMax) ? '' : ` to ${isoDate(e.mjdMax)}`}  ${colour ? 'D2 D4 D6' : `D${det}`}`, 6, side + bar / 2 + 1);
        return { rgba: c.getImageData(0, 0, side, side + bar).data, delayMs: hold };
      });
      const gif = encodeGif(side, side + bar, out, colour);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([gif.buffer as ArrayBuffer], { type: 'image/gif' }));
      a.download = `blinkscope-${(name ?? `${ra.toFixed(3)}_${dec.toFixed(3)}`).replace(/[^A-Za-z0-9_.-]+/g, '-')}-${colour ? 'colour' : `d${det}`}.gif`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } finally {
      setExporting(false);
    }
  };

  // Reporting a candidate starts from a mark on the plate; without one, ask for it first.
  const startReport = () => { setPlaying(false); setReport(mark ? 'open' : 'picking'); };

  const loading = !!records && (!current || progress.done < progress.total);
  const empty = !!records && !loading && frames.length === 0;
  const span = epochs.length > 1 ? (epochs[epochs.length - 1].mjd - epochs[0].mjd) / 365.25 : 0;
  const label = epoch
    ? (isoDate(epoch.mjdMin) === isoDate(epoch.mjdMax) ? isoDate(epoch.mjdMin) : `${isoDate(epoch.mjdMin)} to ${isoDate(epoch.mjdMax)}`)
    : '';
  const fwhm = epoch ? epoch.frames.map((f) => f.psfFwhm).filter(Number.isFinite).sort((a, b) => a - b)[epoch.frames.length >> 1] : NaN;
  const modeHint = MODES.find((m) => m.v === mode)!.hint;

  return (
    <div className={`viewer${embed ? ' viewer--embed' : ''}`}>
      <div className="viewer__stage">
        <div className="plate viewer__plate">
          <canvas ref={canvas} role="img"
            aria-label={epoch ? `SPHEREx detector ${det} image of ${name ?? 'the requested position'}, ${label}, plate ${cur + 1} of ${epochs.length}${diff ? ', shown as a difference' : ''}` : 'No image yet'} />
          {epoch && (
            <svg viewBox={`-0.5 -0.5 ${grid.n} ${grid.n}`} aria-hidden="true">
              {stars.map((s) => (
                <g key={s.id}>
                  {s.fast && <line className="track" x1={s.a[0]} y1={s.a[1]} x2={s.b[0]} y2={s.b[1]} />}
                  <circle className={`ring${s.fast ? ' ring--fast' : ''}`} cx={s.p[0]} cy={s.p[1]} r={Math.max(0.9, grid.n * 0.011)} />
                </g>
              ))}
              {wiseMarks.map((w) => {
                const h = Math.max(1.1, grid.n * 0.013);
                return <rect key={w.id} className="wise" x={w.p[0] - h} y={w.p[1] - h} width={h * 2} height={h * 2} />;
              })}
              {mark && (
                <g className="tick">
                  <line x1={mark.x + grid.n * 0.03} y1={mark.y} x2={mark.x + grid.n * 0.075} y2={mark.y} />
                  <line x1={mark.x} y1={mark.y - grid.n * 0.03} x2={mark.x} y2={mark.y - grid.n * 0.075} />
                </g>
              )}
            </svg>
          )}
          {!epoch && (
            <p className="plate__msg">
              {error ? error : empty ? `No detector ${det} exposures cover this position yet.` : records ? 'Reading pixels from the archive' : 'Asking the archive which exposures cover this position. This can take up to a minute.'}
            </p>
          )}
          {epoch && <button type="button" className={`plate__hit${report === 'picking' ? ' is-picking' : ''}`} onClick={clickPlate} aria-label={report === 'picking' ? 'Click the object you want to report' : 'Mark a position on the plate'} />}
          <span className="plate__compass" aria-hidden="true">N up, E left</span>
          {epoch && (
            <div className="plate__edge" aria-hidden="true">
              <span><b>{cur + 1}/{epochs.length}</b> {label}</span>
              <span>{epoch.missing?.length ? `no D${epoch.missing.join(', D')} in this pass, ` : ''}{epoch.frames.length} exp, {epoch.waveMin.toFixed(2)} to {epoch.waveMax.toFixed(2)} µm</span>
            </div>
          )}
        </div>

        <div className="transport">
          <div className="transport__btns">
            <button type="button" onClick={() => { setPlaying(false); step(-1); }} aria-label="Previous plate"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M11 1v12L3 7z" /><rect x="1" y="1" width="2" height="12" /></svg></button>
            <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'} aria-pressed={playing}>
              {playing ? <svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" /><rect x="8.5" y="1" width="3.5" height="12" /></svg> : <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1l9 6-9 6z" /></svg>}
            </button>
            <button type="button" onClick={() => { setPlaying(false); step(1); }} aria-label="Next plate"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1v12l8-6z" /><rect x="11" y="1" width="2" height="12" /></svg></button>
          </div>
          <div className="epochs" role="group" aria-label="Plates">
            {epochs.length <= 24 && epochs.map((e, i) => (
              <button key={e.key} type="button" aria-pressed={i === cur} aria-label={`Plate ${i + 1}, ${isoDate(e.mjd)}`} onClick={() => { setPlaying(false); setIdx(i); }}>{i + 1}</button>
            ))}
            {epochs.length > 24 && <span className="mono">{cur + 1} of {epochs.length}</span>}
          </div>
        </div>
        {epoch && (
          <div className="reportbar">
            <button type="button" className="btn" onClick={startReport}><Hop tick={false}>Report a candidate</Hop></button>
            <p className="note" aria-live="polite">
              {report === 'picking'
                ? <><strong>Now click the object on the plate.</strong> <button type="button" className="inline-link" onClick={() => setReport('closed')}>Cancel</button></>
                : 'Seen something move or change? Send it to the people who follow these up.'}
            </p>
          </div>
        )}
        <div className="status" aria-live="polite">
          {error && <p className="note note--warn">{error} <button type="button" className="inline-link" onClick={() => location.reload()}>Try again</button></p>}
          {records && current && progress.total > 0 && (
            <>
              <span>{loading ? `Loading ${progress.done} of ${progress.total} exposures` : `${frames.length} exposures in ${epochs.length} plates${span ? `, ${span.toFixed(1)} years apart` : ''}`}{progress.failed ? `, ${progress.failed} failed` : ''}</span>
              {loading && <div className="status__bar"><i style={{ transform: `scaleX(${progress.done / progress.total})` }} /></div>}
            </>
          )}
        </div>
      </div>

      <div className="viewer__panel">
        <section className="panel" aria-label="Position">
          <h1>{name ?? 'Sky position'}</h1>
          <p className="coords">{formatRa(ra)}<br />{formatDec(dec)}</p>
          <p className="note mono">{ra.toFixed(5)}, {dec >= 0 ? '+' : ''}{dec.toFixed(5)} deg</p>
          {!embed && <Seek hint={false} initial={name ?? `${ra.toFixed(5)} ${dec >= 0 ? '+' : ''}${dec.toFixed(5)}`} />}
        </section>

        <section className="panel" aria-label="Detector">
          <h2 className="panel__h">Detector and wavelength</h2>
          <Ruler selected={colour ? undefined : det} onSelect={setDet} counts={records ? counts : undefined} />
          <label className="check"><input type="checkbox" checked={colour} onChange={(e) => setColour(e.target.checked)} />Colour, from three detectors</label>
          {colour && (
            <p className="note">
              <span className="swatch swatch--b" />D2 blue, <span className="swatch swatch--g" />D4 green, <span className="swatch swatch--r" />D6 red. Cold objects such as brown dwarfs come out red. Anything that moves within a pass splits into coloured dots. Loads about three times as much.
            </p>
          )}
        </section>

        <section className="panel" aria-label="Plates">
          <h2 className="panel__h">Group exposures by</h2>
          <div className="seg" role="group" aria-label="Grouping">
            {MODES.map((m) => <button key={m.v} type="button" aria-pressed={(colour ? 'pass' : mode) === m.v} disabled={colour && m.v !== 'pass'} onClick={() => { setMode(m.v); setIdx(0); }}>{m.l}</button>)}
          </div>
          <p className="note">{colour ? 'Colour plates are always one per survey pass.' : modeHint}</p>
          <label className="check"><input type="checkbox" checked={diff} disabled={colour} onChange={(e) => setDiff(e.target.checked)} />Subtract the first plate{colour ? ' (single detector only)' : ''}</label>
          <label className="check"><input type="checkbox" checked={ends} disabled={stack !== 'none'} onChange={(e) => setEnds(e.target.checked)} />Blink only first and last</label>
        </section>

        <details className="panel">
          <summary className="panel__h">Add exposures together</summary>
          <div className="seg" role="group" aria-label="Stacking">
            <button type="button" aria-pressed={stack === 'none'} disabled={colour} onClick={() => { setStack('none'); setIdx(0); }}>Off</button>
            <button type="button" aria-pressed={stack === 'sum'} disabled={colour} onClick={() => { setStack('sum'); setIdx(0); }}>Add all</button>
            <button type="button" aria-pressed={stack === 'shift'} disabled={colour} onClick={() => { setStack('shift'); setIdx(0); }}>Shift and add</button>
          </div>
          {colour && <p className="note">Single detector only. Turn colour off to use these.</p>}
          {stack === 'sum' && <p className="note">One deep plate from all {frames.length} exposures. Fixed stars sharpen and fainter ones appear; anything that moves smears or drops out.</p>}
          {stack === 'shift' && (
            <>
              <p className="note">Each exposure is slid back along the motion below before adding. An object moving at that rate piles up into a point; the fixed stars smear into streaks.</p>
              <div className="pm">
                <label><span>East, &Prime; a year</span><input type="number" step="0.1" inputMode="decimal" value={pmText.ra} onChange={(e) => setPmText((p) => ({ ...p, ra: e.target.value }))} /></label>
                <label><span>North, &Prime; a year</span><input type="number" step="0.1" inputMode="decimal" value={pmText.dec} onChange={(e) => setPmText((p) => ({ ...p, dec: e.target.value }))} /></label>
              </div>
              {fastest && (
                <button type="button" className="inline-link" onClick={() => setPmText({ ra: (fastest.pmRa / 1000).toFixed(2), dec: (fastest.pmDec / 1000).toFixed(2) })}>
                  Use Gaia&rsquo;s motion for the fastest star here ({(Math.hypot(fastest.pmRa, fastest.pmDec) / 1000).toFixed(1)}&Prime; a year)
                </button>
              )}
              {!gaia && <p className="note">Tick the Gaia overlay below to pick up a known star&rsquo;s motion.</p>}
            </>
          )}
        </details>

        <details className="panel">
          <summary className="panel__h">Display</summary>
          <div className="seg" role="group" aria-label="Field of view">
            {FOVS.map((f) => <button key={f.v} type="button" aria-pressed={fov === f.v} onClick={() => setFov(f.v)} aria-label={`Field of view ${f.l.replace('′', ' arcminutes')}`}>{f.l}</button>)}
          </div>
          <label className="field"><span>Speed</span>
            <input type="range" min={200} max={1860} step={20} value={2200 - hold} onChange={(e) => setHold(2200 - Number(e.target.value))} aria-valuetext={`${(hold / 1000).toFixed(2)} seconds per plate`} />
            <output>{(hold / 1000).toFixed(2)} s</output></label>
          <label className="field"><span>Contrast</span>
            <input type="range" min={-2} max={3} step={0.1} value={Math.log2(gain)} onChange={(e) => setGain(2 ** Number(e.target.value))} aria-valuetext={`${gain.toFixed(1)} times`} />
            <output>{gain.toFixed(1)}&times;</output></label>
          <label className="check"><input type="checkbox" checked={showGaia} onChange={(e) => setShowGaia(e.target.checked)} />Gaia DR3 stars, moved to each plate&rsquo;s date</label>
          {showGaia && gaia && <p className="note">{stars.length} stars. Red rings move faster than 0.1&Prime; a year; the dashed line is their path across these plates.</p>}
          {gaiaErr && <p className="note note--warn">{gaiaErr}</p>}
          <label className="check"><input type="checkbox" checked={showWise} onChange={(e) => setShowWise(e.target.checked)} />WISE sources, where they were in 2010</label>
          {showWise && wise && <p className="note">{wiseMarks.length} squares from the AllWISE catalogue. A source that has left its square since 2010 has moved.</p>}
          {wiseErr && <p className="note note--warn">{wiseErr}</p>}
        </details>

        {mark && markSky && (
          <section className="panel" aria-label="Marked position">
            <h2 className="panel__h">Your mark</h2>
            <p className="coords">{formatRa(markSky.ra)}<br />{formatDec(markSky.dec)}</p>
            <div className="links">
              <a className="inline-link" href={`${embed ? '/embed' : '/view'}?ra=${markSky.ra.toFixed(5)}&dec=${markSky.dec.toFixed(5)}&fov=${fov}&det=${det}`}>Centre here</a>
              <a className="inline-link" target="_blank" rel="noopener noreferrer" href={`https://simbad.cfa.harvard.edu/simbad/sim-coo?Coord=${markSky.ra.toFixed(5)}+${markSky.dec.toFixed(5)}&Radius=20&Radius.unit=arcsec`}>SIMBAD</a>
              <a className="inline-link" target="_blank" rel="noopener noreferrer" href={`https://vizier.cfa.harvard.edu/viz-bin/VizieR-4?-c=${markSky.ra.toFixed(5)}+${markSky.dec.toFixed(5)}&-c.rs=10`}>VizieR</a>
              <a className="inline-link" target="_blank" rel="noopener noreferrer" href={`http://byw.tools/wiseview#ra=${markSky.ra.toFixed(5)}&dec=${markSky.dec.toFixed(5)}&size=${fov}`}>WiseView</a>
              <button type="button" className="inline-link" onClick={() => setMark(null)}>Clear</button>
            </div>
            <button type="button" className="btn btn--quiet" onClick={() => setReport('open')}><Hop tick={false}>Report this as a candidate</Hop></button>
          </section>
        )}

        {epoch && (
          <details className="panel">
            <summary className="panel__h">This plate</summary>
            <dl className="meta">
              <dt>Dates</dt><dd>{label}</dd>
              <dt>MJD</dt><dd>{epoch.mjd.toFixed(3)}</dd>
              <dt>Exposures</dt><dd>{epoch.frames.length} &times; {Number.isFinite(epoch.frames[0].exposure) ? epoch.frames[0].exposure.toFixed(0) : '114'} s</dd>
              <dt>Wavelength here</dt><dd>{epoch.waveMin.toFixed(3)} to {epoch.waveMax.toFixed(3)} µm</dd>
              <dt>Median PSF</dt><dd>{Number.isFinite(fwhm) ? `${fwhm.toFixed(1)}″` : 'n/a'}</dd>
              <dt>Sky removed</dt><dd>{epoch.frames[0].background.toFixed(3)} MJy/sr</dd>
              <dt>Release</dt><dd>{[...new Set(epoch.frames.map((f) => f.rec.rel.replace('spherex_', '')))].join(', ')}</dd>
              <dt>First exposure</dt><dd><a className="inline-link" target="_blank" rel="noopener noreferrer" href={`https://irsa.ipac.caltech.edu/ibe/data/spherex/${epoch.frames[0].rec.key}`}>{epoch.frames[0].rec.id}</a></dd>
            </dl>
            <p className="note">Grey pixels have no data: a star that overflowed the detector, or a masked pixel.</p>
          </details>
        )}

        {frames.length > 0 && (
          <details className="panel">
            <summary className="panel__h">Brightness over time {mark ? 'at your mark' : 'at the centre'}</summary>
            <LightCurve points={curve.points} means={curve.means} coloured={colour} />
            {curve.halo && <p className="note note--warn">This star overflows the detector, so its core cannot be measured. The chart follows the light in its halo instead: a fair guide to brightening and fading, but not a calibrated flux.</p>}
            <p className="note">Dots are single exposures, squares the median of each {colour ? 'pass and detector' : 'plate'}. A variable star steps up and down between plates; a steady one stays level. Something that moves away from this spot fades out.</p>
          </details>
        )}

        {epoch && (
          <details className="panel">
            <summary className="panel__h">Archive flags {mark ? 'at your mark' : 'at the centre'}</summary>
            {flagsHere && flagsHere.done < flagsHere.total && <p className="note" aria-live="polite">Reading {flagsHere.done} of {flagsHere.total} exposures</p>}
            {flagsHere && flagsHere.done === flagsHere.total && (flagsHere.rows.length ? (
              <ul className="flags">
                {flagsHere.rows.map((r) => (
                  <li key={r.name} className={r.bad ? 'is-bad' : undefined}>
                    <b>{r.name}</b><span>{r.count} of {flagsHere.total}</span><i>{r.meaning}</i>
                  </li>
                ))}
              </ul>
            ) : <p className="note">No flags set at this pixel in any of the {flagsHere.total} exposures.</p>)}
            <button type="button" className="btn btn--quiet" onClick={checkFlags}><Hop tick={false}>{flagsHere ? 'Check again' : 'Check this plate\u2019s flags here'}</Hop></button>
            <p className="note">Read from the archive&rsquo;s own flag layer for the exposures in the plate on screen. Flags in red mean the pixel is suspect in that exposure.</p>
          </details>
        )}

        <details className="panel">
          <summary className="panel__h">Spectrum {mark ? 'at your mark' : 'at the centre'}</summary>
          {spec && <Spectrum points={spec.points} />}
          {spec && spec.done < spec.total && <p className="note" aria-live="polite">Measuring {spec.done} of {spec.total} exposures</p>}
          {spec && spec.done === spec.total && <p className="note">{spec.points.length} measurements. Filled points are the latest pass, open points the first. Simple aperture photometry, good for shape only.</p>}
          <button type="button" className="btn btn--quiet" onClick={measure} disabled={!records}><Hop tick={false}>{spec ? 'Measure again' : 'Measure across all 102 bands'}</Hop></button>
        </details>

        <details className="panel">
          <summary className="panel__h">Share</summary>
          <div className="links">
            <button type="button" className="inline-link" onClick={() => copy('link')}>{copied === 'link' ? 'Link copied' : 'Copy link'}</button>
            <button type="button" className="inline-link" onClick={() => copy('embed')}>{copied === 'embed' ? 'Embed code copied' : 'Copy embed code'}</button>
            <button type="button" className="inline-link" onClick={savePng} disabled={!epoch}>Save this plate as PNG</button>
            <button type="button" className="inline-link" onClick={saveGif} disabled={!epoch || exporting}>{exporting ? 'Making the GIF' : 'Save the blink as a GIF'}</button>
          </div>
          <p className="note">Keys: space plays, arrows step, 1 to 6 pick a detector, C colour, D subtracts.</p>
        </details>
      </div>
      <ReportDialog
        open={report === 'open' && !!markSky}
        onClose={() => setReport('closed')}
        sky={markSky}
        seenIn={colour ? 'colour plates (detectors 2, 4 and 6)' : `detector ${det} (${DETECTORS[det - 1].min} to ${DETECTORS[det - 1].max} microns)`}
        plates={epochs.map((e) => isoDate(e.mjd))}
        link={markSky ? `${typeof location === 'undefined' ? '' : location.origin}/view?ra=${markSky.ra.toFixed(5)}&dec=${markSky.dec.toFixed(5)}&fov=${fov}&det=${det}${colour ? '&rgb=1' : ''}` : ''}
      />
    </div>
  );
}
