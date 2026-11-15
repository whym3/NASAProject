'use client';
// The finder: the real sky, drawn from the bright star catalogue. Drag to turn it, pick a
// star with a note to read about it, pick anywhere to develop a plate from that spot.
import { gsap } from 'gsap';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { notedStars, viewerHref, type NotedStar } from '@/data/stars';
import { startScroll, stopScroll } from '@/engine';
import { bridge } from '@/film/bridge';
import { formatDec, formatRa } from '@/lib/astro';
import { chooseFigure, constellationAt, figureNear, makeAtlas, type Atlas } from '@/sky/constellations';
import { FOV_MAX, FOV_MIN, pan, toScreen, toSky, type View } from '@/sky/project';
import type { Sky } from '@/sky/scene';
import { OPEN_FULL_SKY } from './FullSkyLink';
import { Hop } from './Hop';

export interface FreshField { ra: number; dec: number; date: string; count: number }

type Pick =
  | { kind: 'star'; star: NotedStar }
  | { kind: 'point'; ra: number; dec: number; near?: { name: string; type: string } };

const START = { ra: 262, dec: 8, fov: 62 }; // Ophiuchus, with Barnard's Star near the middle
const FIELD_DEG = 3.5; // one SPHEREx exposure covers 3.5 degrees
const ALL_LINES = 0.4; // brightness of the figures when the "Lines" switch shows all of them

// Constellations this visitor has come across, kept between visits.
const FOUND_KEY = 'constellations';
function readFound(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FOUND_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}
function remember(id: string): number {
  const got = readFound();
  if (!got.includes(id)) {
    got.push(id);
    try { localStorage.setItem(FOUND_KEY, JSON.stringify(got)); } catch { /* private mode: count this visit only */ }
  }
  return got.length;
}

export function SkyMap({ fresh = [] }: { fresh?: FreshField[] }) {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ ...START, width: 1, height: 1 });
  const sky = useRef<Sky | null>(null);
  const dirty = useRef(true);
  const touched = useRef(0);
  const pickRef = useRef<Pick | null>(null);
  const [pick, setPickState] = useState<Pick | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'nogl'>('loading');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [full, setFullState] = useState(false);
  const fullRef = useRef(false);
  const leaving = useRef(false); // the move back out is playing
  const swingTween = useRef<gsap.core.Tween | null>(null);
  const home = useRef<{ ra: number; dec: number; fov: number } | null>(null); // the view full screen began from
  const fillTween = useRef<gsap.core.Tween | null>(null);
  const readout = useRef<HTMLParagraphElement>(null);
  const drag = useRef<{ x: number; y: number; moved: number; id: number } | null>(null);

  // Constellations (full screen only): the figures, which one is playing, what has been found.
  const atlasRef = useRef<Atlas | null>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [linesOn, setLinesOn] = useState(false);
  // SPHEREx itself, live, in the full-screen sky.
  const satEl = useRef<HTMLButtonElement>(null);
  const satLabel = useRef<HTMLSpanElement>(null);
  const following = useRef(false); // the view is riding along with it
  const flight = useRef<gsap.core.Tween | null>(null); // the move to SPHEREx or to the Milky Way, while it runs
  const [satImg, setSatImg] = useState<string | null>(null);
  const askedImg = useRef(false);
  const [found, setFound] = useState(0);
  const lineState = useRef({ active: -1, draw: 0, alpha: 0, all: 0 });
  const seen = useRef(new Set<number>());
  const playing = useRef<gsap.core.Timeline | null>(null);
  const nextAt = useRef(0);
  const conLabel = useRef<HTMLSpanElement>(null);
  const hover = useRef<{ fig: number; timer: ReturnType<typeof setTimeout> | null }>({ fig: -1, timer: null });

  // Coming across a constellation: its lines draw themselves star to star, the finished
  // figure blinks twice with its name beside it, and then it fades back into the plain sky.
  const playFigure = useCallback((idx: number) => {
    const s = sky.current, a = atlasRef.current;
    if (!s || !a || playing.current || !fullRef.current) return;
    const fig = a.list[idx], L = lineState.current, label = conLabel.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const apply = () => s.setLines(L);
    const name = () => {
      setFound(remember(fig.id));
      if (!label) return;
      label.children[0].textContent = fig.name;
      label.children[1].textContent = fig.meaning;
      label.dataset.ra = String(fig.ra);
      label.dataset.dec = String(fig.dec);
      label.classList.add('is-on');
      dirty.current = true;
    };
    const unname = () => label?.classList.remove('is-on');
    seen.current.add(idx);
    L.active = idx; L.draw = reduced ? 1.03 : 0; L.alpha = reduced ? 0.7 : 1;
    const segments = fig.lines.reduce((n, l) => n + l.length / 2 - 1, 0);
    const wait = (d: number) => [{}, { duration: d }] as const;
    const tl = gsap.timeline({
      onUpdate: apply,
      onComplete: () => { L.active = -1; L.alpha = 0; apply(); playing.current = null; nextAt.current = gsap.ticker.time + 0.9; },
    });
    if (reduced) tl.call(name).to(...wait(2.6)).call(unname);
    else {
      tl.to(L, { draw: 1.03, duration: Math.min(1.8, 0.8 + segments * 0.035), ease: 'power1.inOut' })
        .call(name)
        .to(...wait(0.3))
        .set(L, { alpha: 0 }).to(...wait(0.13)) // blink
        .set(L, { alpha: 1 }).to(...wait(0.24))
        .set(L, { alpha: 0 }).to(...wait(0.13)) // blink
        .set(L, { alpha: 1 }).to(...wait(1.3))
        .call(unname)
        .to(L, { alpha: 0, duration: 0.8, ease: 'power2.out' });
    }
    playing.current = tl;
  }, []);

  // Where the pointer is on the sky, written straight to the readout (no re-render per move).
  const track = (e: React.PointerEvent) => {
    const out = readout.current, el = host.current;
    if (!out || !el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const s = toSky(view.current, x, y);
    const a = atlasRef.current;
    const where = a ? `   ${a.fullNames[constellationAt(a, s.ra, s.dec)]}` : '';
    out.textContent = `${formatRa(s.ra, 1)}  ${formatDec(s.dec, 0)}   ${s.ra.toFixed(3)}\u00b0 ${s.dec >= 0 ? '+' : '\u2212'}${Math.abs(s.dec).toFixed(3)}\u00b0${where}`;
    // Resting the pointer on a star of a figure plays that figure again.
    if (!a || e.pointerType !== 'mouse') return;
    const h = hover.current;
    const fig = drag.current ? -1 : figureNear(a, view.current, x, y);
    if (fig === h.fig) return;
    if (h.timer) clearTimeout(h.timer);
    h.fig = fig;
    // If another figure is mid-play, wait for it: the pointer is still resting here.
    const arm = (wait: number) => setTimeout(() => {
      if (h.fig !== fig) return;
      if (playing.current) h.timer = arm(400); else playFigure(fig);
    }, wait);
    h.timer = fig >= 0 ? arm(350) : null;
  };

  const setPick = useCallback((p: Pick | null) => { pickRef.current = p; setPickState(p); dirty.current = true; }, []);
  const hold = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; };
  const release = () => { hold(); closeTimer.current = setTimeout(() => { if (pickRef.current?.kind === 'star') setPick(null); }, 260); };

  // The card mounts a render after the pick is set: place it once it exists.
  useEffect(() => { dirty.current = true; }, [pick]);

  // Boot: the 3D code and the catalogue load after the page's text is on screen.
  useEffect(() => {
    let dead = false;
    let created: Sky | null = null;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = host.current!, cv = canvas.current!;
    // While the opening plays the canvas covers the whole window, so it is measured against that.
    let fullscreen = false;
    const measure = () => {
      const r = el.getBoundingClientRect();
      view.current.width = Math.max(1, Math.round(fullscreen ? innerWidth : r.width));
      view.current.height = Math.max(1, Math.round(fullscreen ? innerHeight : r.height));
      // Full window: keep the projection centred on the map's own box, at the map's own scale,
      // so the stars are exactly where they will be when the canvas returns to that box.
      view.current.cy = fullscreen ? r.top + r.height / 2 : undefined;
      view.current.span = fullscreen ? Math.min(r.width, r.height) : undefined;
      dirty.current = true;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);

    // Markers and the card are moved by hand each frame: no React render while dragging.
    const place = () => {
      // Markers live inside the map's box, so they are placed against the box even while the
      // canvas itself covers the whole window.
      const box = el.getBoundingClientRect();
      const v: View = fullscreen ? { ...view.current, width: box.width, height: box.height, cy: undefined, span: undefined } : view.current;
      const s = sky.current;
      if (!layer.current || !s) return;
      const kids = layer.current.children;
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i] as HTMLElement;
        const ra = Number(k.dataset.ra), dec = Number(k.dataset.dec);
        const p = toScreen(v, ra, dec);
        const on = !!p && p.x > -40 && p.x < v.width + 40 && p.y > -40 && p.y < v.height + 40;
        k.style.visibility = on ? 'visible' : 'hidden';
        if (on) {
          k.style.translate = `${p!.x}px ${p!.y}px`;
          if (k.dataset.field) k.style.setProperty('--side', `${(FIELD_DEG / v.fov) * Math.min(v.width, v.height)}px`);
          if (k.dataset.sat) { // a ring from far off; the spacecraft itself, growing, as you zoom in
            k.style.setProperty('--size', `${Math.round((Math.min(v.width, v.height) * 5) / v.fov)}px`);
            k.style.setProperty('--near', String(Math.min(1, Math.max(0, (62 - v.fov) / 30))));
          }
        }
      }
      const c = card.current, pk = pickRef.current;
      if (c && pk) {
        const at = pk.kind === 'star' ? pk.star : pk;
        const idx = pk.kind === 'star' ? notedStars.indexOf(pk.star) : -1;
        const pos = idx >= 0 ? s.noted[idx] : at;
        const p = toScreen(v, pos.ra, pos.dec);
        if (p) {
          const left = p.x > v.width * 0.62;
          const up = p.y > v.height * 0.55;
          c.style.translate = `${Math.min(v.width - 12, Math.max(12, p.x))}px ${Math.min(v.height - 12, Math.max(12, p.y))}px`;
          c.dataset.side = `${left ? 'l' : 'r'}${up ? 'u' : 'd'}`;
        }
      }
    };

    // Phones get a lighter loop: half the frame rate and no idle drift, so page scrolling stays smooth.
    const light = matchMedia('(max-width: 767px), (pointer: coarse)').matches;
    let frame = 0, scan = 0;
    const tick = (time: number) => {
      const s = sky.current;
      if (!s || (!visible && !fullscreen) || document.hidden) return;
      if (light && !fullscreen && !dirty.current && frame++ % 2) return;
      const v = view.current;
      // Idle: the sky turns very slowly until someone touches it.
      if (!light && !reduced && !bridge.active && !pickRef.current && time - touched.current > 4) {
        v.ra = (v.ra + 0.004) % 360;
        dirty.current = true;
      }
      if (dirty.current) { s.setView(v); place(); el.toggleAttribute('data-near', v.fov < 45); dirty.current = false; }
      // In full screen, a few times a second: has the visitor come across a constellation?
      const a = atlasRef.current;
      if (a && fullRef.current && !playing.current && !pickRef.current && el.dataset.filling === undefined && time > nextAt.current && scan++ % 12 === 0) {
        const idx = chooseFigure(a, v, seen.current);
        if (idx >= 0) playFigure(idx);
      }
      s.render(time);
    };

    (async () => {
      try {
        const [{ createSky }, buf] = await Promise.all([
          import('@/sky/scene'),
          fetch('/sky/stars.bin').then((r) => { if (!r.ok) throw new Error('catalogue'); return r.arrayBuffer(); }),
        ]);
        if (dead) return;
        created = createSky(cv, new Float32Array(buf), notedStars);
        sky.current = created;
        created.setShine(reduced ? 0 : 1);
        // If the renderer is rebuilt while full screen is open, give it back what full screen shows.
        if (fullRef.current) {
          created.loadMilkyWay('/sky/milkyway.webp');
          created.setGlow(1);
          if (atlasRef.current) { created.setFigures(atlasRef.current.list); created.setLines(lineState.current); }
        }
        // Snap marker positions to the catalogue dots.
        const kids = layer.current?.querySelectorAll<HTMLElement>('[data-star]') ?? [];
        kids.forEach((k, i) => { k.dataset.ra = String(created!.noted[i].ra); k.dataset.dec = String(created!.noted[i].dec); });
        dirty.current = true;
        gsap.ticker.add(tick);
        setState('ready');
        joinFilm(created, reduced, (full) => { fullscreen = full; measure(); });
        // Fetch the Milky Way for full screen while nothing else is happening, so the way in has
        // nothing left to load. (ponytail: no idle callback in Safari; a plain delay does there.)
        const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 6000 }) : setTimeout(fn, 2500));
        idle(() => { if (!dead) created?.loadMilkyWay('/sky/milkyway.webp'); });
      } catch {
        endIntro();
        if (!dead) setState('nogl');
      }
    })();

    return () => {
      dead = true;
      ro.disconnect();
      io.disconnect();
      gsap.ticker.remove(tick);
      bridge.active = false;
      // Lift the veil if the map is really gone (leaving the page), not on a development re-mount.
      setTimeout(() => { if (!document.querySelector('.sky')) endIntro(); }, 60);
      created?.dispose();
      sky.current = null;
    };
  }, [playFigure]);

  // The way into the full sky: the camera pulls back and turns a little, so far more of the sky
  // opens up around the patch you were looking at, while the Milky Way and the stars' colours
  // come up. One move on the map itself, nothing loaded or built while it plays. Out is the same
  // move backwards, to where you came in.
  const swing = useCallback((enter: boolean) => new Promise<void>((done) => {
    const s = sky.current, v = view.current;
    swingTween.current?.kill();
    if (!s || matchMedia('(prefers-reduced-motion: reduce)').matches) { s?.setGlow(enter ? 1 : 0); done(); return; }
    if (enter) home.current = { ra: v.ra, dec: v.dec, fov: v.fov };
    const back = home.current ?? { ra: v.ra, dec: v.dec, fov: v.fov };
    const from = { ra: v.ra, dec: v.dec, fov: v.fov, glow: enter ? 0 : 1 };
    const to = enter
      ? { ra: back.ra - 9, dec: back.dec - 4, fov: Math.min(FOV_MAX, back.fov * 1.45), glow: 1 }
      : { ...back, glow: 0 };
    const dra = ((to.ra - from.ra + 540) % 360) - 180; // the short way round
    const k = { t: 0 };
    swingTween.current = gsap.to(k, {
      t: 1, duration: enter ? 2.4 : 2.2, ease: enter ? 'power3.inOut' : 'power2.inOut',
      onUpdate: () => {
        v.ra = (from.ra + dra * k.t + 360) % 360;
        v.dec = from.dec + (to.dec - from.dec) * k.t;
        v.fov = from.fov + (to.fov - from.fov) * k.t;
        // The Milky Way leads on the way in and goes first on the way out.
        s.setGlow(enter ? Math.min(1, k.t * 1.4) : Math.max(0, 1 - k.t * 1.6));
        dirty.current = true;
      },
      onComplete: () => done(),
    });
  }), []);

  // Full screen: the whole window is the map.
  const applyFull = useCallback((next: boolean) => {
    if (fullRef.current === next) return;
    fullRef.current = next;
    setFullState(next);
    setPick(null);
    const html = document.documentElement;
    html.classList.toggle('sky-full', next);
    fillTween.current?.kill();
    const s = sky.current, el = host.current;
    if (next) {
      // Each visit to the full sky starts fresh: every figure plays once as it is come across.
      seen.current.clear();
      nextAt.current = gsap.ticker.time + 2.8;
      if (!atlasRef.current) {
        fetch('/sky/constellations.json')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d || !sky.current) return;
            const a = makeAtlas(d);
            sky.current.setFigures(a.list);
            atlasRef.current = a;
            setAtlas(a);
            setFound(readFound().length);
          })
          .catch(() => {}); // the map works without the figures
      }
      // The Milky Way and the stronger star colours come up once the stars are in.
      s?.loadMilkyWay('/sky/milkyway.webp'); // already fetched while the page was idle; this is a no-op then
      s?.setFill(1);
      stopScroll();
      // Ask the browser for real full screen too (where it is refused the map still fills the
      // window), and start the move only once the window has finished changing size, so the
      // resize does not land in the middle of it.
      let started = false;
      const go = () => { if (!started && fullRef.current) { started = true; swing(true); } };
      document.addEventListener('fullscreenchange', () => setTimeout(go, 60), { once: true });
      setTimeout(go, 320);
      html.requestFullscreen?.().catch(go);
    } else {
      playing.current?.kill();
      playing.current = null;
      if (hover.current.timer) clearTimeout(hover.current.timer);
      hover.current = { fig: -1, timer: null };
      Object.assign(lineState.current, { active: -1, draw: 0, alpha: 0, all: 0 });
      s?.setLines(lineState.current);
      conLabel.current?.classList.remove('is-on');
      setLinesOn(false);
      startScroll();
      swingTween.current?.kill();
      s?.setGlow(0);
      s?.setFill(1);
      if (el) delete el.dataset.filling;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    touched.current = gsap.ticker.time;
    dirty.current = true;
  }, [setPick, swing]);
  const setFull = useCallback((next: boolean) => {
    if (fullRef.current === next || leaving.current) return;
    if (next) { applyFull(true); return; }
    leaving.current = true;
    // The page's own text fades back in slowly while the sky is still gliding home, so it is
    // already there when the move ends; the menu follows.
    const html = document.documentElement;
    html.classList.add('sky-leaving');
    // Full screen's own things bow out first: the constellation being drawn, its name, the tools.
    playing.current?.kill();
    playing.current = null;
    conLabel.current?.classList.remove('is-on');
    const L = lineState.current;
    gsap.to(L, { alpha: 0, all: 0, duration: 0.7, ease: 'power1.out', onUpdate: () => sky.current?.setLines(L) });
    swing(false).then(() => {
      leaving.current = false;
      html.classList.add('sky-return');
      applyFull(false);
      html.classList.remove('sky-leaving');
      setTimeout(() => html.classList.remove('sky-return'), 2400);
    }); // back the way we came, then leave
  }, [applyFull, swing]);
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && fullRef.current && !pickRef.current) setFull(false); };
    // Buttons elsewhere on the page can ask for full screen.
    const onOpen = () => setFull(true);
    document.addEventListener('fullscreenchange', onFs);
    addEventListener('keydown', onEsc);
    addEventListener(OPEN_FULL_SKY, onOpen);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      removeEventListener('keydown', onEsc);
      removeEventListener(OPEN_FULL_SKY, onOpen);
      // Leaving the page (for the viewer, say): give the window back.
      if (fullRef.current) {
        fullRef.current = false;
        document.documentElement.classList.remove('sky-full');
        startScroll();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      }
    };
  }, [setFull]);

  // While full screen is open: fetch SPHEREx's orbit once, then work out where it is every second
  // and put its marker there. The picture of it is rendered once, after the way in has finished.
  useEffect(() => {
    if (!full) return;
    let dead = false, timer = 0;
    (async () => {
      try {
        const [{ tracker }, tle] = await Promise.all([import('@/sky/orbit'), fetch('/api/orbit').then((r) => r.json())]);
        if (dead) return;
        const where = tracker(tle.line1, tle.line2);
        const tick = () => {
          const f = where(new Date()), el = satEl.current;
          if (!f || !el) return;
          el.dataset.ra = String(f.ra);
          el.dataset.dec = String(f.dec);
          el.hidden = false;
          if (satLabel.current) satLabel.current.textContent = `SPHEREx · ${Math.round(f.altitude)} km up · ${f.speed.toFixed(1)} km/s${tle.stale ? ' · orbit data may be days old' : ''}`;
          if (following.current) { view.current.ra = f.ra; view.current.dec = f.dec; }
          dirty.current = true;
        };
        tick();
        timer = window.setInterval(tick, 1000);
      } catch { /* no orbit, no marker: the map works without it */ }
    })();
    const later = window.setTimeout(() => {
      if (!askedImg.current) { askedImg.current = true; import('@/sky/portrait').then((m) => m.craftPortrait()).then(setSatImg).catch(() => { askedImg.current = false; }); }
    }, 3400);
    return () => { dead = true; following.current = false; flight.current?.kill(); flight.current = null; clearInterval(timer); clearTimeout(later); };
  }, [full]);

  // Stop riding along with SPHEREx, and stop a move to it or to the Milky Way that is still running:
  // the move to SPHEREx starts the ride when it ends, so it must not finish after the visitor has gone elsewhere.
  const letGo = () => {
    following.current = false;
    flight.current?.kill();
    flight.current = null;
  };

  // Turn to SPHEREx, close in on it, and ride along until the visitor next moves the sky.
  const findSat = () => {
    const v = view.current, el = satEl.current;
    if (!el || el.hidden) return;
    setPick(null);
    letGo();
    const from = { ra: v.ra, dec: v.dec, fov: v.fov }, t = { k: 0 };
    flight.current = gsap.to(t, {
      k: 1, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.8, ease: 'power2.inOut', overwrite: true,
      onUpdate: () => { // aim at where it is now, not where it was when the move began
        const ra = Number(el.dataset.ra), dec = Number(el.dataset.dec), dra = ((ra - from.ra + 540) % 360) - 180;
        v.ra = (from.ra + dra * t.k + 360) % 360;
        v.dec = from.dec + (dec - from.dec) * t.k;
        v.fov = from.fov + (16 - from.fov) * t.k;
        dirty.current = true;
        touched.current = gsap.ticker.time;
      },
      onComplete: () => { following.current = true; },
    });
  };

  // Turn the sky, by the short way round, until the centre of the Milky Way is in the middle.
  const GALACTIC_CENTRE = { ra: 266.42, dec: -28.94, fov: 78 };
  const centreMilkyWay = () => {
    const v = view.current;
    setPick(null);
    letGo();
    const dra = ((GALACTIC_CENTRE.ra - v.ra + 540) % 360) - 180;
    const from = { ra: v.ra, dec: v.dec, fov: v.fov }, t = { k: 0 };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    flight.current = gsap.to(t, {
      k: 1, duration: reduced ? 0 : 1.6, ease: 'power2.inOut', overwrite: true,
      onUpdate: () => {
        v.ra = (from.ra + dra * t.k + 360) % 360;
        v.dec = from.dec + (GALACTIC_CENTRE.dec - from.dec) * t.k;
        v.fov = from.fov + (GALACTIC_CENTRE.fov - from.fov) * t.k;
        dirty.current = true;
        touched.current = gsap.ticker.time;
      },
    });
  };

  const toggleLines = () => {
    const on = !linesOn, L = lineState.current;
    setLinesOn(on);
    gsap.to(L, { all: on ? ALL_LINES : 0, duration: 0.5, ease: 'power2.out', overwrite: 'auto', onUpdate: () => sky.current?.setLines(L) });
    dirty.current = true;
  };

  // Pointer: drag turns the sky; a click without a drag picks.
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
    letGo();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    touched.current = gsap.ticker.time;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
    const p = pan(view.current, dx, dy);
    view.current.ra = p.ra; view.current.dec = p.dec;
    dirty.current = true;
    touched.current = gsap.ticker.time;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved > 6) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const s = toSky(view.current, e.clientX - r.left, e.clientY - r.top);
    setPick({ kind: 'point', ra: s.ra, dec: s.dec });
    // Say what is there, if a catalogue knows. The card works without the answer.
    const radius = Math.max(20, Math.round((view.current.fov / Math.min(view.current.width, view.current.height)) * 3600 * 14));
    fetch(`/api/resolve?ra=${s.ra.toFixed(5)}&dec=${s.dec.toFixed(5)}&r=${Math.min(radius, 1800)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => {
        const cur = pickRef.current;
        if (j?.name && cur?.kind === 'point' && cur.ra === s.ra) setPick({ ...cur, near: { name: j.name, type: j.type ?? '' } });
      })
      .catch(() => {});
  };

  const nudge = (dra: number, ddec: number, zoom = 1) => {
    const v = view.current;
    if (dra || ddec) letGo(); // turning the sky leaves SPHEREx; zooming alone keeps riding with it
    v.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, v.fov * zoom));
    const p = pan(v, (dra * Math.min(v.width, v.height)) / 6, (ddec * Math.min(v.width, v.height)) / 6);
    v.ra = p.ra; v.dec = p.dec;
    dirty.current = true;
    touched.current = gsap.ticker.time;
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') nudge(1, 0); else if (e.key === 'ArrowRight') nudge(-1, 0);
    else if (e.key === 'ArrowUp') nudge(0, 1); else if (e.key === 'ArrowDown') nudge(0, -1);
    else if (e.key === '+' || e.key === '=') nudge(0, 0, 0.8); else if (e.key === '-') nudge(0, 0, 1.25);
    else if (e.key === 'Escape') setPick(null);
    else return;
    e.preventDefault();
  };
  // Pinch and ctrl-wheel zoom; a plain wheel scrolls the page as usual.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const v = view.current;
      v.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, v.fov * Math.exp(e.deltaY * 0.01)));
      dirty.current = true;
      touched.current = gsap.ticker.time;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // "Blink": a plate grows out of the chosen point, then the viewer opens.
  const develop = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const href = e.currentTarget.getAttribute('href')!;
    const c = card.current?.getBoundingClientRect();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !c) { router.push(href); return; }
    const plate = document.createElement('div');
    plate.className = 'develop';
    plate.style.left = `${c.left}px`;
    plate.style.top = `${c.top}px`;
    document.body.appendChild(plate);
    const side = Math.hypot(innerWidth, innerHeight) * 2.1;
    router.prefetch(href);
    gsap.timeline()
      .fromTo(plate, { width: 6, height: 6, xPercent: -50, yPercent: -50 }, { width: side, height: side, duration: 0.55, ease: 'expo.in' })
      .call(() => router.push(href))
      .to(plate, { autoAlpha: 0, duration: 0.35, delay: 0.45 })
      .call(() => plate.remove());
  };

  const at = pick ? (pick.kind === 'star' ? pick.star : pick) : null;
  return (
    <div className="sky" ref={host} data-state={state} data-lines={linesOn ? '' : undefined} onPointerMove={track} onPointerDown={track}>
      <canvas ref={canvas} className="sky__canvas" aria-hidden="true" />
      <div
        className="sky__pad" role="application" tabIndex={0}
        aria-label="Sky map. Arrow keys turn the sky, plus and minus zoom. The stars with notes are also listed below the map."
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }} onKeyDown={onKey}
      />
      <div className="sky__layer" ref={layer}>
        {full && atlas && atlas.names.map((n) => (
          <span key={`${n.name}${n.ra}`} className="sky__sname" data-tier={n.mag <= 1.7 ? 1 : 2} data-ra={n.ra} data-dec={n.dec} aria-hidden="true">{n.name}</span>
        ))}
        {full && atlas && linesOn && atlas.list.map((f) => (
          <span key={f.name} className="sky__con is-on" data-ra={f.ra} data-dec={f.dec} aria-hidden="true"><b>{f.name}</b></span>
        ))}
        <span ref={conLabel} className="sky__con sky__con--active" aria-hidden="true"><b /><i /></span>
        {notedStars.map((s) => (
          <button
            key={s.id} type="button" data-star data-ra={s.ra} data-dec={s.dec}
            className={`sky__star${s.target ? ' sky__star--target' : ''}${pick?.kind === 'star' && pick.star === s ? ' is-open' : ''}`}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') { hold(); setPick({ kind: 'star', star: s }); } }}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') release(); }}
            onFocus={() => { hold(); setPick({ kind: 'star', star: s }); }}
            onClick={() => { hold(); setPick({ kind: 'star', star: s }); }}
            aria-label={`${s.name}. ${s.kind}.`}
          >
            {s.target && <span className="sky__label" aria-hidden="true">{s.name}</span>}
          </button>
        ))}
        {fresh.map((f) => (
          <span key={`${f.ra},${f.dec}`} className="sky__field" data-field data-ra={f.ra} data-dec={f.dec} aria-hidden="true" />
        ))}
        {pick?.kind === 'point' && <span className="sky__mark" data-ra={pick.ra} data-dec={pick.dec} aria-hidden="true" />}
        {full && (
          <button ref={satEl} type="button" hidden data-sat data-ra="0" data-dec="0" className="sky__sat" onClick={findSat} aria-label="SPHEREx, where it is right now. Go to it.">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {satImg && <img src={satImg} alt="" />}
            <i aria-hidden="true" />
            <span className="sky__satlabel"><span ref={satLabel}>SPHEREx</span><em>Drawn far larger than life: from here it would be much smaller than a pixel.</em></span>
          </button>
        )}
      </div>

      {at && pick && (
        <div className="sky__card on-glass" ref={card} role="dialog" aria-label={pick.kind === 'star' ? pick.star.name : 'Chosen position'}
          onPointerEnter={hold} onPointerLeave={(e) => { if (e.pointerType === 'mouse') release(); }}>
          <div className="sky__cardin">
            {pick.kind === 'star' ? (
              <>
                <p className="sky__name">{pick.star.name}</p>
                <p className="sky__kind">{pick.star.kind}{pick.star.distance ? `, ${pick.star.distance}` : ''}</p>
                <p className="sky__note">{pick.star.note}</p>
              </>
            ) : (
              <>
                <p className="sky__name">{pick.near?.name ?? 'This patch of sky'}</p>
                {pick.near?.type && <p className="sky__kind">{pick.near.type}, the nearest catalogued object</p>}
              </>
            )}
            <p className="sky__coords">{formatRa(at.ra, 1)} {formatDec(at.dec, 0)}</p>
            <div className="sky__links">
              <a className="btn" href={viewerHref(pick.kind === 'star' ? { ...at, name: pick.star.name, det: pick.star.det } : { ...at, name: pick.near?.name })} onClick={develop} data-no-transition>
                <Hop tick={false}>{pick.kind === 'star' ? 'Blink this star' : 'Blink this patch'}</Hop>
              </a>
              {pick.kind === 'star' && pick.star.target && <a className="inline-link" href={`/targets/${pick.star.target}`}>About this target</a>}
              <button type="button" className="inline-link" onClick={() => setPick(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="sky__tools" role="group" aria-label="Map controls">
        <button type="button" className="sky__fullbtn" onClick={() => setFull(!full)} aria-pressed={full} aria-label={full ? 'Leave full screen' : 'Explore the full sky'}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {full
              ? <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" />
              : <path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" />}
          </svg>
          <span>{full ? 'Exit' : 'Explore the full sky'}</span>
        </button>
        <button type="button" onClick={() => nudge(0, 0, 0.75)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => nudge(0, 0, 1.33)} aria-label="Zoom out">&minus;</button>
        <button type="button" onClick={() => nudge(1, 0)} aria-label="Turn east">&larr;</button>
        <button type="button" onClick={() => nudge(-1, 0)} aria-label="Turn west">&rarr;</button>
        <button type="button" onClick={() => nudge(0, 1)} aria-label="Turn north">&uarr;</button>
        <button type="button" onClick={() => nudge(0, -1)} aria-label="Turn south">&darr;</button>
        {full && <button type="button" className="sky__linesbtn" onClick={centreMilkyWay} aria-label="Centre the Milky Way">Milky Way</button>}
        {full && <button type="button" className="sky__linesbtn" onClick={findSat} aria-label="Go to SPHEREx, where it is right now">SPHEREx</button>}
        {full && atlas && (
          <button type="button" className="sky__linesbtn" onClick={toggleLines} aria-pressed={linesOn} aria-label={linesOn ? 'Hide the constellation lines' : 'Show all constellation lines'}>Lines</button>
        )}
      </div>
      {full && atlas && <p className="sky__found" aria-live="polite">{found} of {atlas.ids.length} constellations found</p>}
      {full && <p className="sky__readout" ref={readout} aria-hidden="true">Point at the sky for coordinates</p>}
      {full && <p className="sky__hint">Turn the sky to find the constellations. Click any star, or any spot, to blink it. Esc leaves full screen.</p>}
      {state === 'nogl' && <p className="sky__fallback">This is a still picture of the sky: the live map needs WebGL, which this browser has switched off. The search box and the list of stars below work without it.</p>}
    </div>
  );
}

/** Lift the dark veil that the page starts under (set by the inline script in the layout). */
function endIntro() {
  document.documentElement.classList.remove('intro-pending', 'intro-veil');
}

/**
 * The opening belongs to the launch film (LaunchFilm.tsx). The map's part: fill the whole window,
 * projected at the map's own scale so nothing jumps afterwards, show as many stars as the film
 * asks for, and at the end let the site fade in around them. Never under reduced motion.
 */
function joinFilm(sky: Sky, reduced: boolean, setFullscreen: (on: boolean) => void) {
  const html = document.documentElement;
  if (reduced || !html.classList.contains('intro-pending')) { endIntro(); return; }
  setFullscreen(true);
  sky.setFill(0);
  bridge.active = true;
  bridge.setStars = (fill) => sky.setFill(fill);
  bridge.finish = () => {
    if (!bridge.active) return;
    bridge.active = false;
    sky.setFill(1);
    html.classList.add('intro-fill');
    html.classList.remove('intro-veil'); // the site fades in beneath the stars
    // When the fade is done, hand the canvas back to the map's box. The stars do not move.
    setTimeout(() => { html.classList.remove('intro-pending', 'intro-fill'); setFullscreen(false); }, 950);
  };
}
