/**
 * Native 2D Neon 8-Bit Canvas Renderer (zero external image or font assets).
 * Includes custom 3x5 pixel bitmap digits, pixel-snapped billiard balls,
 * Cartesian X/Y coordinate rulers, short trajectory preview, 8-bit cue stick,
 * particle bursts, and the interactive spin hit-point pad.
 */

import { TABLE, POCKETS, BALL_STYLES } from './config.js';
import { degToRad } from './physics.js';

export const CANVAS_W = 880;
export const CANVAS_H = 492;

const SCALE = 3; // 3 px per cm -> 254*3 = 762 px wide, 127*3 = 381 px tall
const PAD_LEFT = 74;
const PAD_TOP = 46;
const PLAY_W = TABLE.widthCm * SCALE;  // 762
const PLAY_H = TABLE.heightCm * SCALE; // 381
const PIX = 2; // 8-bit pixel block size

/** Minimal 3x5 bitmap glyphs for crisp pixel-art numbers on balls. */
const BITMAP_3X5 = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

function drawBitmapTextCentered(ctx, text, cx, cy, color, pxSize = 1) {
  const str = String(text);
  const charW = 3 * pxSize;
  const gap = pxSize;
  const totalW = str.length * charW + (str.length - 1) * gap;
  const totalH = 5 * pxSize;
  const startX = Math.round(cx - totalW / 2);
  const startY = Math.round(cy - totalH / 2);

  ctx.fillStyle = color;
  for (let c = 0; c < str.length; c++) {
    const glyph = BITMAP_3X5[str[c]];
    if (!glyph) continue;
    const gx = startX + c * (charW + gap);
    for (let r = 0; r < 5; r++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[r][col] === '1') {
          ctx.fillRect(gx + col * pxSize, startY + r * pxSize, pxSize, pxSize);
        }
      }
    }
  }
}

export function tableToCanvas(tx, ty) {
  return {
    cx: PAD_LEFT + tx * SCALE,
    cy: PAD_TOP + (TABLE.heightCm - ty) * SCALE,
  };
}

export function canvasToTable(cx, cy) {
  return {
    x: (cx - PAD_LEFT) / SCALE,
    y: TABLE.heightCm - (cy - PAD_TOP) / SCALE,
  };
}

function snap(v, step = PIX) {
  return Math.round(v / step) * step;
}

/** Draw a chunky 8-bit pixel-snapped filled circle. */
function drawPixelCircle(ctx, cx, cy, radius, color, step = PIX) {
  ctx.fillStyle = color;
  const rSq = radius * radius;
  const minX = Math.floor((cx - radius) / step) * step;
  const maxX = Math.ceil((cx + radius) / step) * step;
  const minY = Math.floor((cy - radius) / step) * step;
  const maxY = Math.ceil((cy + radius) / step) * step;

  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const dx = x + step * 0.5 - cx;
      const dy = y + step * 0.5 - cy;
      if (dx * dx + dy * dy <= rSq) {
        ctx.fillRect(x, y, step, step);
      }
    }
  }
}

/** Draw a pixel-stepped dashed line between two canvas points. */
function drawPixelDashedLine(ctx, x1, y1, x2, y2, color, dashPx = 6, gapPx = 4, size = PIX) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  const ux = dx / dist;
  const uy = dy / dist;
  ctx.fillStyle = color;
  const period = dashPx + gapPx;
  for (let d = 0; d <= dist; d += size) {
    if ((d % period) < dashPx) {
      const px = snap(x1 + ux * d, size);
      const py = snap(y1 + uy * d, size);
      ctx.fillRect(px, py, size, size);
    }
  }
}

/** Draw a pixel-stepped circle outline (for ghost ball). */
function drawPixelCircleOutline(ctx, cx, cy, radius, color, size = PIX) {
  ctx.fillStyle = color;
  const steps = Math.max(20, Math.round((2 * Math.PI * radius) / size));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const px = snap(cx + Math.cos(a) * radius, size);
    const py = snap(cy + Math.sin(a) * radius, size);
    ctx.fillRect(px, py, size, size);
  }
}

export class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  emit(tableX, tableY, color, count = 10, speedScale = 1) {
    const { cx, cy } = tableToCanvas(tableX, tableY);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (22 + Math.random() * 75) * speedScale;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.25 + Math.random() * 0.28,
        maxLife: 0.53,
        color,
        size: Math.random() > 0.4 ? 3 : 2,
      });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  render(ctx) {
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(snap(p.x, 2), snap(p.y, 2), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Render the entire 8-bit neon pool table scene.
 */
export function renderTableScene(ctx, state) {
  const {
    balls,
    gameState,
    preview,
    input,
    params,
    isSimulating,
    hoverCoord,
    particles,
    replayBanner,
    timeSec = 0,
  } = state;

  ctx.imageSmoothingEnabled = false;

  // 1. Deep arcade background
  ctx.fillStyle = '#060a14';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Subtle top bar legend (coordinates & mode badge)
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = '#5bd6e8';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('CARTESIAN GRID: X[0..254 cm]  Y[0..127 cm]  0°=+X  90°=+Y', PAD_LEFT, 16);

  if (hoverCoord) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#00ff9d';
    ctx.fillText(
      `CURSOR (${hoverCoord.x.toFixed(1)}, ${hoverCoord.y.toFixed(1)}) cm`,
      PAD_LEFT + PLAY_W,
      16
    );
  }

  // 2. Outer 8-bit beveled neon rail cabinet
  // Physical cushion faces sit 1 ball radius outside the [0..254] x [0..127] ball-center grid
  // so balls at X=0 / Y=0 sit flush against the cushion and pockets sit outside at negative/over-max coords.
  const cushionPad = Math.round(TABLE.ballRadiusCm * SCALE); // ~9 px
  const feltX = PAD_LEFT - cushionPad;
  const feltY = PAD_TOP - cushionPad;
  const feltW = PLAY_W + cushionPad * 2;
  const feltH = PLAY_H + cushionPad * 2;
  const railOuter = 13;

  ctx.fillStyle = '#0b1c28';
  ctx.fillRect(feltX - railOuter, feltY - railOuter, feltW + railOuter * 2, feltH + railOuter * 2);

  // Outer emerald neon border (pixel double line)
  ctx.strokeStyle = '#00e699';
  ctx.lineWidth = 2;
  ctx.strokeRect(
    feltX - railOuter + 1,
    feltY - railOuter + 1,
    feltW + railOuter * 2 - 2,
    feltH + railOuter * 2 - 2
  );

  // Inner cushion bevel
  ctx.fillStyle = '#0e3642';
  ctx.fillRect(feltX - 5, feltY - 5, feltW + 10, feltH + 10);

  // Playing surface felt
  ctx.fillStyle = '#072229';
  ctx.fillRect(feltX, feltY, feltW, feltH);

  // Subtle checkerboard pixel felt shading for retro depth
  ctx.fillStyle = '#082730';
  for (let gx = 0; gx < feltW - 12; gx += 24) {
    for (let gy = 0; gy < feltH - 12; gy += 24) {
      if (((gx / 24) + (gy / 24)) % 2 === 0) {
        ctx.fillRect(feltX + gx, feltY + gy, 12, 12);
      }
    }
  }

  // Subtle [0..254] x [0..127] ball-center coordinate frame
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD_LEFT, PAD_TOP, PLAY_W, PLAY_H);

  // 3. Coordinate grid dots every 25 cm + Axis ruler ticks & labels
  ctx.fillStyle = 'rgba(0, 240, 255, 0.22)';
  for (let xCm = 25; xCm < TABLE.widthCm; xCm += 25) {
    for (let yCm = 25; yCm < TABLE.heightCm; yCm += 25) {
      const { cx, cy } = tableToCanvas(xCm, yCm);
      ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2);
    }
  }

  // Kitchen / Head string line (X = 63.5 cm)
  const kitchenStart = tableToCanvas(TABLE.headStringXCm, 0);
  const kitchenEnd = tableToCanvas(TABLE.headStringXCm, TABLE.heightCm);
  const highlightKitchen = gameState.ballInHand && gameState.ballInHandKitchenOnly && !isSimulating;
  if (highlightKitchen) {
    // Soft translucent highlight of legal break placement zone X in [0, 63.5], Y in [0, 127]
    ctx.fillStyle = 'rgba(255, 184, 0, 0.08)';
    ctx.fillRect(PAD_LEFT, PAD_TOP, TABLE.headStringXCm * SCALE, PLAY_H);
  }
  drawPixelDashedLine(
    ctx,
    kitchenStart.cx,
    kitchenStart.cy,
    kitchenEnd.cx,
    kitchenEnd.cy,
    highlightKitchen ? '#ffb800' : 'rgba(91, 214, 232, 0.35)',
    6,
    6,
    2
  );

  // Foot spot marker at (190.5, 63.5)
  const foot = tableToCanvas(TABLE.footSpotXCm, TABLE.footSpotYCm);
  ctx.fillStyle = 'rgba(0, 240, 255, 0.55)';
  ctx.fillRect(Math.round(foot.cx) - 4, Math.round(foot.cy) - 1, 9, 2);
  ctx.fillRect(Math.round(foot.cx) - 1, Math.round(foot.cy) - 4, 2, 9);

  // Inner neon cyan cushion edge
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(feltX - 1, feltY - 1, feltW + 2, feltH + 2);

  // X-axis ticks & labels (bottom) aligned to ball-center 0..254 cm
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const bottomRulerY = feltY + feltH + railOuter + 3;
  for (let xCm = 0; xCm <= TABLE.widthCm; xCm += 10) {
    const { cx } = tableToCanvas(xCm, 0);
    const isMajor = xCm % 25 === 0;
    ctx.fillStyle = isMajor ? '#00f0ff' : '#2d6c7a';
    ctx.fillRect(Math.round(cx), bottomRulerY, 1, isMajor ? 6 : 3);
  }
  const xLabels = [0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 254];
  for (const xCm of xLabels) {
    const { cx } = tableToCanvas(xCm, 0);
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(Math.round(cx), bottomRulerY, 2, 6);
    ctx.fillStyle = '#9beeff';
    ctx.fillText(String(xCm), cx, bottomRulerY + 8);
  }
  ctx.fillStyle = '#00ff9d';
  ctx.fillText('X (cm)', PAD_LEFT + PLAY_W / 2, bottomRulerY + 21);

  // Y-axis ticks & labels (left) aligned to ball-center 0..127 cm
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const leftRulerX = feltX - railOuter - 3;
  for (let yCm = 0; yCm <= TABLE.heightCm; yCm += 10) {
    const { cy } = tableToCanvas(0, yCm);
    const isMajor = yCm % 25 === 0;
    ctx.fillStyle = isMajor ? '#00f0ff' : '#2d6c7a';
    ctx.fillRect(leftRulerX - (isMajor ? 6 : 3), Math.round(cy), isMajor ? 6 : 3, 1);
  }
  const yLabels = [0, 25, 50, 75, 100, 127];
  for (const yCm of yLabels) {
    const { cy } = tableToCanvas(0, yCm);
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(leftRulerX - 6, Math.round(cy), 6, 2);
    ctx.fillStyle = '#9beeff';
    ctx.fillText(String(yCm), leftRulerX - 9, cy);
  }
  ctx.save();
  ctx.translate(14, PAD_TOP + PLAY_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#00ff9d';
  ctx.fillText('Y (cm)', 0, 0);
  ctx.restore();

  // 4. Pockets (6 neon 8-bit holes)
  const pulse = 0.65 + 0.35 * Math.sin(timeSec * 3.5);
  for (const p of POCKETS) {
    const { cx, cy } = tableToCanvas(p.x, p.y);
    const pr = p.radiusCm * SCALE;
    // Outer pocket glow ring
    drawPixelCircle(ctx, cx, cy, pr + 2, `rgba(0, 240, 255, ${(0.28 * pulse).toFixed(2)})`, 2);
    // Dark pocket well
    drawPixelCircle(ctx, cx, cy, pr, '#02050a', 2);
    // Crisp neon pocket lip
    drawPixelCircleOutline(ctx, cx, cy, pr, '#00f0ff', 2);
  }

  // 5. Short trajectory preview & cue stick (when stationary & game active)
  if (!isSimulating && !gameState.winner && preview && !replayBanner) {
    const start = tableToCanvas(preview.startX, preview.startY);
    const end = tableToCanvas(preview.endX, preview.endY);
    const rayColor = preview.kinematics.isMiscue ? '#ff3358' : '#00f5ff';

    drawPixelDashedLine(ctx, start.cx, start.cy, end.cx, end.cy, rayColor, 6, 4, 2);

    if (preview.hitType === 'ball') {
      // Ghost cue ball outline at contact point
      drawPixelCircleOutline(ctx, end.cx, end.cy, TABLE.ballRadiusCm * SCALE, rayColor, 2);
      if (preview.targetHint) {
        const t1 = tableToCanvas(preview.targetHint.x1, preview.targetHint.y1);
        const t2 = tableToCanvas(preview.targetHint.x2, preview.targetHint.y2);
        drawPixelDashedLine(ctx, t1.cx, t1.cy, t2.cx, t2.cy, '#ffe135', 4, 3, 2);
      }
      if (preview.reboundHint) {
        const r1 = tableToCanvas(preview.reboundHint.x1, preview.reboundHint.y1);
        const r2 = tableToCanvas(preview.reboundHint.x2, preview.reboundHint.y2);
        drawPixelDashedLine(ctx, r1.cx, r1.cy, r2.cx, r2.cy, '#00ff9d', 3, 4, 2);
      }
    } else if (preview.hitType === 'rail' && preview.reboundHint) {
      const r1 = tableToCanvas(preview.reboundHint.x1, preview.reboundHint.y1);
      const r2 = tableToCanvas(preview.reboundHint.x2, preview.reboundHint.y2);
      drawPixelDashedLine(ctx, r1.cx, r1.cy, r2.cx, r2.cy, '#00ff9d', 4, 4, 2);
    }

    // 8-bit Neon Cue Stick behind cue ball
    const rad = degToRad(preview.kinematics.rotationDeg);
    const ux = Math.cos(rad);
    const uy = -Math.sin(rad); // canvas Y is inverted
    const powerRatio = (input.powerN - params.minPowerN) / Math.max(1, params.maxPowerN - params.minPowerN);
    const pullback = 14 + powerRatio * 26;
    const stickLen = 96;

    const tipX = start.cx - ux * pullback;
    const tipY = start.cy - uy * pullback;
    const buttX = start.cx - ux * (pullback + stickLen);
    const buttY = start.cy - uy * (pullback + stickLen);

    // Shaft
    ctx.strokeStyle = '#ffb84d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(Math.round(tipX), Math.round(tipY));
    ctx.lineTo(Math.round(buttX), Math.round(buttY));
    ctx.stroke();

    // Neon grip wrap on rear third
    const wrapX = start.cx - ux * (pullback + stickLen * 0.62);
    const wrapY = start.cy - uy * (pullback + stickLen * 0.62);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(Math.round(wrapX), Math.round(wrapY));
    ctx.lineTo(Math.round(buttX), Math.round(buttY));
    ctx.stroke();

    // Chalked blue leather cue tip
    ctx.fillStyle = '#00f5ff';
    ctx.fillRect(Math.round(tipX) - 2, Math.round(tipY) - 2, 5, 5);
  }

  // 6. Balls (8-bit pixel spheres with stripes, highlights & bitmap digits)
  const ballPxR = TABLE.ballRadiusCm * SCALE; // ~8.57 px
  for (const b of balls) {
    if (b.pocketed) continue;
    drawBall8Bit(ctx, b, ballPxR, gameState.ballInHand && b.id === 0 && !isSimulating, timeSec);
  }

  // 7. 8-bit particle bursts
  if (particles) {
    particles.render(ctx);
  }

  // 8. Optional Replay / Inspection Banner
  if (replayBanner) {
    ctx.fillStyle = 'rgba(6, 10, 20, 0.86)';
    ctx.fillRect(PAD_LEFT + 8, PAD_TOP + 8, 350, 24);
    ctx.strokeStyle = '#ffb800';
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD_LEFT + 8, PAD_TOP + 8, 350, 24);
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillStyle = '#ffb800';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(replayBanner, PAD_LEFT + 16, PAD_TOP + 20);
  }
}

function drawBall8Bit(ctx, ball, r, highlightCue, timeSec) {
  const { cx, cy } = tableToCanvas(ball.x, ball.y);
  const style = BALL_STYLES[ball.id];

  // Pixel drop shadow
  drawPixelCircle(ctx, cx + 2, cy + 2, r, 'rgba(0, 0, 0, 0.48)', PIX);

  // Pulsing target ring around cue ball when placing ball-in-hand
  if (highlightCue) {
    const ringR = r + 3 + (Math.sin(timeSec * 6) > 0 ? 2 : 0);
    drawPixelCircleOutline(ctx, cx, cy, ringR, '#ffb800', PIX);
  }

  if (ball.type === 'cue') {
    drawPixelCircle(ctx, cx, cy, r, style.color, PIX);
    // Cyan specular highlight
    ctx.fillStyle = style.accent;
    ctx.fillRect(snap(cx - r * 0.45), snap(cy - r * 0.45), 2, 2);
    // Subtle rolling spot so cue spin is visually readable
    const spotX = cx + Math.cos(ball.rollAngle) * (r * 0.35);
    const spotY = cy + Math.sin(ball.rollAngle) * (r * 0.35);
    ctx.fillStyle = '#ff3358';
    ctx.fillRect(Math.round(spotX) - 1, Math.round(spotY) - 1, 2, 2);
    return;
  }

  if (ball.type === 'stripe') {
    // White ball base
    drawPixelCircle(ctx, cx, cy, r, '#f4f8ff', PIX);
    // Colored horizontal neon stripe clipped to circle
    ctx.fillStyle = style.color;
    const rSq = r * r;
    const minX = Math.floor((cx - r) / PIX) * PIX;
    const maxX = Math.ceil((cx + r) / PIX) * PIX;
    const stripeHalfH = r * 0.52;
    const minY = Math.floor((cy - stripeHalfH) / PIX) * PIX;
    const maxY = Math.ceil((cy + stripeHalfH) / PIX) * PIX;
    for (let y = minY; y <= maxY; y += PIX) {
      for (let x = minX; x <= maxX; x += PIX) {
        const dx = x + 1 - cx;
        const dy = y + 1 - cy;
        if (dx * dx + dy * dy <= rSq) {
          ctx.fillRect(x, y, PIX, PIX);
        }
      }
    }
  } else if (ball.type === 'eight') {
    drawPixelCircle(ctx, cx, cy, r, '#0b0e17', PIX);
    drawPixelCircleOutline(ctx, cx, cy, r, '#9beeff', 1);
  } else {
    // Solid ball
    drawPixelCircle(ctx, cx, cy, r, style.color, PIX);
  }

  // Pixel specular glint
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fillRect(snap(cx - r * 0.48), snap(cy - r * 0.52), 2, 2);

  // Number badge & crisp 3x5 bitmap number
  if (ball.id > 0) {
    const badgeColor = ball.type === 'eight' ? '#f4f8ff' : '#060a14';
    const textColor = ball.type === 'eight' ? '#060a14' : '#f4f8ff';
    const badgeW = ball.id >= 10 ? 9 : 6;
    ctx.fillStyle = badgeColor;
    ctx.fillRect(Math.round(cx - badgeW / 2), Math.round(cy - 3.5), badgeW, 7);
    drawBitmapTextCentered(ctx, String(ball.id), cx, cy, textColor, 1);
  }
}

/**
 * Render the interactive 8-bit Neon Cue-Ball Hit Point (Spin) Pad.
 * Center is (0, 0), X in [-1, 1], Y in [-1, 1].
 */
export function renderSpinPad(canvas, spinX, spinY, miscueLimit, stickTipRadiusMm) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const ballR = Math.min(w, h) * 0.41;

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#060a14';
  ctx.fillRect(0, 0, w, h);

  // Pixelated cue sphere
  drawPixelCircle(ctx, cx, cy, ballR, '#e9f4ff', 2);
  drawPixelCircleOutline(ctx, cx, cy, ballR, '#00f0ff', 2);

  // Center crosshair axes (0, 0)
  ctx.fillStyle = 'rgba(7, 34, 41, 0.42)';
  ctx.fillRect(Math.round(cx - ballR + 4), Math.round(cy), Math.round(ballR * 2 - 8), 1);
  ctx.fillRect(Math.round(cx), Math.round(cy - ballR + 4), 1, Math.round(ballR * 2 - 8));

  // Miscue safe ring
  const safeR = ballR * miscueLimit;
  drawPixelCircleOutline(ctx, cx, cy, safeR, 'rgba(0, 180, 140, 0.65)', 2);

  // Tip impact circle scaled proportionally to stickTipRadiusMm / ballRadiusMm
  const tipPxR = Math.max(4, (stickTipRadiusMm / (TABLE.ballRadiusCm * 10)) * ballR);
  const hitX = cx + spinX * ballR;
  const hitY = cy - spinY * ballR; // +Y is top spin (up)
  const isMiscue = Math.hypot(spinX, spinY) > miscueLimit;

  drawPixelCircle(ctx, hitX, hitY, tipPxR, isMiscue ? '#ff3358' : '#00b8d4', 2);
  drawPixelCircleOutline(ctx, hitX, hitY, tipPxR, isMiscue ? '#ff99aa' : '#060a14', 1);

  // Tiny center dot inside tip
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(hitX) - 1, Math.round(hitY) - 1, 2, 2);

  // Axis mini labels
  ctx.font = 'bold 9px "Courier New", monospace';
  ctx.fillStyle = '#7bdfff';
  ctx.textAlign = 'center';
  ctx.fillText('+Y TOP', cx, 10);
  ctx.fillText('-Y DRAW', cx, h - 3);
}
