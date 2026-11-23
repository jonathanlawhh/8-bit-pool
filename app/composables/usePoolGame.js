import { reactive, ref, computed } from 'vue';
import {
  TABLE,
  POCKETS,
  BALL_STYLES,
  getGameMode,
  listGameModes,
  registerGameMode,
  getMiscueLimit,
} from '~/engine/config.js';
import {
  FIXED_DT,
  createInitialBalls,
  cloneBalls,
  isAnyBallMoving,
  isValidCuePlacement,
  computeShotKinematics,
  applyCueStrike,
  createShotTracker,
  stepPhysics,
  computeTrajectoryPreview,
  clamp,
  normalizeDeg,
} from '~/engine/physics.js';
import {
  createInitialGameState,
  evaluateShot,
  getPlayerTarget,
  countRemainingByGroup,
} from '~/engine/rules.js';
import {
  renderTableScene,
  ParticleSystem,
} from '~/engine/renderer.js';
import {
  buildAIPayload,
  requestAIShot,
  parseAIShotResponse,
} from '~/engine/ai.js';
import {
  createMatchRecord,
  saveActiveMatch,
  loadActiveMatch,
  listSavedMatches,
  deleteSavedMatch,
  clearAllSavedMatches,
  saveAIConfig,
  loadAIConfig,
} from '~/engine/storage.js';

let singleton = null;

function compactBallsSnapshot(ballArr) {
  return ballArr.map((b) => ({
    id: b.id,
    type: b.type,
    x: Number(b.x.toFixed(2)),
    y: Number(b.y.toFixed(2)),
    pocketed: b.pocketed,
    pocketId: b.pocketId || null,
  }));
}

function createPoolGameStore() {
  // Reactive state shared across all Nuxt components
  const activeMode = ref(getGameMode('standard'));
  const aiConfig = ref(loadAIConfig());
  const gameState = reactive(createInitialGameState('human', activeMode.value.id));
  const turnHistory = ref([]);
  const savedMatches = ref([]);
  const activeMatchId = ref(null);

  const shotInput = reactive({
    cueX: 63.5,
    cueY: 63.5,
    rotationDeg: 0,
    powerN: 2200,
    spinX: 0,
    spinY: 0,
  });

  const isSimulating = ref(false);
  const isAIBusy = ref(false);
  const autoAI = ref(false);
  const aiModalOpen = ref(false);
  const cueCoordError = ref('');
  const aiErrorMsg = ref('');
  const lastAIResponseRaw = ref('');
  const inspectSnapshot = ref(null); // { balls, banner, turnIndex }
  const statusBanner = reactive({
    tag: 'BREAK',
    message: gameState.statusMessage,
    tone: 'normal', // 'normal' | 'warn' | 'err'
  });

  // Plain non-reactive physics buffer for smooth 240 Hz simulation; bump boardVersion on UI-visible changes
  let balls = createInitialBalls(63.5, 63.5);
  const boardVersion = ref(0);
  const particles = new ParticleSystem();
  let simAccumulator = 0;
  let activeShotContext = null;
  let hoverCoord = null;
  let rafId = null;
  let lastFrameTime = 0;
  let animClockSec = 0;
  let canvasCtx = null;
  let initialized = false;

  // ---- Computed ----
  const liveBalls = computed(() => {
    void boardVersion.value;
    return balls.map((b) => ({ ...b }));
  });

  const isAITurn = computed(
    () => gameState.opponentType === 'ai' && gameState.currentPlayer === 'P2' && !gameState.winner
  );

  const canPlaceCue = computed(
    () => gameState.ballInHand && !isSimulating.value && !gameState.winner && !inspectSnapshot.value
  );

  const disableShotControls = computed(
    () =>
      isSimulating.value ||
      isAIBusy.value ||
      Boolean(gameState.winner) ||
      isAITurn.value ||
      Boolean(inspectSnapshot.value)
  );

  const miscueLimit = computed(() => getMiscueLimit(activeMode.value));

  const kinematics = computed(() => computeShotKinematics(shotInput, activeMode.value));

  const trajectoryPreview = computed(() => {
    void boardVersion.value;
    if (isSimulating.value || inspectSnapshot.value || gameState.winner) return null;
    return computeTrajectoryPreview(balls, shotInput, activeMode.value);
  });

  const p1Target = computed(() => {
    void boardVersion.value;
    return getPlayerTarget(gameState, balls, 'P1');
  });

  const p2Target = computed(() => {
    void boardVersion.value;
    return getPlayerTarget(gameState, balls, 'P2');
  });

  const p1RemainingText = computed(() => {
    void boardVersion.value;
    if (!gameState.groups.P1) return 'Table open';
    const rem = countRemainingByGroup(balls, gameState.groups.P1);
    return rem === 0 ? 'Cleared -> Shoot 8' : `${rem} ${gameState.groups.P1} left`;
  });

  const p2RemainingText = computed(() => {
    void boardVersion.value;
    if (!gameState.groups.P2) return 'Table open';
    const rem = countRemainingByGroup(balls, gameState.groups.P2);
    return rem === 0 ? 'Cleared -> Shoot 8' : `${rem} ${gameState.groups.P2} left`;
  });

  const aiPayloadJson = computed(() => {
    void boardVersion.value;
    const payload = buildAIPayload(gameState, balls, turnHistory.value, activeMode.value);
    return JSON.stringify(payload, null, 2);
  });

  // ---- Internal Helpers ----
  function setBanner(tag, message, tone = 'normal') {
    statusBanner.tag = tag;
    statusBanner.message = message;
    statusBanner.tone = tone;
  }

  function syncBannerFromState() {
    if (gameState.winner) {
      setBanner('MATCH OVER', gameState.statusMessage, 'warn');
    } else if (
      turnHistory.value.length > 0 &&
      turnHistory.value[turnHistory.value.length - 1].outcome.foul
    ) {
      setBanner('FOUL', gameState.statusMessage, 'err');
    } else {
      setBanner(gameState.isBreakShot ? 'BREAK' : 'READY', gameState.statusMessage, 'normal');
    }
  }

  function refreshSavedMatches() {
    savedMatches.value = listSavedMatches();
  }

  function persistCurrentMatch() {
    const rec = createMatchRecord(gameState, balls, turnHistory.value, activeMatchId.value);
    activeMatchId.value = rec.id;
    saveActiveMatch(rec);
    refreshSavedMatches();
  }

  function assignGameState(next) {
    Object.assign(gameState, next, {
      groups: { ...(next.groups || { P1: null, P2: null }) },
    });
  }

  // ---- Lifecycle & Actions ----
  function startNewMatch(opponentType = gameState.opponentType, modeId = activeMode.value.id) {
    activeMode.value = getGameMode(modeId);
    assignGameState(createInitialGameState(opponentType, activeMode.value.id));
    balls = createInitialBalls(63.5, 63.5);
    turnHistory.value = [];
    activeMatchId.value = null;
    inspectSnapshot.value = null;
    isSimulating.value = false;
    isAIBusy.value = false;
    activeShotContext = null;
    lastAIResponseRaw.value = '';
    cueCoordError.value = '';
    aiErrorMsg.value = '';

    shotInput.cueX = 63.5;
    shotInput.cueY = 63.5;
    shotInput.rotationDeg = 0;
    shotInput.powerN = Math.min(2200, activeMode.value.maxPowerN);
    shotInput.spinX = 0;
    shotInput.spinY = 0;

    boardVersion.value += 1;
    persistCurrentMatch();
    syncBannerFromState();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    aiConfig.value = loadAIConfig();
    const saved = loadActiveMatch();
    if (saved && saved.gameState && Array.isArray(saved.balls) && saved.balls.length === 16) {
      activeMode.value = getGameMode(saved.modeId || 'standard');
      assignGameState({
        ...createInitialGameState(saved.opponentType || 'human', activeMode.value.id),
        ...saved.gameState,
      });
      balls = saved.balls.map((b) => ({
        ...b,
        vx: 0,
        vy: 0,
        wx: 0,
        wy: 0,
        wz: 0,
        rollAngle: 0,
      }));
      turnHistory.value = Array.isArray(saved.turnHistory) ? saved.turnHistory : [];
      activeMatchId.value = saved.id || null;

      const cue = balls.find((b) => b.id === 0);
      if (cue) {
        shotInput.cueX = Number(cue.x.toFixed(1));
        shotInput.cueY = Number(cue.y.toFixed(1));
      }
      shotInput.powerN = gameState.isBreakShot
        ? Math.min(2200, activeMode.value.maxPowerN)
        : Math.min(900, activeMode.value.maxPowerN);
      boardVersion.value += 1;
      refreshSavedMatches();
      syncBannerFromState();
    } else {
      startNewMatch('human', 'standard');
    }

    // Expose programmatic API for programmers & future custom modes
    if (typeof window !== 'undefined') {
      window.POOL_GAME = {
        getConfig: () => ({ ...activeMode.value }),
        listModes: () => listGameModes(),
        registerMode: (id, overrides) => registerGameMode(id, overrides),
        setMode: (modeId) => {
          activeMode.value = getGameMode(modeId);
          gameState.modeId = activeMode.value.id;
          shotInput.powerN = clamp(
            shotInput.powerN,
            activeMode.value.minPowerN,
            activeMode.value.maxPowerN
          );
          boardVersion.value += 1;
          return { ...activeMode.value };
        },
        getState: () => ({
          gameState: { ...gameState, groups: { ...gameState.groups } },
          balls: compactBallsSnapshot(balls),
          turnHistory: [...turnHistory.value],
        }),
        shoot: (input) => executeShot(input),
      };
    }
  }

  function setOpponentType(type) {
    if (isSimulating.value) return;
    gameState.opponentType = type === 'ai' ? 'ai' : 'human';
    persistCurrentMatch();
    boardVersion.value += 1;
  }

  function updateCuePlacement(x, y) {
    if (!gameState.ballInHand || isSimulating.value || isAITurn.value) return;
    shotInput.cueX = x;
    shotInput.cueY = y;
    const check = isValidCuePlacement(x, y, balls, gameState.ballInHandKitchenOnly);
    if (check.valid) {
      cueCoordError.value = '';
      const cue = balls.find((b) => b.id === 0);
      if (cue) {
        cue.pocketed = false;
        cue.x = x;
        cue.y = y;
      }
      boardVersion.value += 1;
    } else {
      cueCoordError.value = check.reason || 'Invalid cue placement.';
    }
  }

  function setRotation(deg) {
    if (!Number.isFinite(Number(deg))) return;
    shotInput.rotationDeg = Number(normalizeDeg(Number(deg)).toFixed(2));
  }

  function nudgeRotation(delta) {
    shotInput.rotationDeg = Number(normalizeDeg(shotInput.rotationDeg + delta).toFixed(2));
  }

  function setPower(val) {
    if (!Number.isFinite(Number(val))) return;
    shotInput.powerN = Math.round(
      clamp(Number(val), activeMode.value.minPowerN, activeMode.value.maxPowerN)
    );
  }

  function setSpin(sx, sy) {
    if (Number.isFinite(Number(sx))) shotInput.spinX = clamp(Number(sx), -1, 1);
    if (Number.isFinite(Number(sy))) shotInput.spinY = clamp(Number(sy), -1, 1);
  }

  function resetSpin() {
    shotInput.spinX = 0;
    shotInput.spinY = 0;
  }

  function executeShot(overrideInput = null, aiMeta = null) {
    if (isSimulating.value || gameState.winner) return;
    if (inspectSnapshot.value) inspectSnapshot.value = null;

    const usedInput = overrideInput
      ? {
          cueX: overrideInput.cueX ?? shotInput.cueX,
          cueY: overrideInput.cueY ?? shotInput.cueY,
          rotationDeg: normalizeDeg(overrideInput.rotationDeg),
          powerN: clamp(
            overrideInput.powerN,
            activeMode.value.minPowerN,
            activeMode.value.maxPowerN
          ),
          spinX: clamp(overrideInput.spinX ?? 0, -1, 1),
          spinY: clamp(overrideInput.spinY ?? 0, -1, 1),
        }
      : { ...shotInput };

    let cuePlacementRecord = null;
    if (gameState.ballInHand) {
      const check = isValidCuePlacement(
        usedInput.cueX,
        usedInput.cueY,
        balls,
        gameState.ballInHandKitchenOnly
      );
      if (!check.valid) {
        cueCoordError.value = check.reason || 'Invalid cue placement.';
        return;
      }
      const cue = balls.find((b) => b.id === 0);
      if (cue) {
        cue.pocketed = false;
        cue.pocketId = null;
        cue.x = usedInput.cueX;
        cue.y = usedInput.cueY;
      }
      cuePlacementRecord = {
        x: Number(usedInput.cueX.toFixed(2)),
        y: Number(usedInput.cueY.toFixed(2)),
      };
    }

    cueCoordError.value = '';
    aiErrorMsg.value = '';

    const ballsBefore = cloneBalls(balls);
    const tracker = createShotTracker();
    const kin = applyCueStrike(balls, usedInput, activeMode.value);

    const cue = balls.find((b) => b.id === 0);
    if (cue) {
      particles.emit(cue.x, cue.y, kin.isMiscue ? '#ff3358' : '#00f0ff', 8, 0.8);
    }

    activeShotContext = {
      turnNumber: gameState.turnNumber,
      player: gameState.currentPlayer,
      playerRole:
        gameState.currentPlayer === 'P2' && gameState.opponentType === 'ai'
          ? `AI (${aiConfig.value.provider})`
          : gameState.currentPlayer,
      assignedGroupBefore: getPlayerTarget(gameState, ballsBefore, gameState.currentPlayer),
      cuePlacement: cuePlacementRecord,
      input: {
        rotationDeg: Number(usedInput.rotationDeg.toFixed(2)),
        powerN: Math.round(usedInput.powerN),
        spinX: Number(usedInput.spinX.toFixed(2)),
        spinY: Number(usedInput.spinY.toFixed(2)),
      },
      kinematicsSummary: {
        speedMps: Number(kin.speedMps.toFixed(3)),
        impulseNs: Number(kin.impulseNs.toFixed(4)),
        kineticEnergyJ: Number(kin.kineticEnergyJ.toFixed(3)),
        isMiscue: kin.isMiscue,
      },
      aiReasoning: aiMeta?.reasoning || null,
      ballsBefore: compactBallsSnapshot(ballsBefore),
      fullBallsBefore: ballsBefore,
      tracker,
    };

    isSimulating.value = true;
    simAccumulator = 0;
    setBanner(
      'SIMULATING',
      `${activeShotContext.playerRole} struck cue ball at ${usedInput.rotationDeg.toFixed(1)}°, ${Math.round(usedInput.powerN)} N...`,
      'normal'
    );
  }

  function finalizeShot() {
    isSimulating.value = false;
    const ctx = activeShotContext;
    activeShotContext = null;

    const outcome = evaluateShot(gameState, ctx.fullBallsBefore, balls, ctx.tracker);

    turnHistory.value = [
      ...turnHistory.value,
      {
        turnNumber: ctx.turnNumber,
        player: ctx.player,
        playerRole: ctx.playerRole,
        assignedGroupBefore: ctx.assignedGroupBefore,
        cuePlacement: ctx.cuePlacement,
        input: ctx.input,
        kinematics: ctx.kinematicsSummary,
        aiReasoning: ctx.aiReasoning,
        outcome,
        ballsBefore: ctx.ballsBefore,
        ballsAfter: compactBallsSnapshot(balls),
        timestamp: new Date().toISOString(),
      },
    ];

    const cue = balls.find((b) => b.id === 0);
    if (cue && !cue.pocketed) {
      shotInput.cueX = Number(cue.x.toFixed(1));
      shotInput.cueY = Number(cue.y.toFixed(1));
    }
    if (!gameState.isBreakShot && shotInput.powerN > 1800) {
      shotInput.powerN = 900;
    }

    boardVersion.value += 1;
    persistCurrentMatch();
    syncBannerFromState();

    if (isAITurn.value && autoAI.value) {
      setTimeout(() => {
        if (isAITurn.value && !isSimulating.value && !isAIBusy.value) {
          triggerAITurn();
        }
      }, 550);
    }
  }

  async function triggerAITurn() {
    if (!isAITurn.value || isSimulating.value || isAIBusy.value) return;
    isAIBusy.value = true;
    aiErrorMsg.value = '';
    setBanner(
      'AI THINKING',
      `Sending JSON board state to ${aiConfig.value.provider.toUpperCase()} (${aiConfig.value.model || 'bot'})...`,
      'warn'
    );

    try {
      const { rawText, parsed } = await requestAIShot(
        aiConfig.value,
        gameState,
        balls,
        turnHistory.value,
        activeMode.value
      );
      lastAIResponseRaw.value = rawText;

      shotInput.rotationDeg = Number(parsed.rotationDeg.toFixed(2));
      shotInput.powerN = Math.round(parsed.powerN);
      shotInput.spinX = Number(parsed.spinX.toFixed(2));
      shotInput.spinY = Number(parsed.spinY.toFixed(2));
      if (gameState.ballInHand && parsed.cueX !== null && parsed.cueY !== null) {
        shotInput.cueX = parsed.cueX;
        shotInput.cueY = parsed.cueY;
      }

      isAIBusy.value = false;
      executeShot(parsed, { reasoning: parsed.reasoning, rawText });
    } catch (err) {
      isAIBusy.value = false;
      aiErrorMsg.value = err?.message || 'AI request failed.';
      setBanner('AI ERROR', aiErrorMsg.value, 'err');
    }
  }

  function applyManualJson(rawText, andShoot = false) {
    const parsed = parseAIShotResponse(rawText, activeMode.value, balls, gameState);
    shotInput.rotationDeg = Number(parsed.rotationDeg.toFixed(2));
    shotInput.powerN = Math.round(parsed.powerN);
    shotInput.spinX = Number(parsed.spinX.toFixed(2));
    shotInput.spinY = Number(parsed.spinY.toFixed(2));
    if (gameState.ballInHand && parsed.cueX !== null && parsed.cueY !== null) {
      shotInput.cueX = parsed.cueX;
      shotInput.cueY = parsed.cueY;
      const cue = balls.find((b) => b.id === 0);
      if (cue) {
        cue.x = parsed.cueX;
        cue.y = parsed.cueY;
      }
      boardVersion.value += 1;
    }
    lastAIResponseRaw.value = rawText.trim();
    if (andShoot) {
      executeShot(parsed, { reasoning: parsed.reasoning, rawText: lastAIResponseRaw.value });
    }
  }

  function saveAIModalConfig(nextConfig) {
    aiConfig.value = { ...nextConfig };
    saveAIConfig(aiConfig.value);
    gameState.opponentType = 'ai';
    aiModalOpen.value = false;
    persistCurrentMatch();
    boardVersion.value += 1;
  }

  function enterReplaySnapshot(snapshotBalls, banner, turnIndex) {
    inspectSnapshot.value = {
      balls: snapshotBalls.map((b) => ({
        ...b,
        vx: 0,
        vy: 0,
        wx: 0,
        wy: 0,
        wz: 0,
        rollAngle: 0,
      })),
      banner,
      turnIndex,
    };
    setBanner('REVISIT', `${banner} — Click "Exit Snapshot" to return to live table.`, 'warn');
  }

  function exitReplaySnapshot() {
    inspectSnapshot.value = null;
    syncBannerFromState();
  }

  function loadTurnInputs(turn) {
    shotInput.rotationDeg = turn.input.rotationDeg;
    shotInput.powerN = clamp(
      turn.input.powerN,
      activeMode.value.minPowerN,
      activeMode.value.maxPowerN
    );
    shotInput.spinX = turn.input.spinX;
    shotInput.spinY = turn.input.spinY;
  }

  function revisitMatch(m) {
    if (isSimulating.value) return;
    inspectSnapshot.value = null;
    activeMatchId.value = m.id;
    activeMode.value = getGameMode(m.modeId || 'standard');
    assignGameState({
      ...createInitialGameState(m.opponentType || 'human', activeMode.value.id),
      ...m.gameState,
    });
    balls = (m.balls || createInitialBalls()).map((b) => ({
      ...b,
      vx: 0,
      vy: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      rollAngle: 0,
    }));
    turnHistory.value = Array.isArray(m.turnHistory) ? m.turnHistory : [];
    const cue = balls.find((b) => b.id === 0);
    if (cue) {
      shotInput.cueX = Number(cue.x.toFixed(1));
      shotInput.cueY = Number(cue.y.toFixed(1));
    }
    shotInput.powerN = clamp(
      shotInput.powerN,
      activeMode.value.minPowerN,
      activeMode.value.maxPowerN
    );
    boardVersion.value += 1;
    syncBannerFromState();
  }

  function deleteMatch(matchId) {
    deleteSavedMatch(matchId);
    refreshSavedMatches();
  }

  function clearMatches() {
    clearAllSavedMatches();
    refreshSavedMatches();
  }

  function exportHistoryJson() {
    const data = {
      matchId: activeMatchId.value,
      mode: activeMode.value,
      gameState: { ...gameState, groups: { ...gameState.groups } },
      turnHistory: turnHistory.value,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `8ball_history_${activeMatchId.value || 'match'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Canvas Animation Loop ----
  function setHoverCoord(pos) {
    hoverCoord = pos;
  }

  function loop(now) {
    const frameDt = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    animClockSec += frameDt;

    if (isSimulating.value && activeShotContext) {
      simAccumulator += frameDt;
      const maxSubsteps = 16;
      let steps = 0;
      while (simAccumulator >= FIXED_DT && steps < maxSubsteps) {
        stepPhysics(balls, FIXED_DT, activeMode.value, activeShotContext.tracker);
        simAccumulator -= FIXED_DT;
        steps++;
      }

      const tr = activeShotContext.tracker;
      while (tr.ballCollisions.length > 0) {
        const ev = tr.ballCollisions.shift();
        particles.emit(
          ev.x,
          ev.y,
          '#ffffff',
          Math.min(12, Math.ceil(ev.speed * 3)),
          Math.min(1.4, 0.5 + ev.speed * 0.15)
        );
      }
      while (tr.railImpacts.length > 0) {
        const ev = tr.railImpacts.shift();
        particles.emit(ev.x, ev.y, '#00f0ff', 6, 0.7);
      }
      while (tr.pocketEvents.length > 0) {
        const ev = tr.pocketEvents.shift();
        particles.emit(ev.x, ev.y, ev.color, 18, 1.3);
      }

      if (!isAnyBallMoving(balls)) {
        finalizeShot();
      }
    }

    particles.update(frameDt);

    if (canvasCtx) {
      const displayed = inspectSnapshot.value ? inspectSnapshot.value.balls : balls;
      const preview =
        !isSimulating.value && !inspectSnapshot.value && !gameState.winner
          ? computeTrajectoryPreview(displayed, shotInput, activeMode.value)
          : null;

      renderTableScene(canvasCtx, {
        balls: displayed,
        gameState,
        preview,
        input: shotInput,
        params: activeMode.value,
        isSimulating: isSimulating.value,
        hoverCoord,
        particles,
        replayBanner: inspectSnapshot.value ? inspectSnapshot.value.banner : null,
        timeSec: animClockSec,
      });
    }

    rafId = requestAnimationFrame(loop);
  }

  function mountCanvasLoop(canvasEl) {
    if (!canvasEl) return;
    canvasCtx = canvasEl.getContext('2d');
    lastFrameTime = performance.now();
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function unmountCanvasLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    canvasCtx = null;
  }

  return {
    // Static refs
    TABLE,
    POCKETS,
    BALL_STYLES,
    // Reactive state
    activeMode,
    aiConfig,
    gameState,
    turnHistory,
    savedMatches,
    activeMatchId,
    shotInput,
    isSimulating,
    isAIBusy,
    autoAI,
    aiModalOpen,
    cueCoordError,
    aiErrorMsg,
    lastAIResponseRaw,
    inspectSnapshot,
    statusBanner,
    // Computed
    liveBalls,
    isAITurn,
    canPlaceCue,
    disableShotControls,
    miscueLimit,
    kinematics,
    trajectoryPreview,
    p1Target,
    p2Target,
    p1RemainingText,
    p2RemainingText,
    aiPayloadJson,
    // Actions
    init,
    startNewMatch,
    setOpponentType,
    updateCuePlacement,
    setRotation,
    nudgeRotation,
    setPower,
    setSpin,
    resetSpin,
    executeShot,
    triggerAITurn,
    applyManualJson,
    saveAIModalConfig,
    openAIModal: () => {
      aiModalOpen.value = true;
    },
    closeAIModal: () => {
      aiModalOpen.value = false;
    },
    enterReplaySnapshot,
    exitReplaySnapshot,
    loadTurnInputs,
    revisitMatch,
    deleteMatch,
    clearMatches,
    exportHistoryJson,
    setHoverCoord,
    mountCanvasLoop,
    unmountCanvasLoop,
  };
}

export function usePoolGame() {
  if (!singleton) {
    singleton = createPoolGameStore();
  }
  return singleton;
}
