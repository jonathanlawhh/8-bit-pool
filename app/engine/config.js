/**
 * Real-world 8-Ball Pool configuration and extensible Game Modes registry.
 *
 * Units:
 * - Table coordinates: centimeters (cm), origin (0, 0) at bottom-left playing surface.
 *   +X runs right (0 -> 254 cm), +Y runs up (0 -> 127 cm).
 * - Physics internals: SI units (m, kg, s, N, rad/s).
 * - Power input: Newtons (N), representing human punching/striking force peak
 *   over a ~1.2 ms cue-tip contact impulse.
 */

export const GRAVITY_MPS2 = 9.80665;

/** Standard 9-foot regulation tournament table dimensions (exact 2:1 ratio). */
export const TABLE = Object.freeze({
  widthCm: 254,
  heightCm: 127,
  headStringXCm: 63.5,   // 1/4 table length (break kitchen boundary)
  footSpotXCm: 190.5,    // 3/4 table length (rack apex spot)
  footSpotYCm: 63.5,     // Centerline
  ballRadiusCm: 2.8575,  // WPA standard 2.25 in diameter = 5.715 cm
  cornerPocketRadiusCm: 5.8,
  sidePocketRadiusCm: 6.3,
  cueContactTimeS: 0.0012, // Real leather tip-to-phenolic ball contact duration (~1.2 ms)
  ballRestitution: 0.96,   // Phenolic resin ball-to-ball elasticity
  railRestitution: 0.80,   // Vulcanized rubber K66 cushion elasticity
});

const POCKET_OUT = Number(TABLE.ballRadiusCm.toFixed(2)); // 2.86 cm outside [0..254] x [0..127] ball-center bounds
const POCKET_MAX_X = Number((TABLE.widthCm + POCKET_OUT).toFixed(2));  // 256.86
const POCKET_MAX_Y = Number((TABLE.heightCm + POCKET_OUT).toFixed(2)); // 129.86

export const POCKETS = Object.freeze([
  { id: 'bottom_left',   label: 'BL', x: -POCKET_OUT,  y: -POCKET_OUT,  radiusCm: TABLE.cornerPocketRadiusCm, kind: 'corner' },
  { id: 'bottom_center', label: 'BC', x: 127,          y: -POCKET_OUT,  radiusCm: TABLE.sidePocketRadiusCm,   kind: 'side'   },
  { id: 'bottom_right',  label: 'BR', x: POCKET_MAX_X, y: -POCKET_OUT,  radiusCm: TABLE.cornerPocketRadiusCm, kind: 'corner' },
  { id: 'top_left',      label: 'TL', x: -POCKET_OUT,  y: POCKET_MAX_Y, radiusCm: TABLE.cornerPocketRadiusCm, kind: 'corner' },
  { id: 'top_center',    label: 'TC', x: 127,          y: POCKET_MAX_Y, radiusCm: TABLE.sidePocketRadiusCm,   kind: 'side'   },
  { id: 'top_right',     label: 'TR', x: POCKET_MAX_X, y: POCKET_MAX_Y, radiusCm: TABLE.cornerPocketRadiusCm, kind: 'corner' },
]);

/**
 * Hidden real-world adjustable physics & gameplay parameters.
 * Kept intentionally out of the initial UI per specification,
 * while designed for future custom modes and programmatic overrides.
 */
export const STANDARD_MODE_PARAMS = Object.freeze({
  id: 'standard',
  name: 'Standard Real-World',
  description: 'WPA regulation 9-ft table with worsted cloth and average human power.',
  // 1. Table friction (sliding coefficient on worsted wool cloth; ~0.15-0.25 real world)
  tableFriction: 0.20,
  // Rolling resistance derived/paired with cloth quality (~0.012-0.020 real world)
  rollingFriction: 0.015,
  // Spin decay friction on cloth
  spinFriction: 0.044,
  // 2. Ball weight in kg (WPA regulation: 160-170 g -> 0.170 kg)
  ballWeightKg: 0.170,
  // 3. Stick tip radius in mm (standard 13 mm tip diameter -> 6.5 mm radius)
  stickTipRadiusMm: 6.5,
  // 4. Maximum power in Newtons (average human punching force ~2500 N;
  //    over 1.2 ms triangular impulse yields ~8.8 m/s = 19.7 mph break speed)
  maxPowerN: 2500,
  minPowerN: 40,
  // 5. Short trajectory preview length in cm
  trajectoryPreviewLengthCm: 48,
});

/**
 * Extensible registry of game modes for future development.
 * Additional custom modes can be registered via registerGameMode().
 */
const modeRegistry = new Map([
  ['standard', { ...STANDARD_MODE_PARAMS }],
]);

export function getGameMode(modeId = 'standard') {
  const mode = modeRegistry.get(modeId) || modeRegistry.get('standard');
  return { ...mode };
}

export function listGameModes() {
  return Array.from(modeRegistry.values()).map((m) => ({ ...m }));
}

export function registerGameMode(modeId, overrides = {}) {
  if (!modeId || typeof modeId !== 'string') {
    throw new Error('modeId must be a non-empty string');
  }
  const merged = {
    ...STANDARD_MODE_PARAMS,
    ...overrides,
    id: modeId,
  };
  modeRegistry.set(modeId, merged);
  return { ...merged };
}

/**
 * Compute miscue limit (normalized ball radius fraction) from stick tip radius.
 * Real-world miscue occurs near ~0.5-0.75 of ball radius depending on tip geometry and chalk.
 */
export function getMiscueLimit(params = STANDARD_MODE_PARAMS) {
  const ballRadiusMm = TABLE.ballRadiusCm * 10; // 28.575 mm
  // Larger tip radius gives slightly more forgiving contact edge up to physical cap
  const tipFactor = Math.min(0.12, Math.max(0.02, (params.stickTipRadiusMm / ballRadiusMm) * 0.35));
  return Math.min(0.78, Math.max(0.50, 0.62 + tipFactor));
}

/** 8-bit Neon palette for balls (solids 1-7, 8-ball, stripes 9-15). */
export const BALL_STYLES = Object.freeze({
  0:  { name: 'Cue',   type: 'cue',    color: '#f4f8ff', accent: '#7ceeff' },
  1:  { name: '1',     type: 'solid',  color: '#ffe135', accent: '#fff49e' },
  2:  { name: '2',     type: 'solid',  color: '#2d7dff', accent: '#8cb8ff' },
  3:  { name: '3',     type: 'solid',  color: '#ff3358', accent: '#ff8ca2' },
  4:  { name: '4',     type: 'solid',  color: '#ff4fd8', accent: '#ff9ee9' },
  5:  { name: '5',     type: 'solid',  color: '#ff881a', accent: '#ffc07a' },
  6:  { name: '6',     type: 'solid',  color: '#00e676', accent: '#80ffb8' },
  7:  { name: '7',     type: 'solid',  color: '#d9264a', accent: '#ff708d' },
  8:  { name: '8',     type: 'eight',  color: '#10141f', accent: '#e2ecff' },
  9:  { name: '9',     type: 'stripe', color: '#ffe135', accent: '#fff49e' },
  10: { name: '10',    type: 'stripe', color: '#2d7dff', accent: '#8cb8ff' },
  11: { name: '11',    type: 'stripe', color: '#ff3358', accent: '#ff8ca2' },
  12: { name: '12',    type: 'stripe', color: '#ff4fd8', accent: '#ff9ee9' },
  13: { name: '13',    type: 'stripe', color: '#ff881a', accent: '#ffc07a' },
  14: { name: '14',    type: 'stripe', color: '#00e676', accent: '#80ffb8' },
  15: { name: '15',    type: 'stripe', color: '#d9264a', accent: '#ff708d' },
});
