/**
 * Deterministic 2D + 3D-spin rigid-body billiard physics engine.
 *
 * Coordinate convention:
 * - Positions (x, y) are stored in cm: X in [0, 254], Y in [0, 127].
 * - Linear velocities (vx, vy) are in m/s.
 * - Angular velocities (wx, wy, wz) are in rad/s using a right-handed frame:
 *     +X right, +Y up, +Z out of table toward viewer.
 *   Bottom contact point of a ball is r_b = (0, 0, -R).
 *   Contact velocity v_c = v + omega x r_b = (vx - R*wy, vy + R*wx, 0).
 */

import {
  GRAVITY_MPS2,
  TABLE,
  POCKETS,
  BALL_STYLES,
  STANDARD_MODE_PARAMS,
  getMiscueLimit,
} from './config.js';

export const FIXED_DT = 1 / 240; // 240 Hz substeps prevent tunneling on max-power breaks
const STOP_SPEED_MPS = 0.012;
const STOP_SPIN_RADS = 0.15;
const SLIDE_EPS_MPS = 0.015;
const BALL_RADIUS_M = TABLE.ballRadiusCm / 100;

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

export function normalizeDeg(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Standard 8-ball triangle rack:
 * - Apex at foot spot (190.5, 63.5)
 * - 8-ball at center of row 3 (index 4 in 0-based rack)
 * - Back corners (row 5 left/right) hold one solid and one stripe
 */
const STANDARD_RACK_ORDER = [
  1,          // Row 1 (apex)
  9, 2,       // Row 2
  10, 8, 3,   // Row 3 (8-ball center)
  4, 11, 12, 5, // Row 4
  13, 6, 14, 15, 7, // Row 5 (13 stripe on one corner, 7 solid on the other)
];

export function createInitialBalls(cueX = 63.5, cueY = 63.5) {
  const balls = [];
  const R = TABLE.ballRadiusCm;

  // Cue ball (id 0)
  balls.push(makeBall(0, cueX, cueY));

  // Tightly racked 15 object balls with tiny 0.03 cm separation to avoid numerical overlap
  const gap = 0.03;
  const diameter = 2 * R + gap;
  const rowStepX = diameter * Math.cos(Math.PI / 6); // sqrt(3)/2 * d

  let idx = 0;
  for (let row = 0; row < 5; row++) {
    const count = row + 1;
    const x = TABLE.footSpotXCm + row * rowStepX;
    const startY = TABLE.footSpotYCm - ((count - 1) * diameter) / 2;
    for (let col = 0; col < count; col++) {
      const id = STANDARD_RACK_ORDER[idx++];
      const y = startY + col * diameter;
      balls.push(makeBall(id, x, y));
    }
  }

  return balls;
}

export function makeBall(id, x, y) {
  const style = BALL_STYLES[id];
  return {
    id,
    type: style.type, // 'cue' | 'solid' | 'stripe' | 'eight'
    x,
    y,
    vx: 0,
    vy: 0,
    wx: 0,
    wy: 0,
    wz: 0,
    rollAngle: 0, // visual phase for subtle 8-bit roll animation
    pocketed: false,
    pocketId: null,
  };
}

export function cloneBalls(balls) {
  return balls.map((b) => ({ ...b }));
}

export function isAnyBallMoving(balls) {
  for (const b of balls) {
    if (b.pocketed) continue;
    if (
      Math.hypot(b.vx, b.vy) > STOP_SPEED_MPS ||
      Math.hypot(b.wx, b.wy, b.wz) > STOP_SPIN_RADS
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validate cue ball placement for Turn 1 (kitchen only) or Ball-in-Hand.
 */
export function isValidCuePlacement(x, y, balls, kitchenOnly = false) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { valid: false, reason: 'Coordinates must be finite numbers.' };
  }
  const R = TABLE.ballRadiusCm;
  const minX = 0;
  const maxX = kitchenOnly ? TABLE.headStringXCm : TABLE.widthCm;
  const minY = 0;
  const maxY = TABLE.heightCm;

  if (x < minX || x > maxX || y < minY || y > maxY) {
    return {
      valid: false,
      reason: kitchenOnly
        ? `Break placement must be in kitchen: X in [${minX.toFixed(1)}, ${maxX.toFixed(1)}], Y in [${minY.toFixed(1)}, ${maxY.toFixed(1)}] cm.`
        : `Placement must be inside table: X in [${minX.toFixed(1)}, ${maxX.toFixed(1)}], Y in [${minY.toFixed(1)}, ${maxY.toFixed(1)}] cm.`,
    };
  }

  for (const p of POCKETS) {
    if (Math.hypot(x - p.x, y - p.y) < p.radiusCm + 0.5) {
      return { valid: false, reason: 'Cannot place cue ball inside a pocket.' };
    }
  }

  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    const dist = Math.hypot(x - b.x, y - b.y);
    if (dist < 2 * R + 0.15) {
      return { valid: false, reason: `Overlaps ball #${b.id} at (${b.x.toFixed(1)}, ${b.y.toFixed(1)}).` };
    }
  }

  return { valid: true, reason: null };
}

/**
 * Find a safe default spot for ball-in-hand placement.
 */
export function findSafeCuePlacement(balls, kitchenOnly = false) {
  const candidates = [
    { x: 63.5, y: 63.5 },
    { x: 45, y: 63.5 },
    { x: 63.5, y: 40 },
    { x: 63.5, y: 87 },
    { x: 35, y: 45 },
    { x: 35, y: 82 },
  ];
  if (!kitchenOnly) {
    candidates.push({ x: 127, y: 63.5 }, { x: 160, y: 63.5 }, { x: 95, y: 63.5 });
  }
  for (const c of candidates) {
    if (isValidCuePlacement(c.x, c.y, balls, kitchenOnly).valid) return c;
  }
  // Grid search fallback
  const maxX = kitchenOnly ? TABLE.headStringXCm : TABLE.widthCm;
  for (let x = 0; x <= maxX; x += 6) {
    for (let y = 0; y <= TABLE.heightCm; y += 6) {
      if (isValidCuePlacement(x, y, balls, kitchenOnly).valid) {
        return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
      }
    }
  }
  return { x: 63.5, y: 63.5 };
}

/**
 * Re-spot a ball (e.g. 8-ball pocketed cleanly on break) on or behind foot spot.
 */
export function respotBall(ball, balls) {
  const R = TABLE.ballRadiusCm;
  for (let offset = 0; offset <= 60; offset += 1) {
    const x = clamp(TABLE.footSpotXCm + offset, 0, TABLE.widthCm);
    const y = TABLE.footSpotYCm;
    let clear = true;
    for (const other of balls) {
      if (other.id === ball.id || other.pocketed) continue;
      if (Math.hypot(x - other.x, y - other.y) < 2 * R + 0.2) {
        clear = false;
        break;
      }
    }
    if (clear) {
      ball.pocketed = false;
      ball.pocketId = null;
      ball.x = x;
      ball.y = y;
      ball.vx = 0;
      ball.vy = 0;
      ball.wx = 0;
      ball.wy = 0;
      ball.wz = 0;
      return;
    }
  }
}

/**
 * Compute full educational physics kinematics from user/AI shot input.
 * Uses real-world parameters from active mode.
 */
export function computeShotKinematics(input, params = STANDARD_MODE_PARAMS) {
  const rotationDeg = normalizeDeg(Number(input.rotationDeg) || 0);
  const powerN = clamp(Number(input.powerN) || params.minPowerN, params.minPowerN, params.maxPowerN);
  const spinX = clamp(Number(input.spinX) || 0, -1, 1);
  const spinY = clamp(Number(input.spinY) || 0, -1, 1);

  const miscueLimit = getMiscueLimit(params);
  const spinMag = Math.hypot(spinX, spinY);
  const isMiscue = spinMag > miscueLimit;

  // Triangular contact impulse: J = 0.5 * F_peak * dt
  const rawImpulseNs = 0.5 * powerN * TABLE.cueContactTimeS;
  // On miscue, leather tip slips off phenolic sphere -> only ~32% energy transfer
  const effectiveImpulseNs = isMiscue ? rawImpulseNs * 0.32 : rawImpulseNs;
  const speedMps = effectiveImpulseNs / params.ballWeightKg;

  // Squirt / cue deflection from side english (real world ~1-2.5 deg at max english)
  const squirtDeg = isMiscue
    ? -Math.sign(spinX || 1) * 14
    : -spinX * 1.45 * (1 - params.stickTipRadiusMm / 40);

  const effectiveAngleDeg = normalizeDeg(rotationDeg + squirtDeg);
  const rad = degToRad(effectiveAngleDeg);
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);

  const vx = speedMps * ux;
  const vy = speedMps * uy;

  // Rigid-body solid sphere impulse:
  // I = (2/5) m R^2 -> omega = (r_offset * J) / I = 2.5 * (r_offset / R) * (v0 / R)
  // Tip radius slightly reduces effective contact lever arm at outer edge
  const ballRadiusMm = TABLE.ballRadiusCm * 10;
  const leverFactor = clamp(1 - (params.stickTipRadiusMm / (3 * ballRadiusMm)), 0.80, 0.98);
  const effSpinX = isMiscue ? spinX * 0.25 : spinX * leverFactor;
  const effSpinY = isMiscue ? spinY * 0.25 : spinY * leverFactor;

  const omegaForward = 2.5 * effSpinY * (speedMps / BALL_RADIUS_M);
  const omegaZ = -2.5 * effSpinX * (speedMps / BALL_RADIUS_M);

  // Convert forward/back spin into world (wx, wy):
  // Pure roll along u = (ux, uy) satisfies wy = +v*ux/R and wx = -v*uy/R.
  const wx = -omegaForward * uy;
  const wy = omegaForward * ux;

  const kineticEnergyJ = 0.5 * params.ballWeightKg * speedMps * speedMps;
  const powerLbf = powerN * 0.224809;
  const powerKgf = powerN / GRAVITY_MPS2;
  const rollingDecelMps2 = params.rollingFriction * GRAVITY_MPS2;
  const slidingDecelMps2 = params.tableFriction * GRAVITY_MPS2;
  const estRollDistCm = ((speedMps * speedMps) / (2 * rollingDecelMps2)) * 100;

  return {
    rotationDeg,
    effectiveAngleDeg,
    squirtDeg,
    powerN,
    powerLbf,
    powerKgf,
    spinX,
    spinY,
    spinOffsetMmX: spinX * ballRadiusMm,
    spinOffsetMmY: spinY * ballRadiusMm,
    miscueLimit,
    isMiscue,
    impulseNs: effectiveImpulseNs,
    speedMps,
    speedKmh: speedMps * 3.6,
    speedMph: speedMps * 2.23694,
    vx,
    vy,
    wx,
    wy,
    wz: omegaZ,
    omegaForward,
    kineticEnergyJ,
    slidingDecelMps2,
    rollingDecelMps2,
    estRollDistCm,
  };
}

/**
 * Apply the player's or AI's strike to the cue ball.
 */
export function applyCueStrike(balls, input, params = STANDARD_MODE_PARAMS) {
  const cue = balls.find((b) => b.id === 0);
  if (!cue || cue.pocketed) {
    throw new Error('Cue ball is not on the table.');
  }
  const kin = computeShotKinematics(input, params);
  cue.vx = kin.vx;
  cue.vy = kin.vy;
  cue.wx = kin.wx;
  cue.wy = kin.wy;
  cue.wz = kin.wz;
  return kin;
}

/**
 * Create a fresh shot event tracker for 8-ball rule adjudication and VFX.
 */
export function createShotTracker() {
  return {
    firstHitBallId: null,
    pocketedBalls: [],       // { id, type, pocketId, order }
    railContacts: new Set(), // ball IDs that hit a cushion
    railContactAfterFirstHit: false,
    ballCollisions: [],      // transient VFX events drained by renderer
    railImpacts: [],         // transient VFX events drained by renderer
    pocketEvents: [],        // transient VFX events drained by renderer
  };
}

function isNearPocketMouth(x, y) {
  for (const p of POCKETS) {
    if (Math.hypot(x - p.x, y - p.y) < p.radiusCm + TABLE.ballRadiusCm * 0.55) {
      return true;
    }
  }
  return false;
}

/**
 * Advance simulation by one fixed physics substep (dt seconds).
 */
export function stepPhysics(balls, dt, params = STANDARD_MODE_PARAMS, tracker = null) {
  const Rcm = TABLE.ballRadiusCm;
  const Rm = BALL_RADIUS_M;
  const muSlide = params.tableFriction;
  const muRoll = params.rollingFriction;
  const muSpin = params.spinFriction;

  // 1. Integrate positions & apply cloth friction / spin torque
  for (const b of balls) {
    if (b.pocketed) continue;

    // Move position (convert m/s * s -> cm)
    b.x += b.vx * dt * 100;
    b.y += b.vy * dt * 100;

    const speed = Math.hypot(b.vx, b.vy);
    b.rollAngle += (speed / Rm) * dt;

    // Contact velocity at bottom of sphere: v_c = (vx - R*wy, vy + R*wx)
    const vcx = b.vx - Rm * b.wy;
    const vcy = b.vy + Rm * b.wx;
    const vcMag = Math.hypot(vcx, vcy);

    if (vcMag > SLIDE_EPS_MPS) {
      // SLIDING PHASE: kinetic friction opposes contact slip & spins ball toward pure roll
      const ux = vcx / vcMag;
      const uy = vcy / vcMag;
      const dv = muSlide * GRAVITY_MPS2 * dt;

      // Relative slip speed reduces by (7/2) * muSlide * g * dt for solid sphere!
      const maxSlipReduction = 3.5 * dv;
      if (maxSlipReduction >= vcMag) {
        // Transitions cleanly to pure rolling inside this substep
        const frac = vcMag / maxSlipReduction;
        const axDt = -ux * dv * frac;
        const ayDt = -uy * dv * frac;
        b.vx += axDt;
        b.vy += ayDt;
        b.wx = -b.vy / Rm;
        b.wy = b.vx / Rm;
      } else {
        const axDt = -ux * dv;
        const ayDt = -uy * dv;
        b.vx += axDt;
        b.vy += ayDt;
        // Torque alpha = (2.5 / R) * (ay, -ax)
        b.wx += (2.5 / Rm) * ayDt;
        b.wy += (-2.5 / Rm) * axDt;
      }

      // Subtle swerve from side-english while sliding (slight curve perpendicular to travel)
      if (Math.abs(b.wz) > 0.5 && speed > 0.1) {
        const perpX = -b.vy / speed;
        const perpY = b.vx / speed;
        const swerveAccel = clamp(b.wz * 0.0018, -0.35, 0.35);
        b.vx += perpX * swerveAccel * dt;
        b.vy += perpY * swerveAccel * dt;
      }
    } else if (speed > STOP_SPEED_MPS) {
      // PURE ROLLING PHASE
      const decel = muRoll * GRAVITY_MPS2 * dt;
      if (decel >= speed) {
        b.vx = 0;
        b.vy = 0;
        b.wx = 0;
        b.wy = 0;
      } else {
        const scale = (speed - decel) / speed;
        b.vx *= scale;
        b.vy *= scale;
        b.wx = -b.vy / Rm;
        b.wy = b.vx / Rm;
      }
    } else {
      b.vx = 0;
      b.vy = 0;
      b.wx = 0;
      b.wy = 0;
    }

    // Sidespin (wz) decay from cloth friction
    if (Math.abs(b.wz) > STOP_SPIN_RADS) {
      const dwz = ((2.5 * muSpin * GRAVITY_MPS2) / Rm) * dt;
      if (dwz >= Math.abs(b.wz)) {
        b.wz = 0;
      } else {
        b.wz -= Math.sign(b.wz) * dwz;
      }
    } else {
      b.wz = 0;
    }
  }

  // 2. Pocket capture check BEFORE rail bounce so balls approaching pocket mouths drop cleanly
  for (const b of balls) {
    if (b.pocketed) continue;
    for (const p of POCKETS) {
      const dist = Math.hypot(b.x - p.x, b.y - p.y);
      if (dist < p.radiusCm) {
        b.pocketed = true;
        b.pocketId = p.id;
        b.vx = 0;
        b.vy = 0;
        b.wx = 0;
        b.wy = 0;
        b.wz = 0;
        if (tracker) {
          tracker.pocketedBalls.push({
            id: b.id,
            type: b.type,
            pocketId: p.id,
            order: tracker.pocketedBalls.length + 1,
          });
          tracker.pocketEvents.push({
            id: b.id,
            x: p.x,
            y: p.y,
            color: BALL_STYLES[b.id].color,
          });
        }
        break;
      }
    }
  }

  // 3. Cushion collisions (with real English / sidespin throw along rail!)
  // Ball-center playable bounds span [0, 254] x [0, 127]; cushion faces sit 1 ball radius outside.
  const minX = 0;
  const maxX = TABLE.widthCm;
  const minY = 0;
  const maxY = TABLE.heightCm;
  const eRail = TABLE.railRestitution;

  for (const b of balls) {
    if (b.pocketed) continue;
    if (isNearPocketMouth(b.x, b.y)) continue;

    let hitRail = false;
    let impactSpeed = 0;

    // Left cushion (x = 0)
    if (b.x < minX) {
      b.x = minX;
      if (b.vx < 0) {
        impactSpeed = Math.abs(b.vx);
        b.vx = -b.vx * eRail;
        // Sidespin throw along +Y/-Y on left rail:
        // Contact point on left rail is (-R, 0, 0); v_tan = vy - R*wz
        const throwVy = clamp(-Rm * b.wz * 0.24, -1.8, 1.8);
        b.vy += throwVy;
        b.wz *= 0.55;
        hitRail = true;
      }
    } else if (b.x > maxX) {
      // Right cushion (x = 254)
      b.x = maxX;
      if (b.vx > 0) {
        impactSpeed = Math.abs(b.vx);
        b.vx = -b.vx * eRail;
        const throwVy = clamp(Rm * b.wz * 0.24, -1.8, 1.8);
        b.vy += throwVy;
        b.wz *= 0.55;
        hitRail = true;
      }
    }

    // Bottom cushion (y = 0)
    if (b.y < minY) {
      b.y = minY;
      if (b.vy < 0) {
        impactSpeed = Math.max(impactSpeed, Math.abs(b.vy));
        b.vy = -b.vy * eRail;
        const throwVx = clamp(Rm * b.wz * 0.24, -1.8, 1.8);
        b.vx += throwVx;
        b.wz *= 0.55;
        hitRail = true;
      }
    } else if (b.y > maxY) {
      // Top cushion (y = 127)
      b.y = maxY;
      if (b.vy > 0) {
        impactSpeed = Math.max(impactSpeed, Math.abs(b.vy));
        b.vy = -b.vy * eRail;
        const throwVx = clamp(-Rm * b.wz * 0.24, -1.8, 1.8);
        b.vx += throwVx;
        b.wz *= 0.55;
        hitRail = true;
      }
    }

    if (hitRail && tracker) {
      tracker.railContacts.add(b.id);
      if (tracker.firstHitBallId !== null) {
        tracker.railContactAfterFirstHit = true;
      }
      tracker.railImpacts.push({ x: b.x, y: b.y, speed: impactSpeed });
    }
  }

  // 4. Ball-to-ball elastic collisions (equal mass m)
  const minDist = 2 * Rcm;
  const minDistSq = minDist * minDist;
  const eBall = TABLE.ballRestitution;

  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (a.pocketed) continue;

    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (b.pocketed) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDistSq && distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        // Positional correction so balls never stay overlapped
        const overlap = minDist - dist;
        const sep = overlap * 0.505;
        a.x -= nx * sep;
        a.y -= ny * sep;
        b.x += nx * sep;
        b.y += ny * sep;

        // Relative velocity along line of centers
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const velAlongNormal = rvx * nx + rvy * ny;

        // Record first cue-ball contact for 8-ball rules
        if (tracker && tracker.firstHitBallId === null) {
          if (a.id === 0) tracker.firstHitBallId = b.id;
          else if (b.id === 0) tracker.firstHitBallId = a.id;
        }

        if (velAlongNormal < 0) {
          // Equal-mass 1D normal impulse: J = -(1 + e) * v_n / 2
          const impulse = -0.5 * (1 + eBall) * velAlongNormal;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;

          // Subtle collision-induced throw (CIT) from ball-ball tangential friction
          const tx = -ny;
          const ty = nx;
          const velTang = rvx * tx + rvy * ty;
          const throwImpulse = clamp(velTang * 0.025, -Math.abs(impulse) * 0.06, Math.abs(impulse) * 0.06);
          a.vx += throwImpulse * tx;
          a.vy += throwImpulse * ty;
          b.vx -= throwImpulse * tx;
          b.vy -= throwImpulse * ty;

          if (tracker && Math.abs(velAlongNormal) > 0.05) {
            tracker.ballCollisions.push({
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
              speed: Math.abs(velAlongNormal),
              aId: a.id,
              bId: b.id,
            });
          }
        }
      }
    }
  }
}

/**
 * Compute a short trajectory preview from the cue ball based on player inputs.
 * Strictly capped to `params.trajectoryPreviewLengthCm`.
 * Returns path segments, optional ghost ball impact info, and cut angle for math education.
 */
export function computeTrajectoryPreview(balls, input, params = STANDARD_MODE_PARAMS) {
  const cue = balls.find((b) => b.id === 0);
  if (!cue || cue.pocketed) return null;

  const kin = computeShotKinematics(input, params);
  const maxLen = params.trajectoryPreviewLengthCm;
  const R = TABLE.ballRadiusCm;
  const rad = degToRad(kin.effectiveAngleDeg);
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);

  // 1. Check earliest ball-ball ray intersection within maxLen
  let bestT = maxLen;
  let hitType = 'none'; // 'none' | 'ball' | 'rail'
  let hitBall = null;
  let railNormal = null;

  const sumR = 2 * R;
  const sumRSq = sumR * sumR;

  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    const ocx = cue.x - b.x;
    const ocy = cue.y - b.y;
    const proj = ocx * dx + ocy * dy;
    if (proj > 0) continue; // Ball is behind aim direction
    const c = ocx * ocx + ocy * ocy - sumRSq;
    const disc = proj * proj - c;
    if (disc < 0) continue;
    const t = -proj - Math.sqrt(disc);
    if (t >= 0 && t < bestT) {
      bestT = t;
      hitType = 'ball';
      hitBall = b;
    }
  }

  // 2. Check earliest cushion intersection within bestT
  const minX = 0;
  const maxX = TABLE.widthCm;
  const minY = 0;
  const maxY = TABLE.heightCm;

  const railCandidates = [];
  if (dx < -1e-6) railCandidates.push({ t: (minX - cue.x) / dx, nx: 1, ny: 0 });
  if (dx > 1e-6)  railCandidates.push({ t: (maxX - cue.x) / dx, nx: -1, ny: 0 });
  if (dy < -1e-6) railCandidates.push({ t: (minY - cue.y) / dy, nx: 0, ny: 1 });
  if (dy > 1e-6)  railCandidates.push({ t: (maxY - cue.y) / dy, nx: 0, ny: -1 });

  for (const rc of railCandidates) {
    if (rc.t > 0.01 && rc.t < bestT) {
      const hx = cue.x + dx * rc.t;
      const hy = cue.y + dy * rc.t;
      if (!isNearPocketMouth(hx, hy)) {
        bestT = rc.t;
        hitType = 'rail';
        hitBall = null;
        railNormal = { nx: rc.nx, ny: rc.ny };
      }
    }
  }

  const endX = cue.x + dx * bestT;
  const endY = cue.y + dy * bestT;

  const result = {
    startX: cue.x,
    startY: cue.y,
    endX,
    endY,
    lengthCm: bestT,
    hitType,
    hitBallId: hitBall ? hitBall.id : null,
    targetHint: null,
    reboundHint: null,
    cutAngleDeg: null,
    kinematics: kin,
  };

  const remaining = Math.max(0, maxLen - bestT);

  if (hitType === 'ball' && hitBall) {
    const nx = (hitBall.x - endX) / (2 * R);
    const ny = (hitBall.y - endY) / (2 * R);
    const cosCut = clamp(dx * nx + dy * ny, -1, 1);
    result.cutAngleDeg = radToDeg(Math.acos(cosCut));

    const hintLen = Math.min(remaining > 6 ? remaining : 14, 18);
    result.targetHint = {
      x1: hitBall.x,
      y1: hitBall.y,
      x2: hitBall.x + nx * hintLen,
      y2: hitBall.y + ny * hintLen,
    };

    // Tangent cue deflection hint (90-degree rule approximation for stun shot)
    const dot = dx * nx + dy * ny;
    let tx = dx - dot * nx;
    let ty = dy - dot * ny;
    const tMag = Math.hypot(tx, ty);
    if (tMag > 0.05) {
      tx /= tMag;
      ty /= tMag;
      // Bias slightly forward for topspin or backward for draw
      const spinBias = kin.spinY * 0.45;
      let cx = tx + dx * spinBias;
      let cy = ty + dy * spinBias;
      const cMag = Math.hypot(cx, cy) || 1;
      cx /= cMag;
      cy /= cMag;
      const cueHintLen = Math.min(12, Math.max(6, remaining * 0.6));
      result.reboundHint = {
        x1: endX,
        y1: endY,
        x2: endX + cx * cueHintLen,
        y2: endY + cy * cueHintLen,
      };
    }
  } else if (hitType === 'rail' && railNormal && remaining > 2) {
    const dot = dx * railNormal.nx + dy * railNormal.ny;
    let rx = dx - 2 * dot * railNormal.nx;
    let ry = dy - 2 * dot * railNormal.ny;
    // Slight English preview hint along the rail
    if (Math.abs(kin.spinX) > 0.05) {
      const railTanX = -railNormal.ny;
      const railTanY = railNormal.nx;
      const englishShift = -kin.spinX * 0.22;
      rx += railTanX * englishShift;
      ry += railTanY * englishShift;
      const rMag = Math.hypot(rx, ry) || 1;
      rx /= rMag;
      ry /= rMag;
    }
    result.reboundHint = {
      x1: endX,
      y1: endY,
      x2: endX + rx * remaining,
      y2: endY + ry * remaining,
    };
  }

  return result;
}
