<script setup>
import { CANVAS_W, CANVAS_H, canvasToTable } from '~/engine/renderer.js';

const { TABLE, activeMode, setHoverCoord, mountCanvasLoop, unmountCanvasLoop } = usePoolGame();
const canvasRef = ref(null);

function handleMouseMove(ev) {
  const el = canvasRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const cx = ((ev.clientX - rect.left) / rect.width) * CANVAS_W;
  const cy = ((ev.clientY - rect.top) / rect.height) * CANVAS_H;
  const pos = canvasToTable(cx, cy);
  const pad = TABLE.ballRadiusCm;
  if (
    pos.x >= -pad &&
    pos.x <= TABLE.widthCm + pad &&
    pos.y >= -pad &&
    pos.y <= TABLE.heightCm + pad
  ) {
    setHoverCoord(pos);
  } else {
    setHoverCoord(null);
  }
}

function handleMouseLeave() {
  setHoverCoord(null);
}

onMounted(() => {
  if (canvasRef.value) {
    mountCanvasLoop(canvasRef.value);
  }
});

onBeforeUnmount(() => {
  unmountCanvasLoop();
});
</script>

<template>
  <div class="table-frame">
    <canvas
      id="poolCanvas"
      ref="canvasRef"
      :width="CANVAS_W"
      :height="CANVAS_H"
      aria-label="8-Ball Pool Coordinate Table"
      @mousemove="handleMouseMove"
      @mouseleave="handleMouseLeave"
    />
    <div class="canvas-hint">
      <span id="canvasTipText">
        INPUT-ONLY: Enter Cue (X, Y), Rotation &theta;, Power (N), and Spin (X, Y) using the controls.
      </span>
      <span id="tableModeLabel">MODE: {{ activeMode.name.toUpperCase() }}</span>
    </div>
  </div>
</template>
