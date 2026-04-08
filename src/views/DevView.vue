<script setup>
import { computed } from 'vue'
import PipelinePanel from '../components/release/PipelinePanel.vue'
import AgentChatPanel from '../components/release/AgentChatPanel.vue'
import { useReleaseStore } from '../stores/release'

const emit = defineEmits(['navigate-home'])
const release = useReleaseStore()
const showPipeline = computed(() => release.isReleaseMode && release.sessionActive)
</script>

<template>
  <div class="dev-view" :class="{ 'has-pipeline': showPipeline }">
    <div v-if="showPipeline" class="dev-left">
      <PipelinePanel />
    </div>
    <div class="dev-right">
      <AgentChatPanel @navigate-home="emit('navigate-home')" />
    </div>
  </div>
</template>

<style scoped>
.dev-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.dev-left {
  width: 320px;
  min-width: 280px;
  max-width: 400px;
  flex-shrink: 0;
  overflow: hidden;
  animation: slide-in-left 0.25s ease-out;
}

@keyframes slide-in-left {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}

.dev-right {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
</style>
