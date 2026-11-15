'use client';
// The opening: a rocket climbs across the window, releases SPHEREx, and the camera goes down
// the telescope into the sky map. Scrolling drives it (the page itself does not move until it
// ends). The film draws its own sky; where it is empty the star map underneath shows through.
// Along the bottom runs a mission timeline: the flight's events on a curved track, a marker
// that travels as you scroll, and the mission clock.
// `/?film=0.6` holds the film at that film time (see beats.ts), for checking a single frame.
import { gsap } from 'gsap';
import { useEffect, useRef } from 'react';
import { BLINK, EVENTS, STRETCH, filmTime, formatClock, missionClock, picture, scrollOf } from '@/film/beats';
import { bridge } from '@/film/bridge';
import type { Film } from '@/film/scene';

const SCREENS = 6 * STRETCH; // how many window-heights of scrolling the whole film takes
const ARC = 92; // height of the timeline's box, px
const MARKS = EVENTS.map((e) => scrollOf(e.at)); // where each event sits along the track, 0 to 1
// Labels alternate above and below the track so neighbours never collide.
const UNDER = [false, false, true, false, true, false];
// Name tags: a dot on the thing, a short leader line, the name. The rocket at the start; each
// satellite once it is flying free. PUNCH is one narrow-field and three wide-field imagers; which
// of the four sat where on the ring is not published, so that assignment is ours.
// Play runs the film by itself: the whole scroll in this many seconds, at half pace while the
// PUNCH satellites flash so each flash can be seen.
const PLAY_SECONDS = 40;
const NAMES = ['Falcon 9', 'SPHEREx', 'PUNCH NFI', 'PUNCH WFI-1', 'PUNCH WFI-2', 'PUNCH WFI-3'];

export function LaunchFilm() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dark = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGSVGElement>(null);
  const tags = useRef<SVGSVGElement>(null);
  const done = useRef<SVGPathElement>(null);
  const now = useRef<SVGCircleElement>(null);
  const clock = useRef<HTMLParagraphElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const play = useRef<HTMLButtonElement>(null);
  const flash = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    // The inline script in layout.tsx decides whether there is an opening (not under reduced motion).
    if (!html.classList.contains('intro-pending')) return;
    html.classList.add('film-on');
    const held = new URLSearchParams(location.search).get('film');
    let target = 0, p = 0; // scroll progress, 0 to 1
    let film: Film | null = null, ended = false, passed = -1, second = -1, touchY = 0;
    let playing = false, last = 0; // Play: the film runs by itself until the user scrolls
    const setPlaying = (on: boolean) => {
      playing = on;
      const b = play.current;
      if (!b) return;
      b.textContent = on ? 'Pause' : 'Play';
      b.setAttribute('aria-pressed', String(on));
    };
    // The name tags' positions, lightly smoothed (they already ignore the camera's shake; see
    // scene.ts), so the last frame-to-frame flutter goes too.
    const calm = new Float32Array(14).fill(NaN);

    // The track is an arc of a large circle, like a horizon. Its geometry follows the window.
    let along = (f: number) => ({ x: f, y: 0 });
    const layout = () => {
      const svg = arc.current;
      if (!svg) return;
      const W = innerWidth, x0 = W * 0.07, x1 = W * 0.93, chord = x1 - x0, rise = Math.min(54, Math.max(20, chord * 0.05));
      const base = ARC - 26, R = (chord * chord) / (8 * rise) + rise / 2, half = Math.asin(chord / 2 / R), cy = base - rise + R;
      along = (f) => { const a = half * (2 * f - 1); return { x: W / 2 + R * Math.sin(a), y: cy - R * Math.cos(a) }; };
      svg.setAttribute('viewBox', `0 0 ${W} ${ARC}`);
      svg.querySelectorAll('path').forEach((path) => path.setAttribute('d', `M ${x0} ${base} A ${R} ${R} 0 0 1 ${x1} ${base}`));
      svg.querySelectorAll('g').forEach((g, i) => { const q = along(MARKS[i]); g.setAttribute('transform', `translate(${q.x} ${q.y})`); });
    };

    const move = (by: number) => { if (playing) setPlaying(false); if (held === null && !ended) target = Math.min(1, Math.max(0, target + by)); };
    // Capture and stop: the page's own smooth scroll must not see these while the film runs.
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      move((e.deltaY * (e.deltaMode === 1 ? 16 : 1)) / (innerHeight * SCREENS));
    };
    const touchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY; };
    const touchMove = (e: TouchEvent) => {
      e.preventDefault(); e.stopPropagation();
      move(((touchY - e.touches[0].clientY) * 1.5) / (innerHeight * SCREENS));
      touchY = e.touches[0].clientY;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return end();
      const step = ({ ArrowDown: 0.03, PageDown: 0.1, ' ': 0.1, ArrowUp: -0.03, PageUp: -0.1 } as Record<string, number>)[e.key];
      if (step === undefined || e.target === skip.current || e.target === play.current) return;
      e.preventDefault(); e.stopPropagation();
      move(step);
    };
    const resize = () => { film?.resize(innerWidth, innerHeight); layout(); };

    const tick = () => {
      if (!film) return;
      const clockNow = gsap.ticker.time, dt = Math.min(0.1, clockNow - last);
      last = clockNow;
      if (playing) {
        const slow = filmTime(p) > BLINK[0] - 0.006 && filmTime(p) < BLINK[1] + 0.004 ? 0.5 : 1;
        target = Math.min(1, target + (dt * slow) / PLAY_SECONDS);
      }
      p += (target - p) * 0.12;
      const t = held === null ? filmTime(p) : Number(held) || 0;
      if (held !== null) p = scrollOf(t);
      const pic = picture(t);
      film.frame(pic, gsap.ticker.time);
      bridge.setStars(pic.stars);
      if (dark.current) dark.current.style.opacity = String(pic.done ? 0 : pic.dark);

      // Name tags follow what they name. The rocket's leads up and left, SPHEREx's up and right,
      // each PUNCH satellite's away from the stage it left, so the four never share a corner.
      const raw = film.tags, at = calm;
      for (let k = 0; k < 14; k++) at[k] = Number.isNaN(at[k]) || held !== null ? raw[k] : at[k] + (raw[k] - at[k]) * 0.35;
      tags.current?.querySelectorAll('g').forEach((g, i) => {
        // A tag fades out as its satellite drifts down into the timeline.
        const shown = pic.names[i < 2 ? i : i < 4 ? 2 : 3] * Math.min(1, Math.max(0, (innerHeight - 150 - at[i * 2 + 1]) / 40));
        g.style.opacity = String(shown);
        if (!shown) return;
        const far = [4.2, 3, 1, 1, 1, 1][i]; // the rocket's and SPHEREx's run clear of their own bodies
        const x = at[i * 2], wide = NAMES[i].length * 7.7 + 8, reach = 30 * far + wide + 4;
        let sx = i === 0 ? -1 : i === 1 ? 1 : x < at[12] ? -1 : 1;
        if (sx < 0 ? x < reach : x > innerWidth - reach) sx = -sx; // never off the side of a narrow window
        const sy = i > 1 && at[i * 2 + 1] > at[13] ? 1 : -1;
        const ex = sx * 30 * far, ey = sy * 24 * far, text = g.lastElementChild!;
        g.setAttribute('transform', `translate(${x} ${at[i * 2 + 1]})`);
        g.children[1].setAttribute('points', `0,0 ${ex},${ey} ${ex + sx * wide},${ey}`);
        text.setAttribute('x', String(ex + sx * 4));
        text.setAttribute('y', String(ey - 6));
        text.setAttribute('text-anchor', sx > 0 ? 'start' : 'end');
      });

      // The PUNCH flashes: a soft glow that swells and fades on the satellite, and a ring that
      // spreads out from it, one satellite after another.
      flash.current?.querySelectorAll('g').forEach((g, i) => {
        const u = pic.blink[i];
        if (u <= 0 || u >= 1) { g.style.opacity = '0'; return; }
        const swell = Math.sin(Math.PI * u), x = at[(i + 2) * 2], y = at[(i + 2) * 2 + 1];
        g.style.opacity = '1';
        g.setAttribute('transform', `translate(${x} ${y})`);
        const [glow, ring] = g.children;
        glow.setAttribute('r', String(8 + 22 * swell));
        glow.setAttribute('opacity', String(swell));
        ring.setAttribute('r', String(6 + 44 * u));
        ring.setAttribute('opacity', String((1 - u) * Math.min(1, u * 5)));
      });

      // Timeline: the marker, the travelled part of the track, the events behind us, the clock.
      const q = along(p);
      now.current?.setAttribute('cx', String(q.x));
      now.current?.setAttribute('cy', String(q.y));
      done.current?.setAttribute('stroke-dasharray', `${p} 1`);
      const n = MARKS.filter((m) => p >= m).length;
      if (n !== passed) {
        passed = n;
        arc.current?.querySelectorAll('g').forEach((g, i) => { g.classList.toggle('is-past', i < n); g.classList.toggle('is-now', i === n - 1); });
      }
      const s = Math.floor(missionClock(t));
      if (s !== second && clock.current) { second = s; clock.current.textContent = formatClock(s); }

      if (held === null && p > 0.998) end();
    };

    // stop() only tears down; end() also hands the page back to the site.
    function stop() {
      if (ended) return false;
      ended = true;
      gsap.ticker.remove(tick);
      // Keep swallowing scroll for a moment: trackpad momentum left over from the film must not
      // fling the page down past the headline.
      setTimeout(() => {
        removeEventListener('wheel', wheel, true);
        removeEventListener('touchstart', touchStart, true);
        removeEventListener('touchmove', touchMove, true);
      }, 1200);
      removeEventListener('keydown', key, true);
      removeEventListener('resize', resize);
      film?.dispose();
      film = null;
      html.classList.remove('film-on');
      return true;
    }
    function end() { if (stop()) bridge.finish(); }

    layout();
    addEventListener('wheel', wheel, { capture: true, passive: false });
    addEventListener('touchstart', touchStart, { capture: true, passive: true });
    addEventListener('touchmove', touchMove, { capture: true, passive: false });
    addEventListener('keydown', key, true);
    addEventListener('resize', resize);
    const button = skip.current;
    button?.addEventListener('click', end);
    const toggle = () => { if (held === null && !ended) setPlaying(!playing); };
    const playButton = play.current;
    playButton?.addEventListener('click', toggle);

    import('@/film/scene')
      .then(({ createFilm }) => {
        if (ended || !canvas.current) return;
        film = createFilm(canvas.current);
        resize();
        canvas.current.classList.add('is-live'); // fades up from black
        // The film is running: call off the safety net that lifts the veil after 12 s.
        clearTimeout((window as { __introTimer?: number }).__introTimer);
        gsap.ticker.add(tick);
      })
      .catch(end); // no WebGL or a failed load: straight to the site

    return () => {
      button?.removeEventListener('click', end);
      playButton?.removeEventListener('click', toggle);
      // Leaving the page finishes the opening; a development re-mount (the film is still in the
      // document a moment later) does not.
      if (stop()) setTimeout(() => { if (!document.querySelector('.film')) bridge.finish(); }, 60);
    };
  }, []);

  return (
    <div className="film">
      <canvas ref={canvas} className="film__canvas" aria-hidden="true" />
      <div ref={dark} className="film__dark" />
      <svg ref={tags} className="film__tags" aria-hidden="true">
        {NAMES.map((name) => (
          <g key={name} opacity="0">
            <circle r="2.5" />
            <polyline />
            <text>{name}</text>
          </g>
        ))}
      </svg>
      <svg ref={flash} className="film__flash" aria-hidden="true">
        <defs>
          <radialGradient id="film-flash">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.35" stopColor="#fff6e6" stopOpacity="0.7" />
            <stop offset="1" stopColor="#fff6e6" stopOpacity="0" />
          </radialGradient>
        </defs>
        {NAMES.slice(2).map((name) => (
          <g key={name} style={{ opacity: 0 }}>
            <circle className="film__flash-glow" fill="url(#film-flash)" />
            <circle className="film__flash-ring" />
          </g>
        ))}
      </svg>
      <div className="film__hud">
        <svg ref={arc} className="film__arc" aria-hidden="true">
          <path className="film__arc-track" />
          <path ref={done} className="film__arc-done" pathLength={1} strokeDasharray="0 1" />
          {EVENTS.map((e, i) => (
            <g key={e.name} className={UNDER[i] ? 'film__event is-under' : 'film__event'}>
              <circle r="4.5" />
              <text y={UNDER[i] ? 20 : -12} textAnchor="middle">{e.name}</text>
            </g>
          ))}
          <circle ref={now} className="film__arc-now" r="4" />
        </svg>
        <p ref={clock} className="film__clock mono" aria-hidden="true">T+00:00:40</p>
        <p className="film__mission mono">SPHEREx / PUNCH · Falcon 9 · 11 March 2025</p>
        <p className="film__hint mono">Scroll or press Play</p>
        <div className="film__controls">
          <button ref={play} type="button" className="btn btn--quiet film__play" aria-pressed="false">Play</button>
          <button ref={skip} type="button" className="btn btn--quiet film__skip">Skip</button>
        </div>
      </div>
    </div>
  );
}
