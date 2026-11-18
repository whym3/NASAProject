'use client';
// The full-screen view's second scale: the Solar System in 3D (see sky/solar.ts). Mounted only
// while it is the chosen view, so nothing is loaded or drawn otherwise.
import { gsap } from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { viewerHref } from '@/data/stars';
import { formatDec, formatRa, mjdToDate } from '@/lib/astro';
import type { Picked, Solar } from '@/sky/solar';
import { Hop } from './Hop';

export function SolarSystem() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const solar = useRef<Solar | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'nogl'>('loading');
  const [credit, setCredit] = useState('');
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const card = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const pickRef = useRef<Picked | null>(null);
  const [pick, setPickState] = useState<Picked | null>(null);
  const setPick = (p: Picked | null) => { pickRef.current = p; setPickState(p); };
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let dead = false;
    const el = host.current!, cv = canvas.current!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ro = new ResizeObserver(() => solar.current?.resize(el.clientWidth, el.clientHeight));
    // Labels follow their bodies; a planet's name steps aside when it would sit on the Sun's.
    const place = () => {
      const s = solar.current, box = tags.current;
      if (!s || !box) return;
      const all = s.labels(), sun = all[0];
      all.forEach((l, k) => {
        const t = box.children[k] as HTMLElement | undefined;
        if (!t) return;
        const on = !Number.isNaN(l.x) && (k === 0 || Math.hypot(l.x - sun.x, l.y - sun.y) > 26 || Number.isNaN(sun.x));
        t.style.visibility = on ? 'visible' : 'hidden';
        if (on) t.style.translate = `${l.x}px ${l.y}px`;
      });
      // The chosen thing: a mark on it, and the card beside it, on the side with more room.
      const pk = pickRef.current, at = pk && s.project(pk.at), c = card.current, m = mark.current;
      for (const e of [c, m]) if (e) e.style.visibility = at ? 'visible' : 'hidden';
      if (!at) return;
      if (m) m.style.translate = `${at.x}px ${at.y}px`;
      if (c) {
        c.style.translate = `${Math.min(el.clientWidth - 12, Math.max(12, at.x))}px ${Math.min(el.clientHeight - 12, Math.max(12, at.y))}px`;
        c.dataset.side = `${at.x > el.clientWidth * 0.62 ? 'l' : 'r'}${at.y > el.clientHeight * 0.55 ? 'u' : 'd'}`;
      }
    };
    (async () => {
      try {
        const [{ createSolar }, data, stars] = await Promise.all([
          import('@/sky/solar'),
          fetch('/sky/solar.json').then((r) => { if (!r.ok) throw new Error('solar'); return r.json(); }),
          fetch('/sky/stars.bin').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null), // already cached by the sky
        ]);
        if (dead) return;
        solar.current = createSolar(cv, el, data, stars && new Float32Array(stars), reduced);
        solar.current.resize(el.clientWidth, el.clientHeight);
        ro.observe(el);
        setNames(solar.current.labels().map(({ id, name }) => ({ id, name })));
        setCredit(data.credit);
        gsap.ticker.add(place);
        setState('ready');
        el.focus({ preventScroll: true });
      } catch {
        if (!dead) setState('nogl');
      }
    })();
    return () => {
      dead = true;
      ro.disconnect();
      gsap.ticker.remove(place);
      solar.current?.dispose();
      solar.current = null;
    };
  }, []);

  // Resting the mouse on anything shows its card, and it closes soon after the mouse moves off
  // (unless onto the card). A click, a tap or the keyboard pins the card until the next choice.
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = () => {
    for (const t of [closeTimer, hoverTimer]) { if (t.current) clearTimeout(t.current); t.current = null; }
  };
  const release = () => { hold(); closeTimer.current = setTimeout(() => { if (!pinned.current) setPick(null); }, 260); };
  const show = (p: Picked | null, pin: boolean) => {
    if (pin) pinned.current = !!p;
    else if (!p) { if (pickRef.current && !pinned.current) release(); return; }
    hold();
    if (p && p.id === pickRef.current?.id) return;
    if (!pin) pinned.current = false;
    setPick(p);
    // A catalogue star gets its name, if a catalogue knows it: asked once the pointer has settled on it.
    if (nameTimer.current) clearTimeout(nameTimer.current);
    if (p?.kind !== 'star') return;
    nameTimer.current = setTimeout(() => {
      if (pickRef.current?.id !== p.id) return;
      fetch(`/api/resolve?ra=${p.ra.toFixed(5)}&dec=${p.dec.toFixed(5)}&r=30`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j?.name && pickRef.current?.id === p.id) setPick({ ...p, name: j.name }); })
        .catch(() => {});
    }, pin ? 0 : 350);
  };
  const choose = (x: number, y: number, pin = true) => show(solar.current?.pick(x, y) ?? null, pin);
  const chooseTag = (id: string, pin: boolean) => {
    const l = solar.current?.labels().find((x) => x.id === id);
    if (l && !Number.isNaN(l.x)) choose(l.x, l.y, pin);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = down.current, r = host.current?.getBoundingClientRect();
    down.current = null;
    if (d && r && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) choose(e.clientX - r.left, e.clientY - r.top);
  };
  // Hover, mouse only and never mid-drag, counts once the pointer pauses: with a card open the
  // pause is longer, so heading for its button across other asteroids does not swap it.
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons || e.target !== canvas.current) return;
    const r = host.current!.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => choose(x, y, false), pickRef.current ? 180 : 40);
  };
  useEffect(() => () => { hold(); for (const t of [hoverTimer.current, nameTimer.current]) if (t) clearTimeout(t); }, []);

  return (
    <div
      className="solar" ref={host} data-state={state} tabIndex={0} role="application"
      aria-label="The Solar System in 3D. Drag to turn around the Sun, scroll or pinch to zoom. Arrow keys move the view; with Shift they turn it. Point at or click a planet, an asteroid or a star to blink it; the planets are also listed as buttons."
      onPointerDown={(e) => { if (e.target === canvas.current) down.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={onUp}
      onPointerMove={onMove}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') release(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && pickRef.current) { e.stopPropagation(); setPick(null); } }}
    >
      <canvas ref={canvas} className="solar__canvas" aria-hidden="true" />
      <div className="solar__tags" ref={tags} role="group" aria-label="The Sun and the planets">
        {names.map((n) => (
          <button key={n.id} type="button" className={`solar__tag${n.id === 'sun' ? ' solar__tag--sun' : ''}`}
            onClick={() => chooseTag(n.id, true)} onFocus={() => chooseTag(n.id, true)}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') chooseTag(n.id, false); }}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') release(); }}>
            {n.name}
          </button>
        ))}
      </div>
      {pick && <span ref={mark} className="sky__mark solar__mark" aria-hidden="true" />}
      {pick && <PickCard ref={card} pick={pick} onHold={hold} onRelease={release} onClose={() => { pinned.current = false; setPick(null); host.current?.focus(); }} />}
      <div className="solar__zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => solar.current?.zoom(0.7)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => solar.current?.zoom(1.43)} aria-label="Zoom out">&minus;</button>
      </div>
      <ul className="solar__key" aria-label="Small bodies SPHEREx photographed">
        <li style={{ '--c': '#8fa3b8' } as React.CSSProperties}>Asteroids</li>
        <li style={{ '--c': '#c9a56a' } as React.CSSProperties}>Jupiter trojans</li>
        <li style={{ '--c': '#ff7a59' } as React.CSSProperties}>Near-Earth</li>
        <li style={{ '--c': '#b48cff' } as React.CSSProperties}>Centaurs</li>
        <li style={{ '--c': '#e8f4ff' } as React.CSSProperties}>Comets</li>
      </ul>
      <p className="solar__hint">
        The planets where they are today; 7,083 asteroids and comets where SPHEREx photographed them. Distances to scale, bodies drawn far larger than life.
        {credit && <small>{credit}</small>}
      </p>
      {state === 'nogl' && <p className="sky__fallback">The Solar System view needs WebGL, which this browser has switched off.</p>}
    </div>
  );
}

const DAY = (mjd: number) => mjdToDate(mjd).toISOString().slice(0, 10);

function PickCard({ pick, onClose, onHold, onRelease, ref }: { pick: Picked; onClose: () => void; onHold: () => void; onRelease: () => void; ref: React.Ref<HTMLDivElement> }) {
  const sky = Number.isFinite(pick.ra);
  const name = pick.name || 'A star';
  const kind =
    pick.kind === 'small' ? `${pick.type[0].toUpperCase()}${pick.type.slice(1)}, seen by SPHEREx on ${DAY(pick.mjd!)}`
    : pick.kind === 'star' ? `Star, magnitude ${pick.mag!.toFixed(1)}`
    : pick.type;
  const note =
    pick.id === 'sun' ? 'SPHEREx never looks anywhere near the Sun, so there is nothing of it to blink.'
    : pick.id === 'earth' ? 'You are here. SPHEREx circles just above it, looking out.'
    : pick.kind === 'planet' ? `This is where ${name} is in our sky today. SPHEREx photographed that spot on other days, so the planet itself will not be in the frames.`
    : pick.kind === 'small' ? 'Where it was midway through SPHEREx\u2019s visit. In the viewer it crosses the field during that visit and is gone from the other passes.'
    : null;
  const label = pick.kind === 'small' ? `Blink this ${pick.type === 'comet' ? 'comet' : 'object'}` : pick.kind === 'planet' ? 'Blink this spot' : 'Blink this star';
  return (
    <div className="sky__card on-glass" ref={ref} role="dialog" aria-label={name}
      onPointerEnter={onHold} onPointerLeave={(e) => { if (e.pointerType === 'mouse') onRelease(); }}>
      <div className="sky__cardin">
        <p className="sky__name">{name}</p>
        <p className="sky__kind">{kind}</p>
        {note && <p className="sky__note">{note}</p>}
        {sky && pick.id !== 'sun' && <p className="sky__coords">{formatRa(pick.ra, 1)} {formatDec(pick.dec, 0)}</p>}
        <div className="sky__links">
          {sky && pick.id !== 'sun' && (
            // A small body moves up to 7′ during a visit: a 10′ field holds its whole track, and bursts show it moving.
            <a className="btn" href={`${viewerHref({ ra: pick.ra, dec: pick.dec, name: pick.name || undefined })}${pick.kind === 'small' ? '&fov=600&mode=burst' : ''}`}>
              <Hop tick={false}>{label}</Hop>
            </a>
          )}
          <button type="button" className="inline-link" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
