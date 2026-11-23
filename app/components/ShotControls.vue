<script setup>
import { renderSpinPad } from '~/engine/renderer.js';

const {
  activeMode,
  aiConfig,
  gameState,
  shotInput,
  isSimulating,
  isAIBusy,
  autoAI,
  inspectSnapshot,
  cueCoordError,
  aiErrorMsg,
  isAITurn,
  canPlaceCue,
  disableShotControls,
  miscueLimit,
  kinematics,
  p2Target,
  updateCuePlacement,
  setRotation,
  nudgeRotation,
  setPower,
  setSpin,
  resetSpin,
  executeShot,
  triggerAITurn,
  openAIModal,
} = usePoolGame();

const spinCanvasRef = ref(null);
const rotNudges = [-5, -1, -0.2, 0.2, 1, 5];
const powerPresets = [
  { label: 'Soft 450N', value: 450 },
  { label: 'Med 900N', value: 900 },
  { label: 'Firm 1450N', value: 1450 },
  { label: 'Break 2500N', value: 2500 },
];

const panelTitle = computed(() => {
  if (gameState.winner) return `Match Complete (${gameState.winner} Won)`;
  if (isAITurn.value) return `AI Turn (${aiConfig.value.provider.toUpperCase()})`;
  return `Shot Vector Input (${gameState.currentPlayer})`;
});

const cueRuleLabel = computed(() => {
  if (!gameState.ballInHand) return 'Locked (Ball in Play)';
  return gameState.ballInHandKitchenOnly ? 'Kitchen: X <= 63.5 cm' : 'Ball-in-Hand: Anywhere';
});

const powerUnitText = computed(() => {
  const k = kinematics.value;
  return `${Math.round(k.powerN)} N (~${Math.round(k.powerLbf)} lbf / ${Math.round(k.powerKgf)} kgf)`;
});

const spinOffsetText = computed(() => {
  const k = kinematics.value;
  if (k.isMiscue) {
    return `MISCUE RISK! (${k.spinOffsetMmX.toFixed(1)}, ${k.spinOffsetMmY.toFixed(1)} mm)`;
  }
  return `(${shotInput.spinX.toFixed(2)}, ${shotInput.spinY.toFixed(2)}) | ${k.spinOffsetMmX.toFixed(1)}, ${k.spinOffsetMmY.toFixed(1)} mm`;
});

function drawSpinPreview() {
  if (!spinCanvasRef.value) return;
  renderSpinPad(
    spinCanvasRef.value,
    shotInput.spinX,
    shotInput.spinY,
    miscueLimit.value,
    activeMode.value.stickTipRadiusMm
  );
}

watch(
  [() => shotInput.spinX, () => shotInput.spinY, miscueLimit, () => activeMode.value.stickTipRadiusMm],
  drawSpinPreview
);

onMounted(drawSpinPreview);
</script>

<template>
  <section class="panel" aria-label="Turn Shot Controls">
    <div class="panel-header">
      <h2 id="controlPanelTitle" class="panel-title">{{ panelTitle }}</h2>
      <label v-if="gameState.opponentType === 'ai'" id="autoAIRow" class="checkbox-row">
        <input id="chkAutoAI" v-model="autoAI" type="checkbox" />
        Auto-run AI
      </label>
    </div>

    <!-- AI Turn Box -->
    <div v-if="isAITurn && !inspectSnapshot" id="aiTurnBox" class="ai-turn-box">
      <p id="aiTurnSummary">
        AI ({{ aiConfig.provider.toUpperCase() }} / {{ aiConfig.model || 'bot' }}) assigned:
        {{ p2Target.toUpperCase() }}. Sends balls, pockets, walls &amp; turn history JSON.
      </p>
      <div style="display: flex; gap: 6px; flex-wrap: wrap">
        <button
          id="btnRequestAIShot"
          class="btn btn-primary"
          type="button"
          style="flex: 1"
          :disabled="isSimulating || isAIBusy"
          @click="triggerAITurn()"
        >
          {{ isAIBusy ? 'Waiting for AI JSON...' : 'Request AI Shot' }}
        </button>
        <button
          id="btnOpenAIConfigInline"
          class="btn"
          type="button"
          @click="openAIModal()"
        >
          Config
        </button>
      </div>
      <div v-if="aiErrorMsg" id="aiErrorMsg" class="validation-msg">{{ aiErrorMsg }}</div>
    </div>

    <!-- Cue Ball X/Y Placement -->
    <div id="cueCoordBox" class="coord-box" :class="{ inactive: !canPlaceCue }">
      <div class="field-label-row" style="margin-bottom: 0">
        <strong id="cueCoordTitle">CUE BALL PLACEMENT (X, Y cm)</strong>
        <span id="cueCoordRule" style="color: var(--neon-amber)">{{ cueRuleLabel }}</span>
      </div>
      <div class="coord-grid">
        <label>
          X (cm)
          <input
            id="inputCueX"
            class="num-input"
            type="number"
            step="0.5"
            min="0"
            max="254"
            :value="shotInput.cueX"
            :disabled="!canPlaceCue || isAITurn"
            @input="updateCuePlacement(Number($event.target.value), shotInput.cueY)"
          />
        </label>
        <label>
          Y (cm)
          <input
            id="inputCueY"
            class="num-input"
            type="number"
            step="0.5"
            min="0"
            max="127"
            :value="shotInput.cueY"
            :disabled="!canPlaceCue || isAITurn"
            @input="updateCuePlacement(shotInput.cueX, Number($event.target.value))"
          />
        </label>
      </div>
      <div v-if="cueCoordError" id="cueCoordError" class="validation-msg">{{ cueCoordError }}</div>
    </div>

    <!-- Rotation (Degrees) -->
    <div class="field-group">
      <div class="field-label-row">
        <strong>ROTATION &theta; (degrees)</strong>
        <span>0&deg; = +X &bull; 90&deg; = +Y</span>
      </div>
      <div class="input-row">
        <input
          id="rangeRotation"
          class="range-input"
          type="range"
          min="0"
          max="360"
          step="0.1"
          :value="shotInput.rotationDeg"
          :disabled="disableShotControls"
          @input="setRotation($event.target.value)"
        />
        <input
          id="inputRotation"
          class="num-input"
          type="number"
          step="0.1"
          min="-360"
          max="720"
          :value="shotInput.rotationDeg"
          :disabled="disableShotControls"
          @input="setRotation($event.target.value)"
        />
      </div>
      <div class="preset-row">
        <button
          v-for="d in rotNudges"
          :key="d"
          class="btn btn-xs rot-nudge"
          type="button"
          :disabled="disableShotControls"
          @click="nudgeRotation(d)"
        >
          {{ d > 0 ? `+${d}` : d }}&deg;
        </button>
      </div>
    </div>

    <!-- Power (Punching Power Unit - Newtons) -->
    <div class="field-group">
      <div class="field-label-row">
        <strong>POWER (Punching Force: N)</strong>
        <span id="powerUnitReadout">{{ powerUnitText }}</span>
      </div>
      <div class="input-row">
        <input
          id="rangePower"
          class="range-input"
          type="range"
          :min="activeMode.minPowerN"
          :max="activeMode.maxPowerN"
          step="10"
          :value="shotInput.powerN"
          :disabled="disableShotControls"
          @input="setPower($event.target.value)"
        />
        <input
          id="inputPower"
          class="num-input"
          type="number"
          :min="activeMode.minPowerN"
          :max="activeMode.maxPowerN"
          step="10"
          :value="shotInput.powerN"
          :disabled="disableShotControls"
          @input="setPower($event.target.value)"
        />
      </div>
      <div class="preset-row">
        <button
          v-for="p in powerPresets"
          :key="p.value"
          class="btn btn-xs pow-preset"
          type="button"
          :disabled="disableShotControls"
          @click="setPower(p.value)"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <!-- Spin Hit Point (X, Y) — input-only controls with read-only visual preview -->
    <div class="field-group">
      <div class="field-label-row">
        <strong>CUE HIT POINT / SPIN (X, Y)</strong>
        <span id="spinOffsetReadout">{{ spinOffsetText }}</span>
      </div>
      <div class="spin-layout">
        <canvas
          id="spinCanvas"
          ref="spinCanvasRef"
          width="112"
          height="112"
          aria-label="Cue Ball Spin Offset Preview"
        />
        <div class="spin-fields">
          <label>
            Spin X (Side)
            <input
              id="inputSpinX"
              class="num-input"
              type="number"
              min="-1"
              max="1"
              step="0.05"
              :value="shotInput.spinX"
              :disabled="disableShotControls"
              @input="setSpin($event.target.value, shotInput.spinY)"
            />
          </label>
          <label>
            Spin Y (Top/Draw)
            <input
              id="inputSpinY"
              class="num-input"
              type="number"
              min="-1"
              max="1"
              step="0.05"
              :value="shotInput.spinY"
              :disabled="disableShotControls"
              @input="setSpin(shotInput.spinX, $event.target.value)"
            />
          </label>
          <button
            id="btnResetSpin"
            class="btn btn-xs"
            type="button"
            :disabled="disableShotControls"
            @click="resetSpin()"
          >
            Center (0, 0)
          </button>
        </div>
      </div>
    </div>

    <div class="shoot-bar">
      <button
        id="btnShoot"
        class="btn btn-primary"
        type="button"
        :disabled="disableShotControls"
        @click="executeShot()"
      >
        Execute Shot [Enter]
      </button>
    </div>
  </section>
</template>
