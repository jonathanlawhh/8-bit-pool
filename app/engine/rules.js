/**
 * WPA Standard 8-Ball Pool Rules Engine.
 */

import { respotBall, findSafeCuePlacement } from './physics.js';

export function otherPlayer(player) {
  return player === 'P1' ? 'P2' : 'P1';
}

export function groupToBallType(group) {
  if (group === 'solids') return 'solid';
  if (group === 'stripes') return 'stripe';
  return null;
}

export function ballTypeToGroup(type) {
  if (type === 'solid') return 'solids';
  if (type === 'stripe') return 'stripes';
  return null;
}

export function countRemainingByGroup(balls, group) {
  const targetType = groupToBallType(group);
  if (!targetType) return 0;
  let count = 0;
  for (const b of balls) {
    if (!b.pocketed && b.type === targetType) count++;
  }
  return count;
}

/**
 * Determine what group/ball a player is currently required to target.
 * Returns: 'open' | 'solids' | 'stripes' | '8-ball'
 */
export function getPlayerTarget(gameState, balls, player = gameState.currentPlayer) {
  const assigned = gameState.groups[player];
  if (!assigned) return 'open';
  const remaining = countRemainingByGroup(balls, assigned);
  return remaining === 0 ? '8-ball' : assigned;
}

export function createInitialGameState(opponentType = 'human', modeId = 'standard') {
  return {
    modeId,
    opponentType, // 'human' | 'ai'
    currentPlayer: 'P1',
    groups: { P1: null, P2: null }, // null | 'solids' | 'stripes'
    turnNumber: 1,
    isBreakShot: true,
    ballInHand: true,
    ballInHandKitchenOnly: true,
    winner: null,
    winReason: null,
    statusMessage: 'Turn 1 (Break): Place cue ball in kitchen (X <= 63.5 cm), aim, and shoot!',
  };
}

/**
 * Evaluate a completed shot and mutate `gameState` + cue/8-ball re-spotting as required.
 * Returns a structured outcome summary stored in turn history.
 */
export function evaluateShot(gameState, ballsBefore, ballsAfter, tracker) {
  const shooter = gameState.currentPlayer;
  const opponent = otherPlayer(shooter);
  const wasBreak = gameState.isBreakShot;

  const targetBefore = getPlayerTarget(gameState, ballsBefore, shooter);
  const pocketed = tracker.pocketedBalls;
  const cuePocketed = pocketed.some((p) => p.id === 0);
  const eightPocketed = pocketed.some((p) => p.id === 8);
  const objectPocketed = pocketed.filter((p) => p.id !== 0 && p.id !== 8);

  const firstHitBall = tracker.firstHitBallId !== null
    ? ballsBefore.find((b) => b.id === tracker.firstHitBallId)
    : null;

  let foul = false;
  let foulReason = null;
  let turnContinues = false;
  let groupAssignedThisTurn = null;
  let message = '';

  // 1. Check 8-ball pocketed
  if (eightPocketed) {
    if (cuePocketed) {
      gameState.winner = opponent;
      gameState.winReason = `${shooter} pocketed the 8-ball and scratched!`;
      foul = true;
      foulReason = 'Scratch while pocketing the 8-ball (instant loss).';
      message = `${opponent} WINS! ${gameState.winReason}`;
    } else if (wasBreak) {
      // WPA standard: 8-ball pocketed cleanly on break -> re-spot 8-ball & continue
      const eightBall = ballsAfter.find((b) => b.id === 8);
      if (eightBall) respotBall(eightBall, ballsAfter);
      gameState.isBreakShot = false;
      gameState.ballInHand = false;
      gameState.ballInHandKitchenOnly = false;
      turnContinues = true;
      message = `${shooter} pocketed the 8-ball cleanly on break! 8-ball re-spotted; table remains OPEN. ${shooter} shoots again.`;
    } else {
      // Non-break 8-ball pocketed: legal win ONLY if player was on the 8-ball and hit it first
      if (targetBefore === '8-ball' && firstHitBall && firstHitBall.id === 8) {
        gameState.winner = shooter;
        gameState.winReason = `${shooter} legally pocketed the 8-ball!`;
        message = `${shooter} WINS! Legally pocketed the 8-ball.`;
      } else {
        gameState.winner = opponent;
        foul = true;
        foulReason = targetBefore !== '8-ball'
          ? 'Pocketed the 8-ball before clearing assigned group (instant loss).'
          : 'Hit wrong ball before pocketing the 8-ball (instant loss).';
        gameState.winReason = `${shooter} lost on illegal 8-ball pocket.`;
        message = `${opponent} WINS! ${foulReason}`;
      }
    }

    gameState.statusMessage = message;
    if (!gameState.winner) gameState.turnNumber += 1;
    return buildOutcome({
      shooter,
      wasBreak,
      targetBefore,
      tracker,
      foul,
      foulReason,
      turnContinues,
      groupAssignedThisTurn,
      winner: gameState.winner,
      message,
    });
  }

  // 2. Check fouls (scratch, missed ball, wrong first hit, no rail contact)
  if (cuePocketed) {
    foul = true;
    foulReason = 'Scratch: cue ball pocketed.';
  } else if (!firstHitBall) {
    foul = true;
    foulReason = 'Foul: cue ball did not contact any object ball.';
  } else if (!wasBreak) {
    if (targetBefore === 'open' && firstHitBall.id === 8) {
      foul = true;
      foulReason = 'Foul: cannot hit the 8-ball first on an open table.';
    } else if (targetBefore === 'solids' && firstHitBall.type !== 'solid') {
      foul = true;
      foulReason = `Foul: must hit a solid (1-7) first, hit #${firstHitBall.id}.`;
    } else if (targetBefore === 'stripes' && firstHitBall.type !== 'stripe') {
      foul = true;
      foulReason = `Foul: must hit a stripe (9-15) first, hit #${firstHitBall.id}.`;
    } else if (targetBefore === '8-ball' && firstHitBall.id !== 8) {
      foul = true;
      foulReason = `Foul: must hit the 8-ball first, hit #${firstHitBall.id}.`;
    }
  }

  // Rail contact rule after first hit (when no ball was pocketed)
  if (!foul && objectPocketed.length === 0) {
    if (wasBreak) {
      const objectRails = Array.from(tracker.railContacts).filter((id) => id !== 0).length;
      if (objectRails < 4) {
        // Soft/dry break: turn simply passes (table stays open)
        message = `Soft break (${objectRails}/4 object balls reached rail). Turn passes to ${opponent}; table remains OPEN.`;
      }
    } else if (!tracker.railContactAfterFirstHit) {
      foul = true;
      foulReason = 'Foul: no ball pocketed and no ball contacted a cushion after impact.';
    }
  }

  // 3. Apply outcome to gameState
  gameState.isBreakShot = false;

  if (foul) {
    gameState.currentPlayer = opponent;
    gameState.ballInHand = true;
    gameState.ballInHandKitchenOnly = wasBreak;
    turnContinues = false;

    // Restore cue ball to a valid temporary spot for visual preview while opponent places it
    const cue = ballsAfter.find((b) => b.id === 0);
    if (cue && cue.pocketed) {
      const safe = findSafeCuePlacement(ballsAfter, gameState.ballInHandKitchenOnly);
      cue.pocketed = false;
      cue.pocketId = null;
      cue.x = safe.x;
      cue.y = safe.y;
      cue.vx = 0;
      cue.vy = 0;
      cue.wx = 0;
      cue.wy = 0;
      cue.wz = 0;
    }

    message = `${foulReason} ${opponent} gets Ball-in-Hand${gameState.ballInHandKitchenOnly ? ' (kitchen)' : ''}.`;
  } else if (wasBreak) {
    gameState.ballInHand = false;
    gameState.ballInHandKitchenOnly = false;
    if (objectPocketed.length > 0) {
      turnContinues = true;
      const ids = objectPocketed.map((p) => `#${p.id}`).join(', ');
      message = `Great break! Pocketed ${ids}. Table remains OPEN; ${shooter} shoots again.`;
    } else {
      gameState.currentPlayer = opponent;
      turnContinues = false;
      if (!message) {
        message = `Legal dry break. Table is OPEN. ${opponent}'s turn.`;
      }
    }
  } else {
    gameState.ballInHand = false;
    gameState.ballInHandKitchenOnly = false;

    if (targetBefore === 'open') {
      if (objectPocketed.length > 0) {
        const chosenGroup = ballTypeToGroup(objectPocketed[0].type);
        const otherGroup = chosenGroup === 'solids' ? 'stripes' : 'solids';
        gameState.groups[shooter] = chosenGroup;
        gameState.groups[opponent] = otherGroup;
        groupAssignedThisTurn = chosenGroup;
        turnContinues = true;
        message = `${shooter} claims ${chosenGroup.toUpperCase()} (pocketed #${objectPocketed[0].id}) and shoots again!`;
      } else {
        gameState.currentPlayer = opponent;
        turnContinues = false;
        message = `No ball pocketed. Table stays OPEN. ${opponent}'s turn.`;
      }
    } else {
      const myBallType = groupToBallType(gameState.groups[shooter]);
      const pocketedOwn = objectPocketed.filter((p) => p.type === myBallType);
      if (pocketedOwn.length > 0) {
        turnContinues = true;
        const ids = pocketedOwn.map((p) => `#${p.id}`).join(', ');
        const nextTarget = getPlayerTarget(gameState, ballsAfter, shooter);
        message = `${shooter} pocketed ${ids} and continues!${nextTarget === '8-ball' ? ' Now on the 8-BALL!' : ''}`;
      } else {
        gameState.currentPlayer = opponent;
        turnContinues = false;
        message = `No ${gameState.groups[shooter]} pocketed. ${opponent}'s turn.`;
      }
    }
  }

  gameState.turnNumber += 1;
  gameState.statusMessage = message;

  return buildOutcome({
    shooter,
    wasBreak,
    targetBefore,
    tracker,
    foul,
    foulReason,
    turnContinues,
    groupAssignedThisTurn,
    winner: gameState.winner,
    message,
  });
}

function buildOutcome({
  shooter,
  wasBreak,
  targetBefore,
  tracker,
  foul,
  foulReason,
  turnContinues,
  groupAssignedThisTurn,
  winner,
  message,
}) {
  return {
    shooter,
    wasBreak,
    targetBefore,
    firstHitBallId: tracker.firstHitBallId,
    pocketedBalls: tracker.pocketedBalls.map((p) => p.id),
    railContacts: Array.from(tracker.railContacts),
    foul,
    foulReason,
    turnContinues,
    groupAssignedThisTurn,
    winner,
    message,
  };
}
