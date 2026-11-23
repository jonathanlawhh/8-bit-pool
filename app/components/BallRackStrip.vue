<script setup>
const { liveBalls, BALL_STYLES } = usePoolGame();

const solids = computed(() => liveBalls.value.filter((b) => b.type === 'solid'));
const eight = computed(() => liveBalls.value.filter((b) => b.type === 'eight'));
const stripes = computed(() => liveBalls.value.filter((b) => b.type === 'stripe'));

function chipStyle(b) {
  const st = BALL_STYLES[b.id];
  return {
    backgroundColor: b.type === 'eight' ? '#090c14' : st.color,
    color: [1, 9, 6, 14].includes(b.id) ? '#041018' : '#ffffff',
  };
}

function chipTitle(b) {
  return `#${b.id} (${b.type}) ${
    b.pocketed ? 'Pocketed' : `(${b.x.toFixed(1)}, ${b.y.toFixed(1)}) cm`
  }`;
}
</script>

<template>
  <div class="rack-strip" aria-label="Balls Status">
    <span class="rack-label">Solids:</span>
    <div id="rackSolids" style="display: flex; gap: 4px">
      <div
        v-for="b in solids"
        :key="b.id"
        class="ball-chip"
        :class="{ pocketed: b.pocketed }"
        :style="chipStyle(b)"
        :title="chipTitle(b)"
      >
        {{ b.id }}
      </div>
    </div>

    <span class="rack-label" style="margin-left: 8px">8:</span>
    <div id="rackEight" style="display: flex; gap: 4px">
      <div
        v-for="b in eight"
        :key="b.id"
        class="ball-chip"
        :class="{ pocketed: b.pocketed }"
        :style="chipStyle(b)"
        :title="chipTitle(b)"
      >
        {{ b.id }}
      </div>
    </div>

    <span class="rack-label" style="margin-left: 8px">Stripes:</span>
    <div id="rackStripes" style="display: flex; gap: 4px">
      <div
        v-for="b in stripes"
        :key="b.id"
        class="ball-chip stripe-chip"
        :class="{ pocketed: b.pocketed }"
        :style="chipStyle(b)"
        :title="chipTitle(b)"
      >
        {{ b.id }}
      </div>
    </div>
  </div>
</template>
