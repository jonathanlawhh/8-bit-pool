<script setup>
const {
  TABLE,
  POCKETS,
  activeMode,
  liveBalls,
  kinematics,
  trajectoryPreview,
  aiPayloadJson,
  lastAIResponseRaw,
  turnHistory,
  savedMatches,
  activeMatchId,
  inspectSnapshot,
  isSimulating,
  applyManualJson,
  enterReplaySnapshot,
  loadTurnInputs,
  revisitMatch,
  deleteMatch,
  clearMatches,
  exportHistoryJson,
} = usePoolGame();

const activeTab = ref('math');
const copyLabel = ref('Copy JSON');
const manualJsonText = ref('');
const manualJsonError = ref('');

const previewContactText = computed(() => {
  const pv = trajectoryPreview.value;
  if (pv?.hitType === 'ball') {
    return `Ball #${pv.hitBallId} (cut ${pv.cutAngleDeg.toFixed(1)}°)`;
  }
  if (pv?.hitType === 'rail') {
    return `Cushion at ${pv.lengthCm.toFixed(1)} cm`;
  }
  return `Open (${activeMode.value.trajectoryPreviewLengthCm} cm ray)`;
});

const formulaText = computed(() => {
  const kin = kinematics.value;
  const rad = (kin.effectiveAngleDeg * Math.PI) / 180;
  return (
    `J = 0.5 * F * dt = 0.5 * ${Math.round(kin.powerN)}N * ${(TABLE.cueContactTimeS * 1000).toFixed(1)}ms = ${kin.impulseNs.toFixed(3)} N·s\n` +
    `v0 = J / m = ${kin.impulseNs.toFixed(3)} / ${activeMode.value.ballWeightKg.toFixed(3)}kg = ${kin.speedMps.toFixed(2)} m/s\n` +
    `cos(${kin.effectiveAngleDeg.toFixed(1)}°) = ${Math.cos(rad).toFixed(3)}, sin = ${Math.sin(rad).toFixed(3)} (squirt ${kin.squirtDeg >= 0 ? '+' : ''}${kin.squirtDeg.toFixed(2)}°)\n` +
    `Decel: slide = -${kin.slidingDecelMps2.toFixed(2)} m/s², roll = -${kin.rollingDecelMps2.toFixed(3)} m/s²`
  );
});

const pocketsText = computed(() =>
  POCKETS.map((p) => `${p.label} (${p.id}): (${p.x}, ${p.y}) r=${p.radiusCm}cm`).join('\n')
);

const reversedHistory = computed(() =>
  turnHistory.value
    .map((turn, originalIndex) => ({ turn, originalIndex }))
    .reverse()
);

async function copyPayload() {
  try {
    await navigator.clipboard.writeText(aiPayloadJson.value);
    copyLabel.value = 'Copied!';
    setTimeout(() => {
      copyLabel.value = 'Copy JSON';
    }, 1200);
  } catch {
    copyLabel.value = 'Select & Copy';
  }
}

function handleManualJson(andShoot) {
  manualJsonError.value = '';
  try {
    applyManualJson(manualJsonText.value, andShoot);
  } catch (err) {
    manualJsonError.value = err?.message || 'Invalid JSON input.';
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleString();
}
</script>

<template>
  <section class="panel" aria-label="Physics, Coordinates, AI JSON and History">
    <div class="tab-bar" role="tablist">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'math' }"
        role="tab"
        type="button"
        @click="activeTab = 'math'"
      >
        Math/Phys
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'coords' }"
        role="tab"
        type="button"
        @click="activeTab = 'coords'"
      >
        Coords
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'aijson' }"
        role="tab"
        type="button"
        @click="activeTab = 'aijson'"
      >
        AI JSON
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'history' }"
        role="tab"
        type="button"
        @click="activeTab = 'history'"
      >
        History
      </button>
    </div>

    <!-- Tab 1: Educational Math & Physics -->
    <div v-show="activeTab === 'math'" id="tab-math" class="tab-pane active">
      <div class="math-grid">
        <div class="math-cell">
          <span class="k">Initial Speed v&#8320;</span>
          <span id="mathSpeed" class="v" :class="{ warn: kinematics.isMiscue }">
            {{ kinematics.speedMps.toFixed(2) }} m/s ({{ kinematics.speedMph.toFixed(1) }} mph)
          </span>
        </div>
        <div class="math-cell">
          <span class="k">Impulse J = &frac12;F&middot;&Delta;t</span>
          <span id="mathImpulse" class="v">{{ kinematics.impulseNs.toFixed(3) }} N&middot;s</span>
        </div>
        <div class="math-cell">
          <span class="k">Velocity Vector (vx, vy)</span>
          <span id="mathVelocityVec" class="v">
            ({{ kinematics.vx.toFixed(2) }}, {{ kinematics.vy.toFixed(2) }}) m/s
          </span>
        </div>
        <div class="math-cell">
          <span class="k">Kinetic Energy E&#8342;</span>
          <span id="mathEnergy" class="v">{{ kinematics.kineticEnergyJ.toFixed(2) }} J</span>
        </div>
        <div class="math-cell">
          <span class="k">Angular Spin (&omega;_top, &omega;_z)</span>
          <span id="mathSpin" class="v">
            {{ kinematics.omegaForward.toFixed(0) }}, {{ kinematics.wz.toFixed(0) }} rad/s
          </span>
        </div>
        <div class="math-cell">
          <span class="k">Preview Contact / Cut &theta;</span>
          <span id="mathCut" class="v">{{ previewContactText }}</span>
        </div>
      </div>
      <div id="mathFormulas" class="formula-box">{{ formulaText }}</div>
    </div>

    <!-- Tab 2: Live Read-Only Ball & Pocket Coordinates -->
    <div v-show="activeTab === 'coords'" id="tab-coords" class="tab-pane active">
      <div class="helper-note" style="margin-top: 0; margin-bottom: 6px">
        Reference coordinates in cm (origin bottom-left). Use atan2(&Delta;y, &Delta;x) to compute aim angle &theta;.
      </div>
      <div class="scroll-box">
        <table class="coord-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>X (cm)</th>
              <th>Y (cm)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="coordsTableBody">
            <tr v-for="b in liveBalls" :key="b.id">
              <td><strong>#{{ b.id }}</strong></td>
              <td>{{ b.type }}</td>
              <td>{{ b.pocketed ? '-' : b.x.toFixed(2) }}</td>
              <td>{{ b.pocketed ? '-' : b.y.toFixed(2) }}</td>
              <td>{{ b.pocketed ? `in ${b.pocketId}` : 'active' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="sub-heading">Table Pockets (6 Holes)</div>
      <div id="pocketsReadout" class="formula-box" style="font-size: 10px">{{ pocketsText }}</div>
    </div>

    <!-- Tab 3: AI JSON Inspector & Manual Paste -->
    <div v-show="activeTab === 'aijson'" id="tab-aijson" class="tab-pane active">
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span class="sub-heading" style="margin: 0">Outgoing State JSON (To AI)</span>
        <button id="btnCopyPayload" class="btn btn-xs" type="button" @click="copyPayload()">
          {{ copyLabel }}
        </button>
      </div>
      <pre id="aiPayloadPreview" class="code-pre">{{ aiPayloadJson }}</pre>

      <div class="sub-heading">Last AI Structured JSON Reply</div>
      <pre id="aiResponsePreview" class="code-pre">{{ lastAIResponseRaw || '// No AI response yet.' }}</pre>

      <div class="sub-heading">Manual JSON Input (Test Any LLM)</div>
      <textarea
        id="manualJsonInput"
        v-model="manualJsonText"
        class="json-textarea"
        placeholder='{"rotation_deg": 12.5, "power_n": 950, "spin_x": 0, "spin_y": 0.15}'
      />
      <div style="display: flex; gap: 6px; margin-top: 5px">
        <button
          id="btnApplyManualJson"
          class="btn btn-xs"
          type="button"
          @click="handleManualJson(false)"
        >
          Apply JSON to Controls
        </button>
        <button
          id="btnShootManualJson"
          class="btn btn-primary btn-xs"
          type="button"
          @click="handleManualJson(true)"
        >
          Apply &amp; Shoot
        </button>
      </div>
      <div v-if="manualJsonError" id="manualJsonError" class="validation-msg">
        {{ manualJsonError }}
      </div>
    </div>

    <!-- Tab 4: Turn Action Array & Browser Storage Matches -->
    <div v-show="activeTab === 'history'" id="tab-history" class="tab-pane active">
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          margin-bottom: 6px;
        "
      >
        <span id="historyCountLabel" class="sub-heading" style="margin: 0">
          Current Match Turns ({{ turnHistory.length }})
        </span>
        <button
          id="btnExportHistory"
          class="btn btn-xs"
          type="button"
          @click="exportHistoryJson()"
        >
          Export JSON
        </button>
      </div>

      <div id="turnHistoryList" class="scroll-box" style="max-height: 170px">
        <div v-if="reversedHistory.length === 0" class="history-item history-meta">
          No turns played yet. Actions will be stored here &amp; sent to AI.
        </div>
        <div
          v-for="{ turn, originalIndex } in reversedHistory"
          :key="`${turn.turnNumber}_${originalIndex}`"
          class="history-item"
          :class="{ 'active-inspect': inspectSnapshot?.turnIndex === originalIndex }"
        >
          <div class="history-head">
            <strong>
              T{{ turn.turnNumber }} &bull; {{ turn.playerRole }}{{ turn.outcome.foul ? ' [FOUL]' : '' }}
            </strong>
            <span class="history-meta">
              &theta;={{ turn.input.rotationDeg }}&deg; | {{ turn.input.powerN }}N |
              spin({{ turn.input.spinX }},{{ turn.input.spinY }})
            </span>
          </div>
          <div class="history-meta">
            {{
              turn.outcome.pocketedBalls.length
                ? `Pocketed: ${turn.outcome.pocketedBalls.map((id) => `#${id}`).join(', ')}`
                : 'No pocket'
            }}
            <template v-if="turn.cuePlacement">
              | Cue({{ turn.cuePlacement.x }}, {{ turn.cuePlacement.y }})
            </template>
          </div>
          <div v-if="turn.aiReasoning" class="history-meta" style="color: #8be9ff">
            AI: {{ turn.aiReasoning }}
          </div>
          <div class="history-actions">
            <button
              class="btn btn-xs"
              type="button"
              @click="
                enterReplaySnapshot(
                  turn.ballsBefore,
                  `SNAPSHOT: Turn ${turn.turnNumber} (${turn.playerRole}) BEFORE`,
                  originalIndex
                )
              "
            >
              View Before
            </button>
            <button
              class="btn btn-xs"
              type="button"
              @click="
                enterReplaySnapshot(
                  turn.ballsAfter,
                  `SNAPSHOT: Turn ${turn.turnNumber} (${turn.playerRole}) AFTER`,
                  originalIndex
                )
              "
            >
              View After
            </button>
            <button class="btn btn-xs" type="button" @click="loadTurnInputs(turn)">
              Load Inputs
            </button>
          </div>
        </div>
      </div>

      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          margin-top: 10px;
          margin-bottom: 5px;
        "
      >
        <span class="sub-heading" style="margin: 0">Saved Matches (Browser Storage)</span>
        <button
          id="btnClearStorage"
          class="btn btn-danger btn-xs"
          type="button"
          @click="clearMatches()"
        >
          Clear All
        </button>
      </div>

      <div id="savedMatchesList" class="scroll-box" style="max-height: 140px">
        <div v-if="savedMatches.length === 0" class="history-item history-meta">
          No saved matches in browser storage yet.
        </div>
        <div v-for="m in savedMatches" :key="m.id" class="history-item">
          <div class="history-head">
            <strong>
              {{ m.id === activeMatchId ? '[ACTIVE] ' : '' }}
              {{ m.opponentType === 'ai' ? 'VS AI' : '2P Human' }}
              ({{ m.turnHistory?.length || 0 }} turns)
            </strong>
            <span class="history-meta">
              {{ m.gameState?.winner ? `Winner: ${m.gameState.winner}` : 'In progress' }}
            </span>
          </div>
          <div class="history-meta">{{ formatDate(m.updatedAt || m.createdAt) }}</div>
          <div class="history-actions">
            <button
              class="btn btn-xs"
              type="button"
              :disabled="m.id === activeMatchId || isSimulating"
              @click="revisitMatch(m)"
            >
              {{ m.id === activeMatchId ? 'Loaded' : 'Revisit Match' }}
            </button>
            <button
              class="btn btn-xs btn-danger"
              type="button"
              @click="deleteMatch(m.id)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
