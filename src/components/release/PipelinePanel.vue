<script setup>
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useReleaseStore } from '../../stores/release'
import { RELEASE_STEP_ORDER } from '../../agent/workflows/release-session.js'

const release = useReleaseStore()
const expandedStep = ref(null)
const expandedBuildLog = ref(null)

function toggleStep(step) {
  expandedStep.value = expandedStep.value === step ? null : step
}

function stepStatus(step) {
  const stepId = STEPS[step]?.id
  const sessionStep = release.releaseSession?.steps?.[stepId]
  const status = sessionStep?.status || 'pending'

  if (status === 'done') return 'done'
  if (status === 'blocked') return 'blocked'
  if (status === 'awaiting_approval') return 'blocked'
  if (status === 'waiting_input' || (release.releaseSession?.currentStepId === stepId && status === 'pending')) return 'active'
  return 'pending'
}

function statusLabel(val) {
  if (val === true) return 'PASS'
  if (val === false) return 'BLOCKED'
  const map = { idle: '--', running: '...', pass: 'PASS', blocked: 'BLOCKED', warn: 'WARN', skipped: 'SKIP' }
  return map[val] || String(val)
}

function openUrl(url) {
  if (!url) return
  invoke('open_url_raw', { url })
}

const STEPS = [
  ...RELEASE_STEP_ORDER.map((step, index) => ({
    id: step.id,
    order: index,
    label: step.label,
    tool: step.toolName
  }))
]
</script>

<template>
  <div class="pipeline-panel">
    <div class="panel-header">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
      <span class="panel-title">Release Pipeline</span>
      <span v-if="release.version" class="panel-version">v{{ release.version }}</span>
    </div>
    <div class="panel-meta">
      <span class="meta-pill">{{ release.releaseSession?.status || 'draft' }}</span>
      <span v-if="release.currentGate" class="meta-pill danger">审批中: {{ release.currentGate.stepId }}</span>
      <span class="meta-pill">产物 {{ release.releaseArtifacts.length }}</span>
    </div>

    <div class="steps-list">
      <div
        v-for="step in STEPS"
        :key="step.order"
        class="step-item"
        :class="stepStatus(step.order)"
      >
        <button class="step-row" @click="toggleStep(step.order)">
          <span class="step-dot" :class="stepStatus(step.order)"></span>
          <span class="step-connector" v-if="step.order < STEPS.length - 1"></span>
          <span class="step-name">{{ step.label }}</span>
          <span v-if="stepStatus(step.order) === 'active'" class="step-active-indicator"></span>
          <svg
            v-if="step.order <= release.currentStep || release.releaseSession?.steps?.[step.id]?.status"
            class="step-chevron"
            :class="{ open: expandedStep === step.order }"
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><polyline points="6 9 12 15 18 9"/></svg>
        </button>

        <!-- Expanded detail -->
        <div v-if="expandedStep === step.order" class="step-detail">
          <div class="detail-row">
            <span class="detail-label">状态</span>
            <span class="detail-value" :class="{ ok: stepStatus(step.order) === 'done' }">
              {{ release.releaseSession?.steps?.[step.id]?.status || 'pending' }}
            </span>
          </div>

          <div v-if="release.releaseSession?.steps?.[step.id]?.summary" class="detail-row">
            <span class="detail-label">摘要</span>
            <span class="detail-value">{{ release.releaseSession.steps[step.id].summary }}</span>
          </div>

          <!-- Step 0: Credentials -->
          <template v-if="step.id === 'credentials'">
            <div class="detail-row">
              <span class="detail-label">Jira</span>
              <span class="detail-value" :class="{ ok: release.credentials.jira }">{{ release.credentials.jira ? '已就绪' : '未配置' }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">GitHub</span>
              <span class="detail-value" :class="{ ok: release.credentials.github }">{{ release.credentials.github ? '已就绪' : '未配置' }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">AI</span>
              <span class="detail-value" :class="{ ok: release.credentials.ai }">{{ release.credentials.ai ? '已就绪' : '可选' }}</span>
            </div>
          </template>

          <!-- Generic: show tool summary if available -->
          <template v-if="step.tool && release.toolResults[step.tool]">
            <div class="detail-row" :class="{ blocked: !release.toolResults[step.tool].ok, ok: release.toolResults[step.tool].ok }">
              <span class="detail-value">{{ release.toolResults[step.tool].summary }}</span>
            </div>
          </template>

          <!-- Step 1: Version list -->
          <template v-if="step.id === 'versionSelection' && release.version">
            <div class="detail-row">
              <span class="detail-label">已选版本</span>
              <span class="detail-value mono ok">v{{ release.version }}</span>
            </div>
          </template>

          <!-- Step 2: Issues detail -->
          <template v-if="step.id === 'jiraIssues' && release.versionIssues.length > 0">
            <div class="detail-issues">
              <div
                v-for="issue in release.versionIssues"
                :key="issue.key"
                class="mini-issue"
                :class="{ done: issue.statusCategory === 'done' }"
              >
                <span class="issue-dot" :class="issue.type.toLowerCase()"></span>
                <button class="issue-link" @click="openUrl(issue.url)">{{ issue.key }}</button>
                <span class="issue-text">{{ issue.summary }}</span>
              </div>
            </div>
          </template>

          <!-- Step 3: PR results detail -->
          <template v-if="step.id === 'prStatus' && release.prCheckResults.length > 0">
            <div
              v-for="pr in release.prCheckResults"
              :key="`${pr.repo}-${pr.prNumber}`"
              class="detail-row"
              :class="{ blocked: !pr.merged }"
            >
              <span class="pr-dot" :class="{ merged: pr.merged }"></span>
              <span class="detail-label">{{ pr.repoKey }}</span>
              <button class="issue-link" @click="openUrl(pr.prUrl)">#{{ pr.prNumber }}</button>
              <span class="detail-value">{{ pr.merged ? 'Merged' : 'Open' }}</span>
            </div>
          </template>

          <!-- Step 4: Preflight detail -->
          <template v-if="step.id === 'preflight' && release.preflightResults.length > 0">
            <div v-for="repo in release.preflightResults" :key="repo.repoKey" class="preflight-mini">
              <div class="preflight-mini-header">{{ repo.repoKey }}</div>
              <div
                v-for="(check, name) in repo.checks"
                :key="name"
                class="detail-row"
                :class="{ blocked: !check.ok }"
              >
                <span class="detail-label">{{ name }}</span>
                <span class="detail-value" :class="{ ok: check.ok }">{{ statusLabel(check.ok) }}</span>
              </div>
            </div>
          </template>

          <template v-if="step.id === 'configChanges' && release.configChanges.length > 0">
            <div v-for="change in release.configChanges" :key="change.repoKey" class="preflight-mini">
              <div class="preflight-mini-header">{{ change.repoKey }}</div>
              <div v-for="file in change.files" :key="file" class="detail-row">
                <span class="detail-value mono">{{ file }}</span>
              </div>
            </div>
          </template>

          <template v-if="step.id === 'i18nArtifacts' && release.i18nArtifacts.length > 0">
            <div v-for="artifact in release.i18nArtifacts" :key="artifact.path || artifact.title" class="detail-row">
              <span class="detail-label">{{ artifact.kind || 'artifact' }}</span>
              <span class="detail-value mono">{{ artifact.path || artifact.title }}</span>
            </div>
          </template>

          <!-- Build detail -->
          <template v-if="(step.id === 'buildVerification' || step.id === 'run_build') && release.buildResults.length > 0">
            <div v-for="build in release.buildResults" :key="build.repoKey">
              <div class="detail-row" :class="{ blocked: !build.ok }">
                <span class="detail-label">{{ build.repoKey }}</span>
                <span class="detail-value" :class="{ ok: build.ok }">{{ statusLabel(build.ok) }}</span>
                <span v-if="build.elapsedMs" class="detail-meta">{{ (build.elapsedMs / 1000).toFixed(1) }}s</span>
                <button v-if="build.stderr || build.stdout" class="log-toggle" @click="expandedBuildLog = expandedBuildLog === build.repoKey ? null : build.repoKey">
                  {{ expandedBuildLog === build.repoKey ? '收起' : '日志' }}
                </button>
              </div>
              <pre v-if="expandedBuildLog === build.repoKey" class="build-log-mini">{{ build.stderr || build.stdout || '(no output)' }}</pre>
            </div>
          </template>

          <template v-if="step.id === 'confluenceDraft' || step.id === 'confluencePublish'">
            <div v-for="artifact in release.releaseArtifacts.filter(item => item.stepId === step.id)" :key="artifact.path || artifact.title" class="detail-row">
              <span class="detail-label">{{ artifact.kind }}</span>
              <span class="detail-value mono">{{ artifact.path || artifact.title }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pipeline-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--glass-border);
  color: var(--text-primary);
  flex-shrink: 0;
}

.panel-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px 0;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.meta-pill.danger {
  color: var(--error);
  border-color: var(--error-border);
  background: color-mix(in srgb, var(--error) 8%, transparent);
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
}

.panel-version {
  margin-left: auto;
  font-size: 11px;
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--accent-primary);
  padding: 2px 8px;
  background: var(--accent-primary-bg);
  border-radius: 3px;
}

.steps-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.step-item {
  position: relative;
}

.step-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  position: relative;
}

.step-row:hover { background: var(--glass-bg-hover); }

.step-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 2px solid var(--glass-border);
  background: transparent;
  position: relative;
  z-index: 1;
  transition: all 0.2s;
}

.step-dot.done {
  border-color: var(--success);
  background: var(--success);
}

.step-dot.active {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
  box-shadow: 0 0 8px var(--accent-glow);
  animation: pulse-dot 1.5s ease-in-out infinite;
}

.step-dot.blocked {
  border-color: var(--error);
  background: var(--error);
  box-shadow: 0 0 8px var(--error-glow);
  animation: pulse-blocked 1.2s ease-in-out infinite;
}

.step-dot.pending {
  border-color: var(--glass-border);
  background: transparent;
}

.step-connector {
  position: absolute;
  left: 20px;
  top: 26px;
  width: 2px;
  height: calc(100% - 10px);
  background: var(--glass-border);
  z-index: 0;
  transition: background 0.2s;
}

.step-item.done .step-connector { background: var(--success-border); }
.step-item.active .step-connector { background: var(--accent-primary-border); }
.step-item.blocked .step-connector { background: var(--error-border); }

/* Step row background tinting for blocked */
.step-item.blocked > .step-row {
  background: var(--error-bg);
}

.step-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  flex: 1;
  transition: color 0.15s;
}

.step-item.active .step-name {
  color: var(--accent-primary);
  font-weight: 600;
}

.step-item.done .step-name {
  color: var(--success);
  font-weight: 500;
}

.step-item.blocked .step-name {
  color: var(--error);
  font-weight: 600;
}

.step-item.pending .step-name {
  color: var(--text-tertiary);
  font-weight: 400;
}

/* Status badge after step name */
.step-item.done .step-name::after {
  content: ' \2713';
  font-size: 10px;
  opacity: 0.7;
}

.step-item.blocked .step-name::after {
  content: ' BLOCKED';
  font-size: 9px;
  font-family: var(--font-mono);
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  margin-left: 6px;
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 3px;
  vertical-align: middle;
}

.step-active-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-primary);
  animation: pulse-dot 1.5s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

@keyframes pulse-blocked {
  0%, 100% { opacity: 1; box-shadow: 0 0 6px var(--error-glow); }
  50% { opacity: 0.7; box-shadow: 0 0 12px var(--error-glow); }
}

.step-chevron {
  color: var(--text-tertiary);
  transition: transform 0.15s;
  flex-shrink: 0;
}

.step-chevron.open { transform: rotate(180deg); }

.step-detail {
  padding: 6px 16px 10px 42px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding: 3px 0;
}

.detail-row.blocked { color: var(--error); }
.detail-row.ok { color: var(--success); }

.detail-label {
  color: var(--text-tertiary);
  min-width: 60px;
}

.detail-value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.detail-value.ok { color: var(--success); }
.detail-value.mono { font-family: var(--font-mono); }

.detail-meta {
  margin-left: auto;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
}

.pr-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--error);
  flex-shrink: 0;
}

.pr-dot.merged { background: var(--success); }

.issue-dot {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  flex-shrink: 0;
}

.issue-dot.bug { background: var(--error); }
.issue-dot.story { background: #8b5cf6; }
.issue-dot.task { background: var(--accent-primary); }
.issue-dot.epic { background: var(--warning); }

.issue-link {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--accent-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
}

.issue-link:hover { text-decoration: underline; }

.issue-text {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.detail-issues {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.mini-issue {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

.mini-issue.done { opacity: 0.45; }

.preflight-mini { margin-bottom: 6px; }
.preflight-mini-header {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  padding: 2px 0;
}

.log-toggle {
  font-size: 10px;
  color: var(--accent-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  margin-left: 6px;
}

.log-toggle:hover { text-decoration: underline; }

.build-log-mini {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 4px 0;
}
</style>
