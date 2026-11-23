/**
 * LLM AI Opponent integration (OpenAI-compatible & Google Gemini endpoints)
 * plus a zero-key Local Geometry Bot for instant offline testing.
 */

import { TABLE, POCKETS, STANDARD_MODE_PARAMS, getMiscueLimit } from './config.js';
import { getPlayerTarget } from './rules.js';
import {
  clamp,
  normalizeDeg,
  radToDeg,
  isValidCuePlacement,
  findSafeCuePlacement,
} from './physics.js';

export const DEFAULT_AI_CONFIG = Object.freeze({
  provider: 'openai', // 'openai' | 'gemini' | 'local_bot'
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  apiKey: '',
  temperature: 0.2,
  systemPromptExtra: '',
});

export const PROVIDER_PRESETS = Object.freeze({
  openai: {
    label: 'OpenAI / Compatible API',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
  gemini: {
    label: 'Google Gemini API',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    model: 'gemini-2.5-flash',
  },
  local_bot: {
    label: 'Offline Geometry Bot (No API Key)',
    endpoint: 'local://geometry-solver',
    model: 'ghost-ball-v1',
  },
});

const SYSTEM_PROMPT = `You are a precision 8-Ball Pool AI player skilled in 2D geometry, trigonometry, and billiard physics.
Coordinate system:
- Origin (0, 0) is bottom-left of playing surface. +X is right (0 to 254 cm), +Y is up (0 to 127 cm).
- rotation_deg is measured counterclockwise in degrees: 0 = +X (right), 90 = +Y (up), 180 = -X (left), 270 = -Y (down).
- To pocket a target ball at T into pocket P, aim the cue ball at the ghost-ball point G = T - 2*R * unit(P - T), so rotation_deg = atan2(G.y - C.y, G.x - C.x) in degrees [0, 360).
- power_n is punching force in Newtons (40 to max_power_n). Typical soft shot: 350-550 N, medium shot: 650-1050 N, firm shot: 1100-1600 N, break: 2000-2500 N.
- spin_x and spin_y are cue tip hit offsets normalized to [-0.6, 0.6], where (0, 0) is center ball, +spin_y is topspin/follow, -spin_y is backspin/draw, +spin_x is right english, -spin_x is left english.
- Follow WPA 8-ball rules: hit a ball of your assigned group first (or any solid/stripe if "open", or ball 8 if "8-ball"). Avoid scratching.
- If ball_in_hand is true, also provide valid cue_x and cue_y inside the table (and <= 63.5 cm if ball_in_hand_kitchen_only is true) without overlapping other balls.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "cue_x": number | null,
  "cue_y": number | null,
  "rotation_deg": number,
  "power_n": number,
  "spin_x": number,
  "spin_y": number,
  "reasoning": "brief geometric calculation and strategy"
}`;

/**
 * Build the structured JSON state sent to the LLM each AI turn.
 */
export function buildAIPayload(gameState, balls, turnHistory = [], params = STANDARD_MODE_PARAMS) {
  const aiTarget = getPlayerTarget(gameState, balls, 'P2');
  const miscueLimit = Number(getMiscueLimit(params).toFixed(2));

  const compactHistory = turnHistory.slice(-12).map((t) => ({
    turn: t.turnNumber,
    player: t.player,
    cue_placement: t.cuePlacement || null,
    input: {
      rotation_deg: Number(t.input.rotationDeg.toFixed(2)),
      power_n: Math.round(t.input.powerN),
      spin_x: Number(t.input.spinX.toFixed(2)),
      spin_y: Number(t.input.spinY.toFixed(2)),
    },
    outcome: {
      first_hit_ball_id: t.outcome.firstHitBallId,
      pocketed_balls: t.outcome.pocketedBalls,
      foul: t.outcome.foul,
      foul_reason: t.outcome.foulReason,
    },
  }));

  return {
    game: '8-ball-pool',
    turn_number: gameState.turnNumber,
    ai_player: 'P2',
    ai_assigned_group: aiTarget, // 'open' | 'solids' | 'stripes' | '8-ball'
    opponent_assigned_group: gameState.groups.P1 || 'open',
    ball_in_hand: Boolean(gameState.ballInHand),
    ball_in_hand_kitchen_only: Boolean(gameState.ballInHandKitchenOnly),
    table: {
      units: 'cm',
      width_cm: TABLE.widthCm,
      height_cm: TABLE.heightCm,
      ball_radius_cm: TABLE.ballRadiusCm,
      head_string_x_cm: TABLE.headStringXCm,
      walls: {
        left_x: 0,
        right_x: TABLE.widthCm,
        bottom_y: 0,
        top_y: TABLE.heightCm,
      },
      pockets: POCKETS.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        radius_cm: p.radiusCm,
        kind: p.kind,
      })),
    },
    balls: balls.map((b) => ({
      id: b.id,
      type: b.type,
      x: Number(b.x.toFixed(2)),
      y: Number(b.y.toFixed(2)),
      pocketed: b.pocketed,
    })),
    input_schema: {
      rotation_deg: '0 to 360 degrees (0 = +X right, 90 = +Y up)',
      power_n: `${params.minPowerN} to ${params.maxPowerN} Newtons`,
      spin_x: `${-miscueLimit} to ${miscueLimit} (default 0)`,
      spin_y: `${-miscueLimit} to ${miscueLimit} (default 0)`,
    },
    turn_history: compactHistory,
  };
}

/**
 * Extract and validate structured JSON shot input from raw LLM text.
 */
export function parseAIShotResponse(rawText, params = STANDARD_MODE_PARAMS, balls = [], gameState = null) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty AI response.');
  }

  let jsonStr = rawText.trim();
  // Strip optional markdown code fences if model ignored pure-JSON instruction
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
  }

  let obj;
  try {
    obj = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Invalid JSON from AI: ${err.message}`);
  }

  const rawRot = obj.rotation_deg ?? obj.rotationDeg ?? obj.rotation ?? obj.angle;
  const rawPow = obj.power_n ?? obj.powerN ?? obj.power;
  const rawSpinX = obj.spin_x ?? obj.spinX ?? 0;
  const rawSpinY = obj.spin_y ?? obj.spinY ?? 0;

  if (!Number.isFinite(Number(rawRot)) || !Number.isFinite(Number(rawPow))) {
    throw new Error('AI JSON must contain numeric "rotation_deg" and "power_n".');
  }

  const miscueLim = getMiscueLimit(params);
  const parsed = {
    rotationDeg: normalizeDeg(Number(rawRot)),
    powerN: clamp(Number(rawPow), params.minPowerN, params.maxPowerN),
    spinX: clamp(Number(rawSpinX) || 0, -miscueLim, miscueLim),
    spinY: clamp(Number(rawSpinY) || 0, -miscueLim, miscueLim),
    cueX: null,
    cueY: null,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 400) : '',
  };

  if (gameState && gameState.ballInHand) {
    const cx = Number(obj.cue_x ?? obj.cueX);
    const cy = Number(obj.cue_y ?? obj.cueY);
    const check = isValidCuePlacement(cx, cy, balls, gameState.ballInHandKitchenOnly);
    if (check.valid) {
      parsed.cueX = Number(cx.toFixed(2));
      parsed.cueY = Number(cy.toFixed(2));
    } else {
      const safe = findSafeCuePlacement(balls, gameState.ballInHandKitchenOnly);
      parsed.cueX = safe.x;
      parsed.cueY = safe.y;
      parsed.reasoning = `${parsed.reasoning ? parsed.reasoning + ' ' : ''}[Adjusted invalid cue placement to (${safe.x}, ${safe.y})]`;
    }
  }

  return parsed;
}

/**
 * Built-in local geometric ghost-ball AI solver (zero API key required).
 * Evaluates all legal target balls x 6 pockets, checks line-of-sight obstructions,
 * scores cut angle and distance, and returns structured JSON matching the LLM schema.
 */
export function computeLocalBotShot(gameState, balls, params = STANDARD_MODE_PARAMS) {
  const targetGroup = getPlayerTarget(gameState, balls, 'P2');
  const R = TABLE.ballRadiusCm;

  const legalBalls = balls.filter((b) => {
    if (b.pocketed || b.id === 0) return false;
    if (targetGroup === '8-ball') return b.id === 8;
    if (targetGroup === 'solids') return b.type === 'solid';
    if (targetGroup === 'stripes') return b.type === 'stripe';
    return b.id !== 8; // open table
  });

  let cuePos = balls.find((b) => b.id === 0);
  let chosenCuePlacement = null;

  function isPathClear(x1, y1, x2, y2, ignoreIds) {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const lenSq = vx * vx + vy * vy;
    if (lenSq < 1e-6) return true;
    const clearDist = 2 * R - 0.15;
    for (const b of balls) {
      if (b.pocketed || ignoreIds.has(b.id)) continue;
      const t = clamp(((b.x - x1) * vx + (b.y - y1) * vy) / lenSq, 0, 1);
      const px = x1 + t * vx;
      const py = y1 + t * vy;
      if (Math.hypot(b.x - px, b.y - py) < clearDist) return false;
    }
    return true;
  }

  // If ball-in-hand, pick a cue position aligned behind the easiest pocketable ball!
  if (gameState.ballInHand) {
    let bestPlacement = null;
    let bestPlacementScore = -Infinity;

    for (const target of legalBalls) {
      for (const p of POCKETS) {
        const dx = p.x - target.x;
        const dy = p.y - target.y;
        const distTP = Math.hypot(dx, dy);
        if (distTP < 1) continue;
        const ux = dx / distTP;
        const uy = dy / distTP;
        if (!isPathClear(target.x, target.y, p.x, p.y, new Set([0, target.id]))) continue;

        for (const backDist of [22, 34, 48]) {
          const cx = target.x - ux * (2 * R + backDist);
          const cy = target.y - uy * (2 * R + backDist);
          if (isValidCuePlacement(cx, cy, balls, gameState.ballInHandKitchenOnly).valid) {
            const score = 200 - distTP - backDist * 0.2;
            if (score > bestPlacementScore) {
              bestPlacementScore = score;
              bestPlacement = { x: Number(cx.toFixed(2)), y: Number(cy.toFixed(2)) };
            }
          }
        }
      }
    }

    chosenCuePlacement = bestPlacement || findSafeCuePlacement(balls, gameState.ballInHandKitchenOnly);
    cuePos = { x: chosenCuePlacement.x, y: chosenCuePlacement.y };
  }

  let bestShot = null;
  let bestScore = -Infinity;

  for (const target of legalBalls) {
    for (const p of POCKETS) {
      const toPx = p.x - target.x;
      const toPy = p.y - target.y;
      const distTP = Math.hypot(toPx, toPy);
      if (distTP < 1) continue;
      const ux = toPx / distTP;
      const uy = toPy / distTP;

      // Ghost ball center point
      const gx = target.x - ux * (2 * R);
      const gy = target.y - uy * (2 * R);
      if (gx < 0 || gx > TABLE.widthCm || gy < 0 || gy > TABLE.heightCm) continue;

      const toGx = gx - cuePos.x;
      const toGy = gy - cuePos.y;
      const distCG = Math.hypot(toGx, toGy);
      if (distCG < 0.5) continue;
      const aimX = toGx / distCG;
      const aimY = toGy / distCG;

      // Cosine of cut angle (must be > 0.25 so cut isn't impossibly thin)
      const cosCut = aimX * ux + aimY * uy;
      if (cosCut < 0.25) continue;

      const pathCueClear = isPathClear(cuePos.x, cuePos.y, gx, gy, new Set([0, target.id]));
      const pathTargetClear = isPathClear(target.x, target.y, p.x, p.y, new Set([0, target.id]));

      let score = cosCut * 120 - (distCG + distTP) * 0.35;
      if (!pathCueClear) score -= 180;
      if (!pathTargetClear) score -= 140;

      if (score > bestScore) {
        bestScore = score;
        const angleDeg = normalizeDeg(radToDeg(Math.atan2(aimY, aimX)));
        // Estimate power in Newtons based on total travel distance & cut angle
        const rawPower = 420 + (distCG + distTP) * 3.1 / Math.max(0.45, cosCut);
        const powerN = Math.round(clamp(rawPower, 420, Math.min(1650, params.maxPowerN)));
        bestShot = {
          cue_x: chosenCuePlacement ? chosenCuePlacement.x : null,
          cue_y: chosenCuePlacement ? chosenCuePlacement.y : null,
          rotation_deg: Number(angleDeg.toFixed(2)),
          power_n: powerN,
          spin_x: 0,
          spin_y: cosCut > 0.85 ? 0.12 : 0,
          reasoning: `Ghost-ball shot on #${target.id} -> ${p.id} (cut=${radToDeg(Math.acos(clamp(cosCut, -1, 1))).toFixed(1)} deg, clear=${pathCueClear && pathTargetClear}).`,
        };
      }
    }
  }

  // Fallback: direct center hit on nearest legal ball
  if (!bestShot && legalBalls.length > 0) {
    let nearest = legalBalls[0];
    let minD = Infinity;
    for (const b of legalBalls) {
      const d = Math.hypot(b.x - cuePos.x, b.y - cuePos.y);
      if (d < minD) {
        minD = d;
        nearest = b;
      }
    }
    const angleDeg = normalizeDeg(radToDeg(Math.atan2(nearest.y - cuePos.y, nearest.x - cuePos.x)));
    bestShot = {
      cue_x: chosenCuePlacement ? chosenCuePlacement.x : null,
      cue_y: chosenCuePlacement ? chosenCuePlacement.y : null,
      rotation_deg: Number(angleDeg.toFixed(2)),
      power_n: 850,
      spin_x: 0,
      spin_y: 0,
      reasoning: `No clean pocket line; safety/contact shot toward #${nearest.id}.`,
    };
  }

  if (!bestShot) {
    bestShot = {
      cue_x: chosenCuePlacement ? chosenCuePlacement.x : null,
      cue_y: chosenCuePlacement ? chosenCuePlacement.y : null,
      rotation_deg: 0,
      power_n: 700,
      spin_x: 0,
      spin_y: 0,
      reasoning: 'Fallback shot.',
    };
  }

  return bestShot;
}

/**
 * Request the next turn shot from the configured AI provider (OpenAI, Gemini, or Offline Geometry Bot).
 */
export async function requestAIShot(aiConfig, gameState, balls, turnHistory, params = STANDARD_MODE_PARAMS) {
  const payload = buildAIPayload(gameState, balls, turnHistory, params);
  const provider = aiConfig.provider || 'openai';

  if (provider === 'local_bot') {
    const botJson = computeLocalBotShot(gameState, balls, params);
    const rawText = JSON.stringify(botJson, null, 2);
    const parsed = parseAIShotResponse(rawText, params, balls, gameState);
    return { payload, rawText, parsed };
  }

  const endpoint = (aiConfig.endpoint || '').trim();
  const apiKey = (aiConfig.apiKey || '').trim();
  const model = (aiConfig.model || '').trim();
  const temperature = clamp(Number(aiConfig.temperature ?? 0.2), 0, 1.5);

  if (!endpoint) throw new Error('AI API endpoint is required.');
  if (!apiKey) throw new Error('AI API key is required for LLM mode (or switch provider to Offline Geometry Bot).');

  const fullSystemPrompt = aiConfig.systemPromptExtra
    ? `${SYSTEM_PROMPT}\n\nAdditional instructions:\n${aiConfig.systemPromptExtra}`
    : SYSTEM_PROMPT;

  const userPrompt = `Current game state JSON:\n${JSON.stringify(payload, null, 2)}\n\nReturn your next shot strictly as JSON.`;

  let rawText = '';

  if (provider === 'gemini') {
    const resolvedUrl = endpoint.replace('{model}', encodeURIComponent(model || 'gemini-2.5-flash'));
    const headers = { 'Content-Type': 'application/json' };
    if (!resolvedUrl.includes('key=')) {
      headers['x-goog-api-key'] = apiKey;
    }

    const body = {
      systemInstruction: { parts: [{ text: fullSystemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
      },
    };

    const res = await fetch(resolvedUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 260)}`);
    }

    const data = await res.json();
    rawText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  } else {
    // OpenAI / OpenAI-compatible chat completions endpoint
    const body = {
      model: model || 'gpt-4o-mini',
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: fullSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 260)}`);
    }

    const data = await res.json();
    rawText = data?.choices?.[0]?.message?.content || '';
  }

  const parsed = parseAIShotResponse(rawText, params, balls, gameState);
  return { payload, rawText, parsed };
}
