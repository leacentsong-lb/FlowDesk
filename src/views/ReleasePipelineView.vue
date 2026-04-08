<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useReleaseStore } from '../stores/release'
import { useSettingsStore } from '../stores/settings'
import { useJiraStore } from '../stores/jira'

const release = useReleaseStore()
const settings = useSettingsStore()
const jira = useJiraStore()

const expandedBuildLog = ref(null)
const typewriterText = ref('')
const typewriterDone = ref(false)

onMounted(() => {
  release.checkCredentials()
})

/**
 * Typewriter effect: reveal `fullText` char-by-char into `typewriterText`.
 */
function runTypewriter(fullText, speed = 18) {
  typewriterText.value = ''
  typewriterDone.value = false
  let i = 0
  const tick = () => {
    if (i < fullText.length) {
      typewriterText.value += fullText[i]
      i++
      setTimeout(tick, speed)
    } else {
      typewriterDone.value = true
    }
  }
  tick()
}

// ============================================
// Step handlers
// ============================================
async function handleSelectEnvironment() {
  release.environment = 'production'
  release.checkCredentials()
  if (!release.allCredentialsReady) return
  await release.fetchVersions()
  release.currentStep = 1
}

async function handleSelectVersion(v) {
  release.startSession(v.name)
  await release.fetchVersionIssues()
  release.currentStep = 2
  typewriterText.value = ''
  typewriterDone.value = false
  if (settings.aiConfigured) {
    await release.generateAiSummary()
    if (release.aiSummary) {
      runTypewriter(release.aiSummary)
    }
  }
}

async function handleRunPrCheck() {
  release.currentStep = 3
  await release.runPrCheck()
}

function handleConfirmRepos() {
  const allKeys = release.identifiedRepos.map(r => r.key)
  release.confirmRepos(allKeys)
  release.currentStep = 4
}

async function handleRunPreflight() {
  release.currentStep = 5
  await release.runPreflight()
}

async function handleRunBuild() {
  release.currentStep = 6
  await release.runBuildGate()
}

function handleReset() {
  release.resetSession()
  expandedBuildLog.value = null
  typewriterText.value = ''
  typewriterDone.value = false
}

function navigateToStep(step) {
  if (step < release.currentStep) {
    release.currentStep = step
  }
}

function openUrl(url) {
  if (!url) return
  invoke('open_url_raw', { url })
}

function stepClass(status) {
  return {
    'step-pass': status === release.STEP.PASS,
    'step-blocked': status === release.STEP.BLOCKED,
    'step-running': status === release.STEP.RUNNING,
    'step-warn': status === release.STEP.WARN,
    'step-idle': status === release.STEP.IDLE,
    'step-skipped': status === release.STEP.SKIPPED
  }
}

function statusLabel(status) {
  const map = {
    idle: '--',
    running: 'RUNNING',
    pass: 'PASS',
    blocked: 'BLOCKED',
    warn: 'WARN',
    skipped: 'SKIP'
  }
  return map[status] || status
}
</script>

<template>
  <div class="release-pipeline">
    <!-- Header -->
    <header class="pipeline-header">
      <div class="header-left">
        <h1 class="pipeline-title">Release Pipeline</h1>
        <span v-if="release.version" class="version-badge">v{{ release.version }}</span>
        <span class="env-badge">PRODUCTION</span>
      </div>
      <div class="header-right">
        <span v-if="release.sessionActive" class="pipeline-status-badge" :class="stepClass(release.pipelineStatus)">
          {{ statusLabel(release.pipelineStatus) }}
        </span>
        <button v-if="release.sessionActive" class="reset-btn" @click="handleReset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
          Reset
        </button>
      </div>
    </header>

    <!-- ============================================ -->
    <!-- Completed steps: horizontal progress trail -->
    <!-- ============================================ -->
    <div v-if="release.currentStep > 0" class="progress-trail">
      <button class="trail-chip done" @click="navigateToStep(0)">
        <span class="trail-num">0</span>
        <span class="trail-text">凭证</span>
      </button>
      <span class="trail-connector"></span>

      <template v-if="release.currentStep > 1">
        <button class="trail-chip done" @click="navigateToStep(1)">
          <span class="trail-num">1</span>
          <span class="trail-text mono">v{{ release.version }}</span>
        </button>
        <span class="trail-connector"></span>
      </template>

      <template v-if="release.currentStep > 2">
        <button class="trail-chip done" @click="navigateToStep(2)">
          <span class="trail-num">2</span>
          <span class="trail-text">{{ release.issueStats.total }} issues</span>
        </button>
        <span class="trail-connector"></span>
      </template>

      <template v-if="release.currentStep > 3">
        <button class="trail-chip done" :class="stepClass(release.prCheckStatus)" @click="navigateToStep(3)">
          <span class="trail-num">3</span>
          <span class="trail-text">PR {{ statusLabel(release.prCheckStatus) }}</span>
        </button>
        <span class="trail-connector"></span>
      </template>

      <template v-if="release.currentStep > 5">
        <button class="trail-chip done" :class="stepClass(release.preflightStatus)" @click="navigateToStep(4)">
          <span class="trail-num">4</span>
          <span class="trail-text">预检 {{ statusLabel(release.preflightStatus) }}</span>
        </button>
        <span class="trail-connector"></span>
      </template>

      <div class="trail-chip current">
        <span class="trail-num">{{ release.currentStep <= 1 ? 1 : release.currentStep <= 2 ? 2 : release.currentStep <= 3 ? 3 : release.currentStep <= 5 ? 4 : 5 }}</span>
        <span class="trail-text">{{ release.currentStep <= 1 ? '选择版本' : release.currentStep <= 2 ? '发布预览' : release.currentStep <= 3 ? 'PR 检查' : release.currentStep <= 5 ? '发布预检' : '构建验证' }}</span>
      </div>
    </div>

    <div class="pipeline-body">
      <!-- ============================================ -->
      <!-- Gate 0: Credentials (only when active) -->
      <!-- ============================================ -->
      <section v-if="release.currentStep === 0" class="pipeline-step active">
        <div class="step-indicator">
          <span class="step-number">0</span>
          <span class="step-label">凭证检查</span>
        </div>
        <div class="step-content">
          <div class="cred-grid">
            <div class="cred-item" :class="{ ok: release.credentials.jira }">
              <span class="cred-name">Jira</span>
              <span class="cred-status">{{ release.credentials.jira ? '已就绪' : '未配置' }}</span>
            </div>
            <div class="cred-item" :class="{ ok: release.credentials.github }">
              <span class="cred-name">GitHub</span>
              <span class="cred-status">{{ release.credentials.github ? '已就绪' : '未配置' }}</span>
            </div>
            <div class="cred-item" :class="{ ok: release.credentials.ai }">
              <span class="cred-name">AI</span>
              <span class="cred-status">{{ release.credentials.ai ? '已就绪' : '可选' }}</span>
            </div>
          </div>
          <div v-if="!release.allCredentialsReady" class="step-alert">
            需要先配置 Jira 和 GitHub Token，请前往 Settings 完成配置。
          </div>
          <button
            class="step-action-btn"
            :disabled="!release.allCredentialsReady"
            @click="handleSelectEnvironment"
          >
            凭证已就绪，进入版本选择
          </button>
        </div>
      </section>

      <!-- ============================================ -->
      <!-- Step 1: Version picker -->
      <!-- ============================================ -->
      <section v-if="release.currentStep === 1" class="pipeline-step active">
        <div class="step-indicator">
          <span class="step-number">1</span>
          <span class="step-label">选择发布版本</span>
        </div>
        <div class="step-content">
          <div v-if="release.versionsLoading" class="step-loading">
            <span class="spinner"></span> Loading versions...
          </div>
          <div v-else-if="release.versionsError" class="step-alert">{{ release.versionsError }}</div>
          <div v-else class="version-list">
            <button
              v-for="v in release.versions"
              :key="v.id"
              class="version-item"
              @click="handleSelectVersion(v)"
            >
              <span class="version-name">{{ v.name }}</span>
              <span v-if="v.releaseDate" class="version-date">{{ v.releaseDate }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- ============================================ -->
      <!-- Step 2: Release preview (Jira issues) -->
      <!-- ============================================ -->
      <section v-if="release.currentStep === 2" class="pipeline-step active">
        <div class="step-indicator">
          <span class="step-number">2</span>
          <span class="step-label">发布预览</span>
        </div>
        <div class="step-content">
          <div v-if="release.versionIssuesLoading" class="step-loading">
            <span class="spinner"></span> 正在加载版本 issue...
          </div>
          <div v-else-if="release.versionIssuesError" class="step-alert">{{ release.versionIssuesError }}</div>
          <template v-else>
            <!-- AI Summary -->
            <div v-if="release.aiSummaryLoading || typewriterText" class="ai-summary-card">
              <div class="ai-summary-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/></svg>
                <span class="ai-summary-label">AI 发布摘要</span>
                <span v-if="release.aiSummaryLoading" class="spinner-sm"></span>
              </div>
              <div class="ai-summary-body">
                <span v-if="release.aiSummaryLoading && !typewriterText" class="ai-thinking">正在分析 issue 列表...</span>
                <span v-else class="ai-typewriter">{{ typewriterText }}<span v-if="!typewriterDone" class="cursor-blink">|</span></span>
              </div>
            </div>
            <div v-if="release.aiSummaryError" class="step-alert">AI: {{ release.aiSummaryError }}</div>

            <div class="issue-stats-bar">
              <span class="stat">总计 <strong>{{ release.issueStats.total }}</strong></span>
              <span class="stat done">已完成 <strong>{{ release.issueStats.done }}</strong></span>
              <span class="stat progress">进行中 <strong>{{ release.issueStats.inProgress }}</strong></span>
              <span class="stat todo">待处理 <strong>{{ release.issueStats.todo }}</strong></span>
            </div>
            <div class="issue-table">
              <div
                v-for="issue in release.versionIssues"
                :key="issue.key"
                class="issue-row"
                :class="{ 'is-done': issue.statusCategory === 'done' }"
              >
                <span class="issue-type-dot" :class="issue.type.toLowerCase()"></span>
                <button class="issue-key-link" @click="openUrl(issue.url)">{{ issue.key }}</button>
                <span class="issue-summary">{{ issue.summary }}</span>
                <span class="issue-status-tag" :class="issue.statusCategory">{{ issue.status }}</span>
                <span class="issue-assignee">{{ issue.assignee || '--' }}</span>
              </div>
            </div>
            <button class="step-action-btn" @click="handleRunPrCheck">检查是否存在未合并的 PR</button>
          </template>
        </div>
      </section>

      <!-- ============================================ -->
      <!-- Step 3: PR Check -->
      <!-- ============================================ -->
      <section v-if="release.currentStep === 3" class="pipeline-step active">
        <div class="step-indicator">
          <span class="step-number">3</span>
          <span class="step-label">PR 合并状态检查</span>
          <span class="step-status-tag" :class="stepClass(release.prCheckStatus)">{{ statusLabel(release.prCheckStatus) }}</span>
        </div>
        <div class="step-content">
          <div v-if="release.prCheckLoading" class="step-loading">
            <span class="spinner"></span> 正在扫描各仓库的 PR 状态...
          </div>
          <div v-else-if="release.prCheckError" class="step-alert">{{ release.prCheckError }}</div>
          <template v-else-if="release.prCheckResults.length > 0">
            <div v-if="release.unmergedPrs.length > 0" class="step-alert blocked">
              发现 {{ release.unmergedPrs.length }} 个未合并的 PR，发布已阻塞，请先完成合并后重试。
            </div>
            <div class="pr-table">
              <div
                v-for="pr in release.prCheckResults"
                :key="`${pr.repo}-${pr.prNumber}`"
                class="pr-row"
                :class="{ unmerged: !pr.merged }"
              >
                <span class="pr-merged-dot" :class="{ merged: pr.merged }"></span>
                <span class="pr-repo">{{ pr.repoKey }}</span>
                <button class="pr-link" @click="openUrl(pr.prUrl)">#{{ pr.prNumber }}</button>
                <span class="pr-title">{{ pr.prTitle }}</span>
                <span class="pr-branch">{{ pr.headBranch }} -> {{ pr.baseBranch }}</span>
                <span class="pr-issues">{{ pr.issueKeys.join(', ') }}</span>
              </div>
            </div>
            <div v-if="release.prCheckStatus === release.STEP.PASS" class="step-actions">
              <div class="repo-confirm-section">
                <h4 class="confirm-heading">识别到的发布仓库 ({{ release.identifiedRepos.length }})</h4>
                <div class="repo-chips">
                  <span v-for="r in release.identifiedRepos" :key="r.key" class="repo-chip">
                    {{ r.key }}
                    <span class="repo-chip-count">{{ r.prs.length }} PR(s)</span>
                  </span>
                </div>
              </div>
              <button class="step-action-btn" @click="handleConfirmRepos">确认仓库列表，进入发布预检</button>
            </div>
          </template>
          <div v-else-if="!release.prCheckLoading" class="step-empty">
            未找到与版本 issue 匹配的 PR。
          </div>
        </div>
      </section>

      <!-- ============================================ -->
      <!-- Step 4-5: Preflight -->
      <!-- ============================================ -->
      <section v-if="release.currentStep >= 4 && release.currentStep <= 5" class="pipeline-step active">
        <div class="step-indicator">
          <span class="step-number">4</span>
          <span class="step-label">发布预检</span>
          <span class="step-status-tag" :class="stepClass(release.preflightStatus)">{{ statusLabel(release.preflightStatus) }}</span>
        </div>
        <div class="step-content">
          <button
            v-if="release.currentStep === 4 && release.preflightResults.length === 0"
            class="step-action-btn"
            @click="handleRunPreflight"
          >
            运行预检：分支 / 版本号 / 冲突检查
          </button>
          <div v-if="release.preflightLoading" class="step-loading">
            <span class="spinner"></span> 正在检查各仓库的分支、版本号和合并冲突...
          </div>
          <template v-else-if="release.preflightResults.length > 0">
            <div
              v-for="repo in release.preflightResults"
              :key="repo.repoKey"
              class="preflight-repo-card"
            >
              <div class="preflight-repo-header">
                <span class="preflight-repo-name">{{ repo.repoKey }}</span>
                <span class="preflight-repo-path mono">{{ repo.repo }}</span>
              </div>
              <div class="preflight-checks">
                <div
                  v-for="(check, checkName) in repo.checks"
                  :key="checkName"
                  class="preflight-check-row"
                  :class="stepClass(check.status)"
                >
                  <span class="check-name">{{ checkName }}</span>
                  <span class="check-status">{{ statusLabel(check.status) }}</span>
                  <span class="check-detail">{{ check.detail }}</span>
                </div>
              </div>
            </div>
            <button
              v-if="release.preflightStatus === release.STEP.PASS && release.currentStep === 5"
              class="step-action-btn"
              @click="handleRunBuild"
            >
              预检通过，开始执行构建验证 (pnpm run build)
            </button>
          </template>
        </div>
      </section>

      <!-- ============================================ -->
      <!-- Step 6: Build gate -->
      <!-- ============================================ -->
      <section v-if="release.currentStep >= 6" class="pipeline-step" :class="{ active: release.currentStep === 6 }">
        <div class="step-indicator">
          <span class="step-number">5</span>
          <span class="step-label">构建验证</span>
          <span class="step-status-tag" :class="stepClass(release.buildStatus)">{{ statusLabel(release.buildStatus) }}</span>
        </div>
        <div class="step-content">
          <div v-if="release.buildLoading" class="step-loading">
            <span class="spinner"></span> 正在构建，请稍候...
          </div>
          <template v-if="release.buildResults.length > 0">
            <div
              v-for="build in release.buildResults"
              :key="build.repoKey"
              class="build-card"
              :class="stepClass(build.status)"
            >
              <div class="build-card-header">
                <span class="build-repo-name">{{ build.repoKey }}</span>
                <span class="build-status-tag" :class="stepClass(build.status)">{{ statusLabel(build.status) }}</span>
                <span v-if="build.result" class="build-time">{{ (build.result.elapsedMs / 1000).toFixed(1) }}s</span>
                <button
                  v-if="build.result"
                  class="build-log-toggle"
                  @click="expandedBuildLog = expandedBuildLog === build.repoKey ? null : build.repoKey"
                >
                  {{ expandedBuildLog === build.repoKey ? 'Hide Log' : 'Show Log' }}
                </button>
              </div>
              <pre
                v-if="expandedBuildLog === build.repoKey && build.result"
                class="build-log"
              >{{ build.result.stderr || build.result.stdout || '(no output)' }}</pre>
            </div>
          </template>
        </div>
      </section>

      <!-- ============================================ -->
      <!-- Final: Conclusion -->
      <!-- ============================================ -->
      <section v-if="release.pipelineStatus === release.STEP.PASS" class="pipeline-step conclusion-step">
        <div class="step-indicator">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <span class="step-label conclusion-label">所有检查通过，可以发布</span>
        </div>
        <div class="step-content">
          <p class="conclusion-text">
            <strong>v{{ release.version }}</strong> 全部检查通过，共 {{ release.confirmedRepos.length }} 个仓库已验证。
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.release-pipeline {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ============================================ */
/* Header */
/* ============================================ */
.pipeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pipeline-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.01em;
}

.version-badge {
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border: 1px solid var(--accent-primary-border);
  border-radius: 4px;
}

.env-badge {
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  text-transform: uppercase;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pipeline-status-badge {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  border-radius: 4px;
  font-family: var(--font-mono);
}

.reset-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.reset-btn:hover {
  color: var(--text-primary);
  border-color: var(--glass-border-strong);
}

/* ============================================ */
/* Pipeline body — scrollable */
/* ============================================ */
.pipeline-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 20px 100px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ============================================ */
/* Step card */
/* ============================================ */
.pipeline-step {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color 0.2s;
}

.pipeline-step.active {
  border-color: var(--accent-primary-border);
}

/* ============================================ */
/* Progress trail — completed steps as chips */
/* ============================================ */
.progress-trail {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
  padding: 10px 20px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.trail-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 4px;
  white-space: nowrap;
  transition: all 0.15s;
}

.trail-chip.done {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  cursor: pointer;
}

.trail-chip.done:hover {
  background: var(--glass-bg-hover);
  border-color: var(--glass-border-strong);
}

.trail-chip.done.step-pass {
  border-color: var(--success-border);
  color: var(--success);
}

.trail-chip.done.step-blocked {
  border-color: var(--error-border);
  color: var(--error);
}

.trail-chip.current {
  background: var(--accent-primary-bg);
  border: 1px solid var(--accent-primary);
  color: var(--accent-primary);
  font-weight: 600;
}

.trail-num {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  font-family: var(--font-mono);
  border: 1px solid currentColor;
  border-radius: 3px;
  opacity: 0.6;
  flex-shrink: 0;
}

.trail-text {
  font-family: var(--font-mono);
  font-weight: 500;
}

.trail-connector {
  width: 16px;
  height: 1px;
  background: var(--glass-border);
  flex-shrink: 0;
}

/* ============================================ */
/* AI summary card + typewriter */
/* ============================================ */
.ai-summary-card {
  margin-bottom: 12px;
  border: 1px solid var(--accent-primary-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.ai-summary-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  background: var(--accent-primary-bg);
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 600;
}

.ai-summary-label { flex: 1; }

.spinner-sm {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--glass-border);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.ai-summary-body {
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
}

.ai-thinking {
  color: var(--text-tertiary);
  font-style: italic;
}

.ai-typewriter {
  white-space: pre-wrap;
}

.cursor-blink {
  display: inline;
  font-weight: 300;
  color: var(--accent-primary);
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.step-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--glass-bg);
}

.step-number {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: 3px;
  flex-shrink: 0;
}

.step-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.step-status-tag {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
  border-radius: 3px;
}

.step-content {
  padding: 12px 14px;
}

/* ============================================ */
/* Status colors */
/* ============================================ */
.step-pass, .step-pass .step-status-tag { color: var(--success); background: var(--success-bg); border-color: var(--success-border); }
.step-blocked, .step-blocked .step-status-tag { color: var(--error); background: var(--error-bg); border-color: var(--error-border); }
.step-running, .step-running .step-status-tag { color: var(--accent-primary); background: var(--accent-primary-bg); border-color: var(--accent-primary-border); }
.step-warn { color: var(--warning); }
.step-idle { color: var(--text-tertiary); }
.step-skipped { color: var(--text-tertiary); opacity: 0.6; }

/* Override: status tag should not inherit parent card bg */
.step-status-tag.step-pass { background: var(--success-bg); }
.step-status-tag.step-blocked { background: var(--error-bg); }
.step-status-tag.step-running { background: var(--accent-primary-bg); }
.step-status-tag.step-idle { background: var(--glass-bg); }

/* Badge in header */
.pipeline-status-badge.step-pass { color: var(--success); background: var(--success-bg); border: 1px solid var(--success-border); }
.pipeline-status-badge.step-blocked { color: var(--error); background: var(--error-bg); border: 1px solid var(--error-border); }
.pipeline-status-badge.step-running { color: var(--accent-primary); background: var(--accent-primary-bg); border: 1px solid var(--accent-primary-border); }

/* ============================================ */
/* Common elements */
/* ============================================ */
.step-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 8px 0;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--glass-border);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.step-alert {
  padding: 7px 12px;
  font-size: 11px;
  color: var(--warning);
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
}

.step-alert.blocked {
  color: var(--error);
  background: var(--error-bg);
  border-color: var(--error-border);
}

.step-empty {
  font-size: 13px;
  color: var(--text-tertiary);
  padding: 12px 0;
}

.step-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.step-action-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.step-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mono { font-family: var(--font-mono); }

/* ============================================ */
/* Credentials */
/* ============================================ */
.cred-grid {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.cred-item {
  flex: 1;
  padding: 7px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: border-color 0.2s;
}

.cred-item.ok {
  border-color: var(--success-border);
}

.cred-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.cred-status {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
}

.cred-item.ok .cred-status {
  color: var(--success);
}

/* ============================================ */
/* Version list */
/* ============================================ */
.version-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.version-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  width: 100%;
}

.version-item:hover:not(:disabled) {
  background: var(--glass-bg-hover);
  border-color: var(--accent-primary-border);
}

.version-item.selected {
  border-color: var(--accent-primary);
  background: var(--accent-primary-bg);
}

.version-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.version-name {
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.version-released-tag {
  font-size: 10px;
  color: var(--text-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: 3px;
  padding: 1px 6px;
}

.version-date {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-left: auto;
}

/* ============================================ */
/* Issue table */
/* ============================================ */
.issue-stats-bar {
  display: flex;
  gap: 14px;
  margin-bottom: 10px;
  padding: 7px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
}

.stat {
  font-size: 12px;
  color: var(--text-secondary);
}

.stat strong {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.stat.done strong { color: var(--success); }
.stat.progress strong { color: var(--accent-primary); }
.stat.todo strong { color: var(--warning); }

.issue-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.issue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  transition: background 0.1s;
}

.issue-row:hover {
  background: var(--glass-bg-hover);
}

.issue-row.is-done {
  opacity: 0.55;
}

.issue-type-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.issue-type-dot.bug { background: var(--error); }
.issue-type-dot.story { background: #8b5cf6; }
.issue-type-dot.task { background: var(--accent-primary); }
.issue-type-dot.epic { background: var(--warning); }
.issue-type-dot.sub-task { background: var(--text-tertiary); }
.issue-type-dot.subtask { background: var(--text-tertiary); }

.issue-key-link {
  font-size: 12px;
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--accent-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
}

.issue-key-link:hover {
  text-decoration: underline;
}

.issue-summary {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-status-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 3px;
  white-space: nowrap;
}

.issue-status-tag.done { color: var(--success); background: var(--success-bg); }
.issue-status-tag.indeterminate { color: var(--accent-primary); background: var(--accent-primary-bg); }
.issue-status-tag.new { color: var(--text-tertiary); background: var(--glass-bg); }

.issue-assignee {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ============================================ */
/* PR table */
/* ============================================ */
.pr-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.pr-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  transition: background 0.1s;
}

.pr-row:hover { background: var(--glass-bg-hover); }
.pr-row.unmerged { background: var(--error-bg); border: 1px solid var(--error-border); }

.pr-merged-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--error);
  flex-shrink: 0;
}

.pr-merged-dot.merged { background: var(--success); }

.pr-repo {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 60px;
}

.pr-link {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--accent-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}

.pr-link:hover { text-decoration: underline; }

.pr-title {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr-branch {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.pr-issues {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--accent-warm);
  white-space: nowrap;
}

/* ============================================ */
/* Repo confirm */
/* ============================================ */
.step-actions { margin-top: 14px; }

.confirm-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 10px 0;
}

.repo-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.repo-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
}

.repo-chip-count {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-tertiary);
}

/* ============================================ */
/* Preflight cards */
/* ============================================ */
.preflight-repo-card {
  margin-bottom: 6px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.preflight-repo-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--glass-border);
}

.preflight-repo-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.preflight-repo-path {
  font-size: 11px;
  color: var(--text-tertiary);
}

.preflight-checks {
  padding: 4px 12px;
}

.preflight-check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid var(--glass-border);
}

.preflight-check-row:last-child { border-bottom: none; }

.check-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 120px;
  text-transform: capitalize;
}

.check-status {
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  min-width: 60px;
}

.check-detail {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============================================ */
/* Build cards */
/* ============================================ */
.build-card {
  margin-bottom: 6px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.build-card.step-pass { border-color: var(--success-border); }
.build-card.step-blocked { border-color: var(--error-border); }

.build-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--glass-bg);
}

.build-repo-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.build-status-tag {
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  padding: 2px 8px;
  border-radius: 3px;
}

.build-time {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  margin-left: auto;
}

.build-log-toggle {
  font-size: 11px;
  color: var(--accent-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}

.build-log-toggle:hover { text-decoration: underline; }

.build-log {
  padding: 12px 14px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  background: var(--bg-gradient-start);
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  border-top: 1px solid var(--glass-border);
}

/* ============================================ */
/* Conclusion */
/* ============================================ */
.conclusion-step {
  border-color: var(--success-border);
  background: var(--success-bg);
}

.conclusion-step .step-indicator {
  background: transparent;
  border-bottom-color: var(--success-border);
}

.conclusion-step .step-indicator svg {
  color: var(--success);
}

.conclusion-label {
  color: var(--success);
  font-weight: 700;
}

.conclusion-text {
  font-size: 14px;
  color: var(--text-primary);
  margin: 0;
}

.conclusion-text strong {
  font-family: var(--font-mono);
  color: var(--success);
}
</style>
