<script setup>
const {
  gameState,
  aiConfig,
  p1Target,
  p2Target,
  p1RemainingText,
  p2RemainingText,
} = usePoolGame();

function badgeClass(target) {
  return {
    solids: target === 'solids',
    stripes: target === 'stripes',
    eight: target === '8-ball',
  };
}

function badgeLabel(target) {
  if (target === 'solids') return 'SOLIDS 1-7';
  if (target === 'stripes') return 'STRIPES 9-15';
  if (target === '8-ball') return '8-BALL';
  return 'OPEN';
}

const p2Name = computed(() =>
  gameState.opponentType === 'ai'
    ? `P2 (AI: ${aiConfig.value.provider.toUpperCase()})`
    : 'P2 (HUMAN)'
);

const turnPhase = computed(() => {
  if (gameState.winner) return `${gameState.winner} WINS`;
  if (gameState.isBreakShot) return 'BREAK SHOT';
  if (gameState.ballInHand) return 'BALL IN HAND';
  return `${gameState.currentPlayer} TO SHOOT`;
});
</script>

<template>
  <div class="scoreboard" aria-label="Match Scoreboard">
    <div
      id="p1Card"
      class="player-card"
      :class="{
        'active-turn': gameState.currentPlayer === 'P1' && !gameState.winner,
        winner: gameState.winner === 'P1',
      }"
    >
      <div>
        <div class="player-name">P1 (HUMAN)</div>
        <div id="p1Remaining" class="brand-sub">{{ p1RemainingText }}</div>
      </div>
      <span id="p1GroupBadge" class="player-group" :class="badgeClass(p1Target)">
        {{ badgeLabel(p1Target) }}
      </span>
    </div>

    <div class="turn-badge">
      <strong id="turnNumberLabel">TURN {{ gameState.turnNumber }}</strong>
      <span id="turnPhaseLabel">{{ turnPhase }}</span>
    </div>

    <div
      id="p2Card"
      class="player-card"
      :class="{
        'active-turn': gameState.currentPlayer === 'P2' && !gameState.winner,
        winner: gameState.winner === 'P2',
      }"
    >
      <div>
        <div id="p2NameLabel" class="player-name">{{ p2Name }}</div>
        <div id="p2Remaining" class="brand-sub">{{ p2RemainingText }}</div>
      </div>
      <span id="p2GroupBadge" class="player-group" :class="badgeClass(p2Target)">
        {{ badgeLabel(p2Target) }}
      </span>
    </div>
  </div>
</template>
