<script setup>
const { gameState, isSimulating, setOpponentType, openAIModal, startNewMatch } = usePoolGame();
</script>

<template>
  <header class="top-bar">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">8</div>
      <div>
        <h1>8 Bit Pool // 8 Ball Pool, but for nerds</h1>
        <div class="brand-sub">
          Turn-based Cartesian billiard physics &bull; 2D Neon 8-Bit Native Canvas
        </div>
      </div>
    </div>

    <div class="header-controls">
      <div class="segmented" role="group" aria-label="Opponent Type">
        <button
          id="btnModeHuman"
          type="button"
          :class="{ active: gameState.opponentType !== 'ai' }"
          :disabled="isSimulating"
          @click="setOpponentType('human')"
        >
          2P Human
        </button>
        <button
          id="btnModeAI"
          type="button"
          :class="{ active: gameState.opponentType === 'ai' }"
          :disabled="isSimulating"
          @click="setOpponentType('ai')"
        >
          VS AI (LLM)
        </button>
      </div>
      <button id="btnOpenAIConfig" class="btn" type="button" @click="openAIModal()">
        AI Endpoint
      </button>
      <button
        id="btnNewMatch"
        class="btn btn-amber"
        type="button"
        @click="startNewMatch()"
      >
        New Match
      </button>
    </div>
  </header>
</template>
