<script setup>
import { computed, ref, watch } from 'vue'
import { buildTraceTimeline, snapshotTrace } from '../../agent/tracing.js'
import { formatJson } from './chat-format.js'

const props = defineProps({
  trace: {
    type: Object,
    default: null
  },
  running: {
    type: Boolean,
    default: false
  }
})

const activeFilter = ref('all')
const selectedEntryId = ref('')
const copiedState = ref('')

const traceSnapshot = computed(() => (props.trace ? snapshotTrace(props.trace) : null))
const timeline = computed(() => buildTraceTimeline(traceSnapshot.value))
const filteredTimeline = computed(() => {
  if (activeFilter.value === 'all') return timeline.value
  if (activeFilter.value === 'error') {
    return timeline.value.filter(item => item.status === 'error')
  }
  return timeline.value.filter(item => item.category === activeFilter.value)
})

const selectedEntry = computed(() =>
  filteredTimeline.value.find(item => item.id === selectedEntryId.value) || filteredTimeline.value[0] || null
)

watch(filteredTimeline, entries => {
  if (!entries.length) {
    selectedEntryId.value = ''
    return
  }
  if (!entries.some(item => item.id === selectedEntryId.value)) {
    selectedEntryId.value = entries[0].id
  }
}, { immediate: true })

function setFilter(filter) {
  activeFilter.value = filter
}

function selectEntry(entryId) {
  selectedEntryId.value = entryId
}

function formatTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function getStatusLabel(status) {
  switch (status) {
    case 'completed':
      return '已完成'
    case 'running':
      return '运行中'
    case 'error':
      return '失败'
    case 'aborted':
      return '已终止'
    default:
      return status || '空闲'
  }
}

function getEntryTone(entry) {
  if (!entry) return 'muted'
  if (entry.status === 'error') return 'error'
  if (entry.status === 'success') return 'success'
  if (entry.status === 'warning') return 'warning'
  if (entry.category === 'ai') return 'info'
  return 'muted'
}

async function copyEntry(entry) {
  const content = entry ? formatJson(entry.raw) : ''
  if (!content) return

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(content)
    }
    copiedState.value = entry.id
    window.setTimeout(() => {
      if (copiedState.value === entry.id) {
        copiedState.value = ''
      }
    }, 1200)
  } catch {
    copiedState.value = ''
  }
}

const filterOptions = [
  { id: 'all', label: '全部' },
  { id: 'ai', label: 'AI' },
  { id: 'tool', label: '工具' },
  { id: 'network', label: '网络' },
  { id: 'error', label: '错误' }
]
</script>

<template>
  <aside data-testid="trace-panel" class="trace-panel">
    <div class="trace-header">
      <div>
        <div class="trace-kicker">Debug</div>
        <div class="trace-title">调试链路</div>
      </div>
      <span class="trace-status" :data-running="running">{{ getStatusLabel(traceSnapshot?.status || '') }}</span>
    </div>

    <div v-if="!traceSnapshot" class="trace-empty">
      暂无链路数据
    </div>

    <template v-else>
      <div class="trace-meta">
        <span>{{ traceSnapshot.provider || 'unknown' }}</span>
        <span>{{ traceSnapshot.model || '-' }}</span>
        <span>{{ timeline.length }} events</span>
      </div>

      <div class="trace-filters">
        <button
          v-for="filter in filterOptions"
          :key="filter.id"
          class="trace-filter-btn"
          :class="{ active: activeFilter === filter.id }"
          @click="setFilter(filter.id)"
        >
          {{ filter.label }}
        </button>
      </div>

      <div class="trace-body">
        <div class="trace-list">
          <button
            v-for="entry in filteredTimeline"
            :key="entry.id"
            class="trace-entry"
            :class="[`tone-${getEntryTone(entry)}`, { active: selectedEntry?.id === entry.id }]"
            @click="selectEntry(entry.id)"
          >
            <div class="trace-entry-top">
              <span class="trace-entry-label">{{ entry.label }}</span>
              <span class="trace-entry-time">{{ formatTime(entry.at) }}</span>
            </div>
            <div class="trace-entry-summary">{{ entry.summary }}</div>
          </button>
        </div>

        <div class="trace-detail">
          <div v-if="selectedEntry" class="trace-detail-header">
            <div class="trace-detail-copy">
              <div class="trace-detail-title">{{ selectedEntry.label }}</div>
              <div class="trace-detail-summary">{{ selectedEntry.summary }}</div>
            </div>
            <button
              data-testid="trace-copy-btn"
              class="trace-copy-btn"
              @click="copyEntry(selectedEntry)"
            >
              {{ copiedState === selectedEntry.id ? '已复制' : '复制结果' }}
            </button>
          </div>
          <pre v-if="selectedEntry" data-testid="trace-detail-json" class="trace-detail-json">{{ formatJson(selectedEntry.raw) }}</pre>
          <div v-else class="trace-empty">当前筛选下没有事件</div>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.trace-panel {
  width: 360px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-left: 1px solid color-mix(in srgb, var(--glass-border) 86%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
}

.trace-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.trace-kicker {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-primary);
}

.trace-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.trace-status {
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--glass-bg) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-border) 88%, transparent);
}

.trace-status[data-running="true"] {
  color: var(--accent-secondary);
  border-color: color-mix(in srgb, var(--accent-secondary) 26%, transparent);
}

.trace-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.trace-meta span {
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
}

.trace-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.trace-filter-btn,
.trace-entry {
  border: 1px solid color-mix(in srgb, var(--glass-border) 86%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 48%, transparent);
}

.trace-filter-btn {
  min-height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}

.trace-filter-btn.active {
  color: #fff;
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.trace-body {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-rows: minmax(180px, 1fr) minmax(180px, 1fr);
  gap: 10px;
}

.trace-list,
.trace-detail {
  min-height: 0;
  overflow: auto;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--glass-border) 88%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 42%, transparent);
}

.trace-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 0;
}

.trace-detail-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trace-copy-btn {
  flex-shrink: 0;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--glass-border) 84%, transparent);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.trace-copy-btn:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--glass-bg) 90%, transparent);
  border-color: color-mix(in srgb, var(--glass-border-strong) 88%, transparent);
}

.trace-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.trace-entry {
  width: 100%;
  padding: 10px;
  border-radius: 10px;
  text-align: left;
  cursor: pointer;
}

.trace-entry.active {
  border-color: color-mix(in srgb, var(--accent-primary) 34%, transparent);
  background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
}

.trace-entry.tone-success {
  border-color: var(--success-border);
}

.trace-entry.tone-error {
  border-color: var(--error-border);
}

.trace-entry.tone-info {
  border-color: color-mix(in srgb, var(--accent-secondary) 28%, transparent);
}

.trace-entry-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.trace-entry-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.trace-entry-time,
.trace-entry-summary,
.trace-detail-summary,
.trace-empty {
  font-size: 11px;
  color: var(--text-tertiary);
}

.trace-entry-summary {
  margin-top: 4px;
  line-height: 1.55;
}

.trace-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.trace-detail-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.trace-detail-summary {
  margin-top: 4px;
}

.trace-detail-json {
  margin: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  font-size: 11px;
  line-height: 1.6;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.trace-empty {
  padding: 12px;
}

@media (max-width: 1280px) {
  .trace-panel {
    display: none;
  }
}
</style>
