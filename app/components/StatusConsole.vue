<script setup>
const { gameState, statusBanner, inspectSnapshot, exitReplaySnapshot } = usePoolGame();
</script>

<template>
  <div
    id="statusConsole"
    class="status-console"
    :class="{
      foul: statusBanner.tone === 'err',
      win: statusBanner.tone === 'warn' && Boolean(gameState.winner),
    }"
    role="status"
    aria-live="polite"
  >
    <div class="status-text">
      <span
        id="statusTag"
        class="status-tag"
        :class="{
          warn: statusBanner.tone === 'warn',
          err: statusBanner.tone === 'err',
        }"
      >
        {{ statusBanner.tag }}
      </span>
      <span id="statusMessage">{{ statusBanner.message }}</span>
    </div>
    <button
      v-if="inspectSnapshot"
      id="btnExitReplay"
      class="btn btn-amber btn-xs"
      type="button"
      @click="exitReplaySnapshot()"
    >
      Exit Snapshot
    </button>
  </div>
</template>
