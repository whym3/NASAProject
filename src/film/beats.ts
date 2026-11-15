// The launch film's choreography: everything on screen as a pure function of film time p
// (0 to 1). No state, so scrubbing backwards gives the same picture as going forwards.
// Lengths are metres; the payload (SPHEREx) is the origin of the vehicle. How much scrolling
// each part takes is decided separately, in filmTime() below.
//
//   0.00 Climb      tight on the nose, bottom left, in dark blue air; the camera pulls back
//                   until the whole rocket and its flame are in view
//   0.20 Thin air   sky goes black, the Earth's edge comes in, the vehicle climbs out of the
//                   Earth's shadow and the Sun catches it
//   0.40 Staging    the booster cuts off and falls back; the camera closes in again
//   0.50 Space      upper stage reaches the middle, the nose opens
//   0.65 Release    SPHEREx stays, the stage drops away
//   0.72 Satellites SPHEREx turns once about its axis, its solar panel flashing in the Sun, as
//                   the four PUNCH satellites leave the stage
//   0.81 Telescope  SPHEREx faces us, the camera goes down the cone, stars, the site

export const BEATS = [
  { at: 0, name: 'Climb' },
  { at: 0.2, name: 'Thin air' },
  { at: 0.4, name: 'Staging' },
  { at: 0.5, name: 'Space' },
  { at: 0.65, name: 'Release' },
  { at: 0.8, name: 'Telescope' },
] as const;

const clamp = (x: number) => Math.min(1, Math.max(0, x));
/** 0 before a, 1 after b, straight line between. */
export const span = (a: number, b: number, p: number) => clamp((p - a) / (b - a));
/** The same, eased at both ends. For cameras and light only: free bodies use span(). */
export const smooth = (a: number, b: number, p: number) => { const u = span(a, b, p); return u * u * (3 - 2 * u); };
const mix = (a: number, b: number, u: number) => a + (b - a) * u;

const SPIN = [0.715, 0.805]; // SPHEREx turns once about its own axis while PUNCH leaves
// Pacing. Scroll progress and film time are different things: two parts of the film get more
// than their share of the scroll (from, to, how many times more): the climb out of the air,
// and SPHEREx's turn, with the glint off its solar panel and PUNCH leaving. The film as a
// whole gets longer by that much (STRETCH), so every other part keeps the pace it had.
const SLOW = [[0.08, 0.42, 2], [SPIN[0], SPIN[1], 4]];
/** How much scrolling it takes to reach film time t, in film lengths. */
const reach = (t: number) => SLOW.reduce((s, [a, b, by]) => s + (Math.min(Math.max(t, a), b) - a) * (by - 1), t);
export const STRETCH = reach(1);
/** Scroll progress, 0 to 1, to film time, 0 to 1. */
export function filmTime(scroll: number): number {
  let t = clamp(scroll) * STRETCH; // as if nothing were slowed; then each slow part in turn
  for (const [a, b, by] of SLOW) if (t > a) t = a + (t - a) / by < b ? a + (t - a) / by : t - (b - a) * (by - 1);
  return t;
}

const DEG = Math.PI / 180;
const MECO = 0.42; // booster cut-off and separation
const NOSE = 0.56; // fairing halves part
const RELEASE = 0.68;
const PUNCH = [0.745, 0.765]; // the four PUNCH satellites leave the stage in two pairs
// Once both PUNCH pairs are clear of the stage and named, each satellite flashes once, in turn,
// so the eye finds all four before SPHEREx turns to face us.
export const BLINK = [0.772, 0.8] as const;
const DARK = 0.94; // inside the telescope: the frame is fully dark
const SETTLED = 0.62; // the roll has stopped, with the solar array turned to the Sun
const ROLL_END = 3.362; // radians: the attitude that puts the array on the Sun's side
const FEW_STARS = 0.9; // nearly the whole map: space should look as full as it does on the site

/** Film time back to scroll progress: where on the timeline a moment of the film sits. */
export const scrollOf = (t: number) => reach(clamp(t)) / STRETCH;

/** The flight's events, for the timeline along the bottom of the film. `at` is film time. */
export const EVENTS = [
  { at: 0.14, name: 'Max-Q' }, // the moment of greatest air pressure on the vehicle
  { at: MECO, name: 'MECO' }, // main engine cut-off: the booster is done
  { at: NOSE, name: 'Fairing' },
  { at: RELEASE, name: 'Release' },
  { at: PUNCH[0], name: 'PUNCH' },
  { at: 0.82, name: 'Telescope' },
] as const;

// The mission clock: seconds after liftoff at each point of the film. It is pinned to the
// flight's own times where the film meets them: booster cut-off at about 2:22 and the fairing
// at 3:10 (both from the launch broadcast), SPHEREx released at 41:56 (one published source).
// Between those it runs evenly. From the fairing to the release it runs fast, because the film
// skips 39 minutes of coasting.
// The PUNCH pairs left at 52:16 and 53:07 (same source).
const CLOCK: [number, number][] = [[0, 40], [MECO, 142], [NOSE, 190], [RELEASE, 2516], [PUNCH[0], 3136], [PUNCH[1], 3187], [1, 3230]];
export function missionClock(t: number): number {
  const c = clamp(t), i = Math.max(1, CLOCK.findIndex(([at]) => at >= c)), [a, x] = CLOCK[i - 1], [b, y] = CLOCK[i];
  return x + ((y - x) * (c - a)) / (b - a);
}
export function formatClock(seconds: number): string {
  const s = Math.floor(seconds), two = (n: number) => String(n).padStart(2, '0');
  return `T+${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

export interface Picture {
  /** Where the payload sits on screen, -1 to 1 each way (0, 0 is the middle). */
  at: { x: number; y: number };
  /** Lean of the vehicle from vertical, radians, towards the right. */
  tilt: number;
  /** Slow roll about its own axis, radians. It stops before the release. */
  roll: number;
  /** Metres of air gone past, for the cloud streaming by. */
  climb: number;
  /** How much direct sunlight reaches the vehicle: 0.3 (the last red light at dusk) to 1. */
  sun: number;
  /** How hard the picture shakes with the engines, 0 to 1. */
  shake: number;
  /** Camera exposure: it stops down when the flame fills the frame. */
  exposure: number;
  /** Extra lens softness, 0 to 1: the lens hunts for focus while it zooms. */
  hunt: number;
  /** Height of the frame in metres at the payload: tight on the nose, back for the whole
   *  rocket, then in again on the upper stage and on SPHEREx. */
  frame: number;
  air: number; // 1 = dark blue sky covers everything, 0 = space
  stars: number; // what the sky map's fill is set to
  earth: number; // 0 = below the frame, 1 = risen
  clouds: number;
  booster: { on: boolean; flame: number; back: number; fall: number; tumble: number };
  upper: { flame: number; back: number; fall: number };
  nose: { open: number }; // 0 closed; grows without limit as the halves drift off
  /** face: 0 = flying attitude, 1 = cone turned to the camera. spin: its own slow turn about
   *  its axis once free, radians, one full turn. */
  craft: { face: number; spin: number };
  /** How far each PUNCH pair has drifted from the stage, metres. */
  punch: [number, number];
  /** How strongly each name is shown, 0 to 1: the rocket, SPHEREx, the first PUNCH pair, the second. */
  names: [number, number, number, number];
  /** How far each PUNCH satellite is through its one flash, 0 (not yet) to 1 (over). */
  blink: [number, number, number, number];
  dive: number; // 0 to 1: the camera's run down the cone
  dark: number; // 1 = frame covered
  done: boolean; // past the dark: only the stars are left
}

export function picture(p: number): Picture {
  const u = span(0, 0.55, p);
  const arrive = 1 - (1 - u) * (1 - u); // quick into frame, slow to the middle
  const sep = span(MECO, 1, p); // free bodies: straight lines from the moment they let go
  const gone = span(RELEASE, 1, p);
  const air = 1 - smooth(0.18, 0.42, p);
  const boosterFlame = p < MECO ? mix(1, 0.55, span(0.2, MECO, p)) : 0;
  const upperFlame = span(MECO + 0.02, MECO + 0.04, p) * (1 - span(0.52, 0.54, p));
  const settle = 1 - span(0, SETTLED, p);
  return {
    at: { x: mix(-0.3, 0, arrive), y: mix(-0.35, 0, arrive) }, // the nose runs from lower left up to the middle
    tilt: mix(32, 62, smooth(0, 0.6, p)) * DEG,
    roll: ROLL_END - Math.PI * 2.2 * settle * settle, // slows to a stop
    climb: p * 900,
    // The vehicle is already catching the last red light as the film opens: the look of a launch
    // at dusk. It whitens and hardens as it climbs out of the Earth's shadow.
    sun: 0.3 + 0.7 * smooth(0.02, 0.28, p),
    exposure: 1.3 - 0.42 * smooth(0.1, 0.3, p), // 0.88 in sunlight: white paint keeps its shading
    hunt: Math.sin(Math.PI * span(0.03, 0.3, p)) ** 2 * 0.35 + Math.sin(Math.PI * span(MECO, 0.6, p)) ** 2 * 0.6 + Math.sin(Math.PI * span(0.8, 0.86, p)) ** 2 * 0.6,
    // Hardest low down where the air is thick; a small kick from the upper stage; then still.
    shake: boosterFlame > 0 ? mix(0.4, 1, air) : upperFlame * 0.16,
    // 24 m: only the nose. 180 m: the 70 m rocket and a good length of flame. 60 m: the upper
    // stage. 26 m: SPHEREx and the stage it has left, until PUNCH is away. 11 m: SPHEREx. Zooms multiply, so each one is even on screen.
    frame: 24 * Math.pow(180 / 24, smooth(0.03, 0.3, p)) * Math.pow(60 / 180, smooth(MECO, 0.6, p)) * Math.pow(26 / 60, smooth(0.62, 0.7, p)) * Math.pow(11 / 26, smooth(0.8, 0.86, p)),
    air,
    stars: p < DARK ? FEW_STARS * smooth(0.24, 0.46, p) : smooth(0.95, 1, p),
    earth: smooth(0.2, 0.5, p),
    clouds: 1 - smooth(0.12, 0.3, p),
    booster: {
      on: p < MECO,
      flame: boosterFlame,
      back: sep * 520, fall: sep * 260, tumble: sep * 70 * DEG,
    },
    upper: {
      flame: upperFlame,
      back: gone * 20, fall: gone * 2, // slow: it stays in view, clear of the timeline, until PUNCH has left it
    },
    nose: { open: span(NOSE, 0.8, p) },
    // Once free it tips part-way, so the nested shields show, and turns once about its own axis
    // while PUNCH leaves; then it comes all the way round to face us.
    craft: { face: 0.42 * smooth(0.69, 0.73, p) + 0.58 * smooth(0.81, 0.88, p), spin: Math.PI * 2 * smooth(SPIN[0], SPIN[1], p) },
    punch: [span(PUNCH[0], 1, p) * 22, span(PUNCH[1], 1, p) * 22],
    // The rocket is named while only its nose is in view; each satellite once it is flying free,
    // until SPHEREx turns to face us.
    names: [
      1 - smooth(0.06, 0.1, p),
      smooth(0.69, 0.71, p) * (1 - smooth(0.82, 0.84, p)),
      smooth(PUNCH[0] + 0.004, PUNCH[0] + 0.016, p) * (1 - smooth(0.805, 0.825, p)),
      smooth(PUNCH[1] + 0.004, PUNCH[1] + 0.016, p) * (1 - smooth(0.805, 0.825, p)),
    ],
    blink: [0, 1, 2, 3].map((i) => { const w = (BLINK[1] - BLINK[0]) / 4; return span(BLINK[0] + i * w, BLINK[0] + (i + 1) * w, p); }) as Picture['blink'],
    dive: smooth(0.84, DARK, p),
    dark: smooth(0.89, DARK, p),
    done: p >= DARK + 0.01,
  };
}

/** Which beat p is in, as an index into BEATS. */
export const beatAt = (p: number) => BEATS.reduce((n, b, i) => (p >= b.at ? i : n), 0);
