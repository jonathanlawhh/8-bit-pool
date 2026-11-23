<script setup>
const { aiModalOpen, disableShotControls, init, executeShot } = usePoolGame();

function handleKeyDown(ev) {
  if (
    ev.key === 'Enter' &&
    !aiModalOpen.value &&
    !['TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName) &&
    !disableShotControls.value
  ) {
    ev.preventDefault();
    executeShot();
  }
}

onMounted(() => {
  init();
  document.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div>
    <AppHeader />

    <main class="workspace">
      <section class="stage-col">
        <MatchScoreboard />
        <PoolTableCanvas />
        <StatusConsole />
        <BallRackStrip />
      </section>

      <aside class="side-col">
        <ShotControls />
        <TelemetryTabs />
      </aside>
    </main>

    <AppFooter />

    <AIConfigModal />
  </div>
</template>
