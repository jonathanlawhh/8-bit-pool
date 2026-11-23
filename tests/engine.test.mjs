import assert from 'node:assert/strict';
import {
  TABLE,
  POCKETS,
  STANDARD_MODE_PARAMS,
  getGameMode,
  registerGameMode,
  getMiscueLimit,
} from '../app/engine/config.js';
import {
  FIXED_DT,
  createInitialBalls,
  cloneBalls,
  makeBall,
  isAnyBallMoving,
  isValidCuePlacement,
  computeShotKinematics,
  applyCueStrike,
  createShotTracker,
  stepPhysics,
  computeTrajectoryPreview,
} from '../app/engine/physics.js';
import {
  createInitialGameState,
  evaluateShot,
  getPlayerTarget,
} from '../app/engine/rules.js';
import {
  buildAIPayload,
  parseAIShotResponse,
  computeLocalBotShot,
} from '../app/engine/ai.js';

function simulateToRest(balls, params = STANDARD_MODE_PARAMS, maxSeconds = 20) {
  const tracker = createShotTracker();
  const maxSteps = Math.ceil(maxSeconds / FIXED_DT);
  for (let i = 0; i < maxSteps; i++) {
    stepPhysics(balls, FIXED_DT, params, tracker);
    if (i > 10 && !isAnyBallMoving(balls)) break;
  }
  return tracker;
}

// 1. Real-world mode parameters & extensibility
{
  const std = getGameMode('standard');
  assert.equal(std.tableFriction, 0.20);
  assert.equal(std.ballWeightKg, 0.170);
  assert.equal(std.stickTipRadiusMm, 6.5);
  assert.equal(std.maxPowerN, 2500);
  assert.ok(std.trajectoryPreviewLengthCm > 20 && std.trajectoryPreviewLengthCm <= 80);

  const custom = registerGameMode('ice_table', { tableFriction: 0.04, maxPowerN: 3200 });
  assert.equal(custom.tableFriction, 0.04);
  assert.equal(custom.maxPowerN, 3200);
  assert.equal(custom.ballWeightKg, 0.170); // inherits standard defaults
  assert.equal(getGameMode('ice_table').tableFriction, 0.04);
  console.log('PASS: Mode parameters & custom mode registration');
}

// 2. Cue kinematics (punching power in Newtons -> realistic break speed ~8.8 m/s)
{
  const breakKin = computeShotKinematics({ rotationDeg: 0, powerN: 2500, spinX: 0, spinY: 0 });
  assert.ok(breakKin.speedMps > 8.0 && breakKin.speedMps < 9.5, `Expected ~8.8 m/s, got ${breakKin.speedMps}`);
  assert.equal(breakKin.isMiscue, false);

  const miscueKin = computeShotKinematics({ rotationDeg: 0, powerN: 1000, spinX: 0.9, spinY: 0.5 });
  assert.equal(miscueKin.isMiscue, true);
  assert.ok(miscueKin.speedMps < computeShotKinematics({ rotationDeg: 0, powerN: 1000, spinX: 0, spinY: 0 }).speedMps);
  console.log('PASS: Shot kinematics & miscue mechanics');
}

// 3. Initial rack & kitchen placement validation (X in [0, 63.5], Y in [0, 127], pockets outside)
{
  const balls = createInitialBalls(63.5, 63.5);
  assert.equal(balls.length, 16);
  assert.equal(isValidCuePlacement(63.5, 63.5, balls, true).valid, true);
  assert.equal(isValidCuePlacement(0, 63.5, balls, true).valid, true, 'X=0 along left rail should be valid');
  assert.equal(isValidCuePlacement(20, 0, balls, true).valid, true, 'Y=0 along bottom rail should be valid');
  assert.equal(isValidCuePlacement(20, 127, balls, true).valid, true, 'Y=127 along top rail should be valid');
  assert.equal(isValidCuePlacement(-0.1, 63.5, balls, true).valid, false, 'X<0 should be outside kitchen');
  assert.equal(isValidCuePlacement(0, 0, balls, true).valid, false, '(0,0) sits inside corner pocket mouth');
  assert.equal(isValidCuePlacement(100, 63.5, balls, true).valid, false); // beyond head string
  assert.equal(isValidCuePlacement(100, 63.5, balls, false).valid, true); // free ball-in-hand
  assert.equal(isValidCuePlacement(190.5, 63.5, balls, false).valid, false); // overlaps apex ball #1
  const bl = POCKETS.find((p) => p.id === 'bottom_left');
  assert.ok(bl.x < 0 && bl.y < 0, `Bottom-left pocket should have negative coords, got (${bl.x}, ${bl.y})`);
  console.log('PASS: Initial rack, [0..63.5]x[0..127] kitchen bounds & negative pocket coords');
}

// 4. Follow vs Draw spin physics (real rigid-body torque!)
{
  // Head-on collision: cue at (80, 63.5), ball #1 at (120, 63.5)
  // Simulate 0.65 s (after impact & follow/draw develops, before ball #1 rebounds from right rail)
  const ballsFollow = [makeBall(0, 80, 63.5), makeBall(1, 120, 63.5)];
  applyCueStrike(ballsFollow, { rotationDeg: 0, powerN: 900, spinX: 0, spinY: 0.55 });
  simulateToRest(ballsFollow, STANDARD_MODE_PARAMS, 0.65);

  const ballsDraw = [makeBall(0, 80, 63.5), makeBall(1, 120, 63.5)];
  applyCueStrike(ballsDraw, { rotationDeg: 0, powerN: 900, spinX: 0, spinY: -0.55 });
  simulateToRest(ballsDraw, STANDARD_MODE_PARAMS, 0.65);

  assert.ok(ballsFollow[0].x > 135, `Expected follow cue ball past 135 cm, got ${ballsFollow[0].x}`);
  assert.ok(ballsFollow[0].vx > 0.5, `Expected follow cue ball moving +X, got ${ballsFollow[0].vx}`);
  assert.ok(ballsDraw[0].x < 108, `Expected draw cue ball pulled back < 108 cm, got ${ballsDraw[0].x}`);
  assert.ok(ballsDraw[0].vx < -0.5, `Expected draw cue ball moving -X, got ${ballsDraw[0].vx}`);
  console.log(`PASS: Follow (x=${ballsFollow[0].x.toFixed(1)}cm, vx=${ballsFollow[0].vx.toFixed(2)}) vs Draw (x=${ballsDraw[0].x.toFixed(1)}cm, vx=${ballsDraw[0].vx.toFixed(2)}) spin mechanics`);
}

// 5. Sidespin (English) rail throw
{
  // Shoot straight into top cushion at x=80 (away from side pocket at x=127) with +spinX vs -spinX
  const ballsRightEng = [makeBall(0, 80, 90)];
  applyCueStrike(ballsRightEng, { rotationDeg: 90, powerN: 800, spinX: 0.55, spinY: 0 });
  const trR = simulateToRest(ballsRightEng, STANDARD_MODE_PARAMS, 1.0);

  const ballsLeftEng = [makeBall(0, 80, 90)];
  applyCueStrike(ballsLeftEng, { rotationDeg: 90, powerN: 800, spinX: -0.55, spinY: 0 });
  const trL = simulateToRest(ballsLeftEng, STANDARD_MODE_PARAMS, 1.0);

  assert.equal(ballsRightEng[0].pocketed, false);
  assert.equal(ballsLeftEng[0].pocketed, false);
  assert.ok(trR.railContacts.has(0) && trL.railContacts.has(0), 'Both shots must contact top rail');
  assert.ok(
    ballsRightEng[0].x > ballsLeftEng[0].x + 15,
    `Expected strong right-english throw (${ballsRightEng[0].x.toFixed(1)}) > left-english (${ballsLeftEng[0].x.toFixed(1)})`
  );
  console.log(`PASS: Sidespin English rail throw (right=${ballsRightEng[0].x.toFixed(1)}cm, left=${ballsLeftEng[0].x.toFixed(1)}cm)`);
}

// 6. Short trajectory preview length cap & ghost ball cut angle
{
  const balls = [makeBall(0, 80, 63.5), makeBall(1, 110, 63.5)];
  const previewHit = computeTrajectoryPreview(balls, { rotationDeg: 0, powerN: 800, spinX: 0, spinY: 0 });
  assert.equal(previewHit.hitType, 'ball');
  assert.equal(previewHit.hitBallId, 1);
  assert.ok(previewHit.cutAngleDeg < 1, `Straight hit should have ~0 deg cut, got ${previewHit.cutAngleDeg}`);

  const openBalls = [makeBall(0, 80, 63.5)];
  const previewOpen = computeTrajectoryPreview(openBalls, { rotationDeg: 0, powerN: 800, spinX: 0, spinY: 0 });
  assert.equal(previewOpen.hitType, 'none');
  assert.ok(Math.abs(previewOpen.lengthCm - STANDARD_MODE_PARAMS.trajectoryPreviewLengthCm) < 0.01);
  console.log('PASS: Trajectory preview cap & cut-angle geometry');
}

// 7. Full break simulation + 8-ball rules evaluation (group assignment, scratch, 8-ball win/loss)
{
  // Break shot test
  const gs = createInitialGameState('human');
  const balls = createInitialBalls(63.5, 63.5);
  const before = cloneBalls(balls);
  applyCueStrike(balls, { rotationDeg: 0, powerN: 2400, spinX: 0, spinY: 0 });
  const tr = simulateToRest(balls);
  assert.equal(tr.firstHitBallId, 1, 'Break straight down center should hit apex ball #1');
  assert.ok(tr.railContacts.size >= 4, 'Hard break should send >= 4 balls to rails');
  evaluateShot(gs, before, balls, tr);
  assert.equal(gs.isBreakShot, false);
  assert.equal(gs.groups.P1, null, 'Table remains open after break in WPA 8-ball');

  // Legal group assignment on open table (pocketing solid #1 into top-right pocket)
  const gs2 = createInitialGameState('human');
  gs2.isBreakShot = false;
  gs2.ballInHand = false;
  const b2 = [
    makeBall(0, 210, 95),
    makeBall(1, 232, 111), // aimed directly at top-right (254, 127)
    makeBall(9, 40, 40),
    makeBall(8, 127, 63.5),
  ];
  const b2Before = cloneBalls(b2);
  const aimRad = Math.atan2(111 - 95, 232 - 210);
  applyCueStrike(b2, { rotationDeg: (aimRad * 180) / Math.PI, powerN: 850, spinX: 0, spinY: 0 });
  const tr2 = simulateToRest(b2);
  const out2 = evaluateShot(gs2, b2Before, b2, tr2);
  assert.equal(out2.foul, false);
  assert.ok(out2.pocketedBalls.includes(1), 'Solid #1 should be pocketed');
  assert.equal(gs2.groups.P1, 'solids');
  assert.equal(gs2.groups.P2, 'stripes');
  assert.equal(out2.turnContinues, true);
  assert.equal(getPlayerTarget(gs2, b2, 'P1'), '8-ball'); // only solid #1 was on table -> now on 8-ball!

  // Legal 8-ball win
  const b3 = [makeBall(0, 210, 95), makeBall(8, 232, 111), makeBall(9, 40, 40)];
  const b3Before = cloneBalls(b3);
  applyCueStrike(b3, { rotationDeg: (aimRad * 180) / Math.PI, powerN: 850, spinX: 0, spinY: 0 });
  const tr3 = simulateToRest(b3);
  const out3 = evaluateShot(gs2, b3Before, b3, tr3);
  assert.equal(out3.winner, 'P1', 'P1 should win by legally pocketing the 8-ball');
  console.log('PASS: Full 8-Ball Pool rules (break, group assignment, 8-ball win)');
}

// 8. AI JSON payload & response parser + local geometry bot
{
  const gs = createInitialGameState('ai');
  gs.isBreakShot = false;
  gs.ballInHand = false;
  gs.groups.P1 = 'solids';
  gs.groups.P2 = 'stripes';
  const balls = createInitialBalls(63.5, 63.5);
  const payload = buildAIPayload(gs, balls, [], STANDARD_MODE_PARAMS);
  assert.equal(payload.ai_assigned_group, 'stripes');
  assert.equal(payload.table.pockets.length, 6);
  assert.deepEqual(payload.table.walls, { left_x: 0, right_x: 254, bottom_y: 0, top_y: 127 });
  assert.equal(payload.balls.length, 16);

  const botShot = computeLocalBotShot(gs, balls, STANDARD_MODE_PARAMS);
  const parsed = parseAIShotResponse(JSON.stringify(botShot), STANDARD_MODE_PARAMS, balls, gs);
  assert.ok(parsed.rotationDeg >= 0 && parsed.rotationDeg < 360);
  assert.ok(parsed.powerN >= STANDARD_MODE_PARAMS.minPowerN && parsed.powerN <= STANDARD_MODE_PARAMS.maxPowerN);

  // Markdown-fenced LLM output parsing
  const fenced = '```json\n{"rotation_deg": 45.25, "power_n": 920, "spin_x": -0.2, "spin_y": 0.3, "reasoning": "cut shot"}\n```';
  const parsedFenced = parseAIShotResponse(fenced, STANDARD_MODE_PARAMS, balls, gs);
  assert.equal(parsedFenced.rotationDeg, 45.25);
  assert.equal(parsedFenced.powerN, 920);
  assert.equal(parsedFenced.spinX, -0.2);
  assert.equal(parsedFenced.spinY, 0.3);
  console.log('PASS: AI JSON payload, structured parser & offline bot');
}

console.log('\nALL TESTS PASSED!');
