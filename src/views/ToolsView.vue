<script setup>
import { computed, onMounted, ref } from 'vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useToolsStore } from '../stores/tools'

const tools = useToolsStore()
const keyword = ref('')
const currentTool = ref('')

const filteredSkills = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return tools.discoveredSkills

  return tools.discoveredSkills.filter(skill => {
    const haystack = [
      skill.name,
      skill.title,
      skill.description,
      skill.skillPath,
      skill.rootPath
    ].join('\n').toLowerCase()

    return haystack.includes(query)
  })
})

const allFilteredDiscoveredSkillsSelected = computed(() => (
  filteredSkills.value.length > 0 && filteredSkills.value.every(skill => tools.selectedDiscoveredSkillIds.includes(skill.id))
))

const filteredLibrarySkills = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return tools.librarySkills

  return tools.librarySkills.filter(skill => {
    const haystack = [
      skill.name,
      skill.title,
      skill.description,
      skill.canonicalPath,
      skill.sourcePath
    ].join('\n').toLowerCase()

    return haystack.includes(query)
  })
})

const filteredAppSkills = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return tools.appSkills

  return tools.appSkills.filter(skill => {
    const haystack = [
      skill.name,
      skill.title,
      skill.description,
      skill.summary,
      skill.synopsis
    ].join('\n').toLowerCase()

    return haystack.includes(query)
  })
})

const filteredAppTools = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return tools.appTools

  return tools.appTools.filter(tool => {
    const haystack = [
      tool.name,
      tool.label,
      tool.description,
      ...(tool.tags || [])
    ].join('\n').toLowerCase()

    return haystack.includes(query)
  })
})

async function handleAddRoot() {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: '选择要扫描的 Skill 根目录'
  })

  if (typeof selected === 'string' && selected.trim()) {
    const added = await tools.addScanRoot(selected)
    if (added) {
      await tools.refreshSkills()
    }
  }
}

async function handleSelectSkill(skill) {
  await tools.selectSkill(skill)
}

async function handleSave() {
  await tools.saveSelectedSkill(tools.selectedContent)
}

async function handleDelete() {
  if (!tools.selectedSkill) return
  if (!window.confirm(`确认删除 skill "${tools.selectedSkill.title || tools.selectedSkill.name}" 吗？`)) {
    return
  }

  await tools.deleteSkill(tools.selectedSkill)
}

async function handleImportToApp() {
  if (!tools.selectedSkill) return
  await tools.importDiscoveredSkillToLibrary(tools.selectedSkill)
  currentTool.value = 'library'
}

async function handleBulkImportToLibrary() {
  await tools.importSelectedDiscoveredSkillsToLibrary()
}

function handleToggleDiscoverSelection(skill) {
  tools.toggleDiscoveredSkillSelection(skill)
}

function handleToggleAllDiscoverSelections() {
  tools.toggleAllDiscoveredSkills(filteredSkills.value)
}

async function handleCreateAppSkill() {
  await tools.createAppSkill()
}

async function handleSaveAppSkill() {
  await tools.saveSelectedAppSkill()
}

async function handleDeleteAppSkill() {
  await tools.deleteSelectedAppSkill()
}

async function handleCopyAppSkillToWorkspace() {
  await tools.copyAppSkillToWorkspace()
}

async function handleInstallLibrarySkillToSelectedDirectory() {
  if (!tools.selectedLibrarySkill?.name) return
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: '选择目标工作区目录'
  })
  if (typeof selected !== 'string' || !selected.trim()) return
  await tools.installLibrarySkillToApp(tools.selectedLibrarySkill.name, 'workspace', selected)
}

onMounted(async () => {
  await tools.loadScanRoots()
  await tools.migrateLegacyAppSkillOverrides()
  if (tools.discoveredSkills.length === 0) {
    await tools.discoverSkills()
  }
  await tools.loadLibrarySkills()
  await tools.refreshAppSkillRegistry()
  tools.refreshAppToolRegistry()
})

function openTool(toolId) {
  keyword.value = ''
  currentTool.value = toolId
}

function goBackToMenu() {
  currentTool.value = ''
}
</script>

<template>
  <div class="tools-view">
    <template v-if="!currentTool">
      <div class="tools-header">
        <div>
          <h2>Tools</h2>
          <p>统一管理全局规则、skills 和分发工具。</p>
        </div>
      </div>

      <div class="tool-menu-grid" data-testid="tools-menu-grid">
        <button class="tool-menu-card active" data-testid="tools-menu-discover" @click="openTool('discover')">
          <div class="tool-menu-icon">🧩</div>
          <div class="tool-menu-title">Discover</div>
          <div class="tool-menu-desc">扫描电脑里的散落 skills，并导入到 flow-desk 中央技能库。</div>
        </button>
        <button class="tool-menu-card" data-testid="tools-menu-library" @click="openTool('library')">
          <div class="tool-menu-icon">📚</div>
          <div class="tool-menu-title">Central Library</div>
          <div class="tool-menu-desc">统一管理 flow-desk 收编后的 canonical skills，并安装到 App。</div>
        </button>
        <button class="tool-menu-card" data-testid="tools-menu-app-skills" @click="openTool('app-skills')">
          <div class="tool-menu-icon">🤖</div>
          <div class="tool-menu-title">App Skills</div>
          <div class="tool-menu-desc">查看当前 flow-desk Agent 实际可加载的 skills 与来源。</div>
        </button>
        <button class="tool-menu-card" data-testid="tools-menu-app-tools" @click="openTool('app-tools')">
          <div class="tool-menu-icon">🛠️</div>
          <div class="tool-menu-title">App 内置 Tools</div>
          <div class="tool-menu-desc">编辑桌面 App 暴露给 AI chat 的 tool 描述、显示名和开关。</div>
        </button>
      </div>
    </template>

    <template v-else-if="currentTool === 'discover'">
      <div class="tools-header">
        <div>
          <button class="back-link-btn" @click="goBackToMenu">← 返回 Tools</button>
          <h2>Discover</h2>
          <p>扫描电脑里的 skills，先导入到 Central Library，再按需安装到当前 App。</p>
        </div>
        <div class="tools-header-actions discover-actions">
          <button
            class="secondary-btn discover-action-btn"
            :disabled="tools.scanRoots.length >= tools.maxScanRoots"
            @click="handleAddRoot"
          >
            新增扫描目录
          </button>
          <button
            data-testid="discover-select-all-btn"
            class="secondary-btn discover-action-btn"
            :disabled="filteredSkills.length === 0"
            @click="handleToggleAllDiscoverSelections"
          >
            {{ allFilteredDiscoveredSkillsSelected ? '取消全选' : '全选' }}
          </button>
          <button
            data-testid="discover-bulk-import-btn"
            class="secondary-btn discover-action-btn discover-bulk-btn"
            :disabled="tools.selectedDiscoveredSkillCount === 0 || tools.saving"
            @click="handleBulkImportToLibrary"
          >
            {{ tools.saving ? '导入中...' : '导入已选到 Central Library' }}
          </button>
          <button
            class="primary-btn discover-refresh-btn"
            :disabled="tools.loading"
            @click="tools.discoverSkills()"
          >
            {{ tools.loading ? '扫描中...' : '重新扫描' }}
          </button>
        </div>
      </div>

      <div class="scan-root-card">
        <div class="section-title">扫描目录</div>
        <div class="scan-root-limit-tip">最多 {{ tools.maxScanRoots }} 个目录，避免全盘扫描拖慢桌面 App。</div>
        <div class="scan-root-list">
          <span
            v-for="root in tools.scanRoots"
            :key="root"
            class="scan-root-chip"
          >
            <span>{{ root }}</span>
            <button class="chip-remove-btn" @click="tools.removeScanRoot(root)">✕</button>
          </span>
        </div>
      </div>

      <div class="tools-layout">
      <section class="skills-list-panel glass-card">
        <div class="panel-header">
          <div>
            <h3>已发现 Skills</h3>
            <span class="panel-meta">{{ tools.skillCount }} 项</span>
          </div>
          <input
            v-model="keyword"
            class="filter-input"
            type="text"
            placeholder="搜索 name / 描述 / 路径"
          />
        </div>

        <div v-if="tools.error" class="panel-error">{{ tools.error }}</div>
        <div v-if="tools.selectedDiscoveredSkillCount > 0" class="panel-meta discover-selection-meta">
          已选择 {{ tools.selectedDiscoveredSkillCount }} 项
        </div>

        <div v-if="filteredSkills.length === 0" class="empty-state">
          暂无 skill。请先扫描目录。
        </div>

        <div v-else class="skills-list">
          <button
            v-for="skill in filteredSkills"
            :key="skill.id"
            class="skill-row"
            :class="{ active: tools.selectedSkill?.id === skill.id }"
            @click="handleSelectSkill(skill)"
          >
            <label class="discover-checkbox-row" @click.stop>
              <input
                :checked="tools.selectedDiscoveredSkillIds.includes(skill.id)"
                type="checkbox"
                @change="handleToggleDiscoverSelection(skill)"
              >
              <span>选中</span>
            </label>
            <div class="skill-row-title">{{ skill.title || skill.name }}</div>
            <div class="skill-row-name">{{ skill.name }}</div>
            <div v-if="skill.description" class="skill-row-desc">{{ skill.description }}</div>
            <div class="skill-row-path">{{ skill.skillPath }}</div>
          </button>
        </div>
      </section>

      <section class="skill-detail-panel glass-card">
        <template v-if="tools.selectedSkill">
          <div class="panel-header">
            <div>
              <h3>{{ tools.selectedSkill.title || tools.selectedSkill.name }}</h3>
              <div class="panel-meta">{{ tools.selectedSkill.skillPath }}</div>
            </div>
            <div class="detail-actions">
              <button class="secondary-btn" :disabled="tools.saving" @click="handleSave">
                {{ tools.saving ? '保存中...' : '保存' }}
              </button>
              <button class="primary-btn" :disabled="tools.saving" @click="handleImportToApp">
                {{ tools.saving ? '导入中...' : '导入到 Central Library' }}
              </button>
              <button class="danger-btn" :disabled="tools.deleting" @click="handleDelete">
                {{ tools.deleting ? '删除中...' : '删除' }}
              </button>
            </div>
          </div>

          <div class="detail-meta-grid">
            <div>
              <label>Name</label>
              <div>{{ tools.selectedSkill.name }}</div>
            </div>
            <div>
              <label>Root</label>
              <div>{{ tools.selectedSkill.rootPath }}</div>
            </div>
            <div>
              <label>Files</label>
              <div>{{ (tools.selectedSkill.files || []).join(', ') || 'SKILL.md' }}</div>
            </div>
          </div>

          <textarea
            v-model="tools.selectedContent"
            class="skill-editor"
            spellcheck="false"
          />
        </template>

        <div v-else class="empty-state detail-empty">
          选择左侧一个 skill 后可查看和编辑。
        </div>
      </section>
      </div>
    </template>

    <template v-else-if="currentTool === 'library'">
      <div class="tools-header">
        <div>
          <button class="back-link-btn" @click="goBackToMenu">← 返回 Tools</button>
          <h2>Central Library</h2>
          <p>这里是 flow-desk 收编后的中央技能库，可统一安装到当前 App。</p>
        </div>
        <div class="tools-header-actions">
          <button class="primary-btn" :disabled="tools.loading" @click="tools.loadLibrarySkills()">
            {{ tools.loading ? '刷新中...' : '刷新中央库' }}
          </button>
        </div>
      </div>

      <div v-if="tools.appStatusMessage" class="scan-root-card">
        {{ tools.appStatusMessage }}
      </div>

      <div class="tools-layout">
        <section class="skills-list-panel glass-card">
          <div class="panel-header">
            <div>
              <h3>Central Library</h3>
              <span class="panel-meta">{{ tools.librarySkills.length }} 项</span>
            </div>
            <input
              v-model="keyword"
              class="filter-input"
              type="text"
              placeholder="搜索中央库 skill"
            />
          </div>

          <div v-if="filteredLibrarySkills.length === 0" class="empty-state">
            暂无已收编 skills。请先从 Discover 导入。
          </div>

          <div v-else class="skills-list">
            <button
              v-for="skill in filteredLibrarySkills"
              :key="skill.name"
              class="skill-row"
              :class="{ active: tools.selectedLibrarySkill?.name === skill.name }"
              @click="tools.selectLibrarySkill(skill)"
            >
              <div class="skill-row-title">{{ skill.title || skill.name }}</div>
              <div class="skill-row-name">{{ skill.name }}</div>
              <div v-if="skill.description" class="skill-row-desc">{{ skill.description }}</div>
              <div v-if="(skill.installTargets || []).length > 0" class="skill-row-install-meta">
                已安装 {{ skill.installTargets.length }} 处
              </div>
              <div class="skill-row-path">{{ skill.canonicalPath }}</div>
            </button>
          </div>
        </section>

        <section class="skill-detail-panel glass-card">
          <template v-if="tools.selectedLibrarySkill">
            <div class="panel-header">
              <div>
                <h3>{{ tools.selectedLibrarySkill.title || tools.selectedLibrarySkill.name }}</h3>
                <div class="panel-meta">{{ tools.selectedLibrarySkill.name }}</div>
              </div>
              <div class="detail-actions">
                <button class="secondary-btn" @click="tools.installLibrarySkillToApp(tools.selectedLibrarySkill.name, 'global')">安装到全局 App</button>
                <button class="primary-btn" @click="tools.installLibrarySkillToApp(tools.selectedLibrarySkill.name, 'workspace')">安装到当前工作区</button>
                <button
                  data-testid="library-install-custom-dir-btn"
                  class="secondary-btn"
                  @click="handleInstallLibrarySkillToSelectedDirectory"
                >
                  安装到指定目录
                </button>
                <button class="secondary-btn" @click="tools.uninstallLibrarySkillFromApp(tools.selectedLibrarySkill.name, 'global')">从全局 App 卸载</button>
                <button class="danger-btn" @click="tools.uninstallLibrarySkillFromApp(tools.selectedLibrarySkill.name, 'workspace')">从当前工作区卸载</button>
              </div>
            </div>

            <div class="detail-meta-grid">
              <div class="detail-meta-span-2">
                <label>Canonical Path</label>
                <div>{{ tools.selectedLibrarySkill.canonicalPath }}</div>
              </div>
              <div class="detail-meta-span-2">
                <label>Original Source</label>
                <div>{{ tools.selectedLibrarySkill.sourcePath || '—' }}</div>
              </div>
              <div class="detail-meta-span-2">
                <label>安装状态</label>
                <div>
                  <template v-if="(tools.selectedLibrarySkill.installTargets || []).length > 0">
                    已安装 {{ tools.selectedLibrarySkill.installTargets.length }} 处
                  </template>
                  <template v-else>
                    未安装
                  </template>
                </div>
              </div>
              <div v-if="(tools.selectedLibrarySkill.installTargets || []).length > 0" class="detail-meta-span-2">
                <label>Installed Targets</label>
                <div class="library-install-targets">
                  <div
                    v-for="target in tools.selectedLibrarySkill.installTargets"
                    :key="`${target.scope}-${target.installedPath}`"
                    class="library-install-target"
                  >
                    <strong>{{ target.scope }}</strong>
                    <span>{{ target.installedPath }}</span>
                    <span class="library-install-link-type">{{ target.linkType }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <div v-else class="empty-state detail-empty">
            选择一个中央库 skill 后可安装到 App。
          </div>
        </section>
      </div>
    </template>

    <template v-else-if="currentTool === 'app-skills'">
      <div class="tools-header">
        <div>
          <button class="back-link-btn" @click="goBackToMenu">← 返回 Tools</button>
          <h2>App Skills</h2>
          <p>这里展示当前 flow-desk Agent 实际可加载的 skills，以及它们来自哪里。</p>
        </div>
        <div class="tools-header-actions">
          <button
            data-testid="app-skill-create-btn"
            class="primary-btn app-skill-create-btn"
            @click="handleCreateAppSkill"
          >
            新增 Skill
          </button>
        </div>
      </div>

      <div v-if="tools.appStatusMessage" class="scan-root-card">
        {{ tools.appStatusMessage }}
      </div>

      <div class="tools-layout">
        <section class="skills-list-panel glass-card">
          <div class="panel-header">
            <div>
              <h3>App Skills</h3>
              <span class="panel-meta">{{ tools.appSkills.length }} 项</span>
            </div>
            <input
              v-model="keyword"
              class="filter-input"
              type="text"
              placeholder="搜索内置 skill"
            />
          </div>

          <div class="skills-list">
            <button
              v-for="skill in filteredAppSkills"
              :key="skill.name"
              class="skill-row"
              :class="{ active: tools.selectedAppSkill?.name === skill.name }"
              @click="tools.selectAppSkill(skill)"
            >
              <div class="skill-row-title">{{ skill.title || skill.name }}</div>
              <div class="skill-row-name">{{ skill.name }}</div>
              <div v-if="skill.description" class="skill-row-desc">{{ skill.description }}</div>
              <div v-if="skill.synopsis" class="skill-row-summary">{{ skill.synopsis }}</div>
              <div class="skill-row-path">
                {{ skill.sourceType || 'unknown' }} · {{ skill.writable ? '可编辑' : '只读' }} · {{ skill.enabled ? '已启用' : '已隐藏' }}
              </div>
            </button>
          </div>
        </section>

        <section class="skill-detail-panel glass-card">
          <template v-if="tools.selectedAppSkill">
            <div class="panel-header">
              <div>
                <h3>{{ tools.selectedAppSkill.title || tools.selectedAppSkill.name }}</h3>
                <div class="panel-meta">{{ tools.selectedAppSkill.effectivePath || tools.selectedAppSkill.name }}</div>
              </div>
              <div class="detail-actions">
                <button
                  v-if="tools.selectedAppSkill.writable"
                  class="danger-btn"
                  @click="handleDeleteAppSkill"
                >
                  删除 Skill
                </button>
                <button
                  v-else
                  class="secondary-btn"
                  @click="handleCopyAppSkillToWorkspace"
                >
                  复制到工作区后编辑
                </button>
                <button
                  v-if="tools.selectedAppSkill.writable"
                  class="secondary-btn"
                  @click="tools.resetSelectedAppSkill()"
                >
                  恢复当前内容
                </button>
                <button
                  class="primary-btn"
                  :disabled="!tools.selectedAppSkill.writable"
                  @click="handleSaveAppSkill"
                >
                  保存
                </button>
              </div>
            </div>

            <label class="toggle-row">
              <input v-model="tools.selectedAppSkillEnabled" :disabled="!tools.selectedAppSkill.writable" type="checkbox">
              <span>启用这个 App 内置 Skill</span>
            </label>

            <div class="detail-meta-grid">
              <div>
                <label>Name</label>
                <input
                  v-model="tools.selectedAppSkillName"
                  :disabled="!tools.selectedAppSkill.writable"
                  class="filter-input full-width"
                  type="text"
                  placeholder="skill name"
                >
              </div>
              <div>
                <label>来源</label>
                <div>{{ tools.selectedAppSkill.sourceType || 'unknown' }}</div>
              </div>
              <div class="detail-meta-span-2">
                <label>Source Path</label>
                <div>{{ tools.selectedAppSkill.sourcePath || '—' }}</div>
              </div>
            </div>

            <textarea
              data-testid="app-skill-editor"
              v-model="tools.selectedAppSkillContent"
              class="skill-editor"
              :readonly="!tools.selectedAppSkill.writable"
              spellcheck="false"
            />
          </template>

          <div v-else class="empty-state detail-empty">
            选择一个 App 内置 Skill 后可编辑。
          </div>
        </section>
      </div>
    </template>

    <template v-else-if="currentTool === 'app-tools'">
      <div class="tools-header">
        <div>
          <button class="back-link-btn" @click="goBackToMenu">← 返回 Tools</button>
          <h2>App 内置 Tools</h2>
          <p>这里只编辑桌面 App 暴露给 AI chat 的 tool 元数据和开关，不改工具实现代码。</p>
        </div>
      </div>

      <div v-if="tools.appStatusMessage" class="scan-root-card">
        {{ tools.appStatusMessage }}
      </div>

      <div class="tools-layout">
        <section class="skills-list-panel glass-card">
          <div class="panel-header">
            <div>
              <h3>App Tools</h3>
              <span class="panel-meta">{{ tools.appTools.length }} 项</span>
            </div>
            <input
              v-model="keyword"
              class="filter-input"
              type="text"
              placeholder="搜索内置 tool"
            />
          </div>

          <div class="skills-list">
            <button
              v-for="tool in filteredAppTools"
              :key="tool.name"
              class="skill-row"
              :class="{ active: tools.selectedAppTool?.name === tool.name }"
              @click="tools.selectAppTool(tool)"
            >
              <div class="skill-row-title">{{ tool.label || tool.name }}</div>
              <div class="skill-row-name">{{ tool.name }}</div>
              <div v-if="tool.description" class="skill-row-desc">{{ tool.description }}</div>
              <div class="skill-row-path">
                {{ tool.customized ? '已自定义' : '使用默认配置' }} · {{ tool.enabled ? '已启用' : '已隐藏' }}
              </div>
            </button>
          </div>
        </section>

        <section class="skill-detail-panel glass-card">
          <template v-if="tools.selectedAppTool">
            <div class="panel-header">
              <div>
                <h3>{{ tools.selectedAppTool.name }}</h3>
                <div class="panel-meta">仅影响桌面 App 的 AI chat</div>
              </div>
              <div class="detail-actions">
                <button class="secondary-btn" @click="tools.resetSelectedAppTool()">恢复默认</button>
                <button class="primary-btn" @click="tools.saveSelectedAppTool()">保存</button>
              </div>
            </div>

            <label class="toggle-row">
              <input v-model="tools.selectedAppToolEnabled" type="checkbox">
              <span>向 AI chat 暴露这个 Tool</span>
            </label>

            <div class="detail-meta-grid">
              <div>
                <label>显示名</label>
                <input v-model="tools.selectedAppToolLabel" class="filter-input full-width" type="text" placeholder="如：联网搜索（App）">
              </div>
              <div>
                <label>描述</label>
                <textarea
                  v-model="tools.selectedAppToolDescription"
                  class="skill-editor compact-editor"
                  spellcheck="false"
                />
              </div>
            </div>
          </template>

          <div v-else class="empty-state detail-empty">
            选择一个 App 内置 Tool 后可编辑。
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tools-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  padding-bottom: 80px;
  gap: 16px;
}

.tools-header,
.scan-root-card,
.glass-card {
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border-strong);
  border-radius: 18px;
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  box-shadow: var(--shadow-glass);
}

.tools-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
}

.tools-header h2 {
  margin: 0 0 4px;
}

.tools-header p {
  margin: 0;
  color: var(--text-secondary);
}

.back-link-btn {
  margin-bottom: 8px;
  border: none;
  background: transparent;
  color: var(--accent-primary);
  cursor: pointer;
  padding: 0;
}

.tools-header-actions,
.detail-actions {
  display: flex;
  gap: 8px;
}

.primary-btn,
.secondary-btn,
.danger-btn,
.chip-remove-btn {
  border: none;
  border-radius: 10px;
  cursor: pointer;
}

.primary-btn,
.secondary-btn,
.danger-btn {
  padding: 10px 14px;
  font-weight: 600;
}

.primary-btn {
  background: var(--accent-primary);
  color: #04111b;
}

.app-skill-create-btn {
  border: 1px solid color-mix(in srgb, var(--accent-primary) 70%, transparent);
  color: var(--bg-primary);
  box-shadow: var(--shadow-button);
}

.app-skill-create-btn:hover {
  filter: brightness(1.04);
  box-shadow: var(--shadow-button-hover);
}

.secondary-btn {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.discover-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.discover-action-btn,
.discover-refresh-btn {
  border: 1px solid color-mix(in srgb, var(--accent-primary) 32%, transparent);
  min-height: 42px;
  box-shadow: 0 10px 24px rgba(9, 16, 28, 0.16);
}

.discover-action-btn {
  background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
  color: var(--text-primary);
}

.discover-action-btn:hover:not(:disabled),
.discover-refresh-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.04);
}

.discover-bulk-btn {
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 18%, transparent), rgba(255,255,255,0.04));
}

.discover-refresh-btn {
  background: linear-gradient(135deg, var(--accent-primary), color-mix(in srgb, var(--accent-primary) 72%, #7ee7ff));
  color: var(--bg-primary);
  box-shadow: 0 14px 30px color-mix(in srgb, var(--accent-primary) 28%, transparent);
}

.discover-refresh-btn:disabled,
.discover-action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.scan-root-limit-tip {
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 13px;
}

.danger-btn {
  background: rgba(255, 97, 97, 0.18);
  color: #ff8f8f;
}

.scan-root-card {
  padding: 16px 18px;
}

.tool-menu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 320px));
  gap: 16px;
}

.tool-menu-card {
  text-align: left;
  padding: 20px;
  border-radius: 18px;
  border: 1px solid var(--glass-border-strong);
  background: var(--glass-bg-strong);
  color: var(--text-primary);
  box-shadow: var(--shadow-glass);
  cursor: pointer;
}

.tool-menu-card.active {
  border-color: var(--accent-primary);
}

.tool-menu-icon {
  font-size: 28px;
  margin-bottom: 10px;
}

.tool-menu-title {
  font-size: 18px;
  font-weight: 700;
}

.tool-menu-desc {
  margin-top: 8px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.section-title {
  font-weight: 700;
  margin-bottom: 10px;
}

.scan-root-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.scan-root-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 999px;
  background: var(--glass-bg-hover);
  color: var(--text-secondary);
}

.chip-remove-btn {
  width: 20px;
  height: 20px;
  background: transparent;
  color: inherit;
}

.tools-layout {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 16px;
  min-height: 0;
  flex: 1;
}

.skills-list-panel,
.skill-detail-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.panel-header h3 {
  margin: 0;
}

.discover-selection-meta {
  margin-bottom: 12px;
}

.discover-checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: var(--text-secondary);
  cursor: pointer;
}

.skill-row-install-meta {
  margin-top: 6px;
  color: var(--accent-primary);
  font-size: 12px;
  font-weight: 600;
}

.library-install-targets {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.library-install-target {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--glass-bg-hover);
}

.library-install-link-type {
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
}

.panel-meta {
  font-size: 12px;
  color: var(--text-tertiary);
  word-break: break-all;
}

.panel-error {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 97, 97, 0.12);
  color: #ff8f8f;
}

.filter-input,
.skill-editor {
  width: 100%;
  border: 1px solid var(--glass-border);
  background: var(--input-bg);
  color: var(--text-primary);
  border-radius: 12px;
}

.full-width {
  max-width: none;
}

.filter-input {
  max-width: 220px;
  padding: 10px 12px;
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.skill-row {
  text-align: left;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: inherit;
  cursor: pointer;
}

.skill-row.active {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary);
}

.skill-row-title {
  font-weight: 700;
}

.skill-row-name,
.skill-row-desc,
.skill-row-summary,
.skill-row-path {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  word-break: break-all;
}

.skill-row-summary {
  color: var(--text-tertiary);
}

.detail-meta-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-bottom: 14px;
  font-size: 13px;
}

.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: var(--text-secondary);
}

.detail-meta-grid label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.detail-meta-span-2 {
  grid-column: 1 / -1;
}

.skill-editor {
  flex: 1;
  min-height: 320px;
  resize: none;
  padding: 14px;
  font-family: 'JetBrains Mono', monospace;
  line-height: 1.6;
}

.compact-editor {
  min-height: 160px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  text-align: center;
  color: var(--text-secondary);
  border: 1px dashed var(--glass-border);
  border-radius: 14px;
}

.detail-empty {
  flex: 1;
}

@media (max-width: 1100px) {
  .tools-layout {
    grid-template-columns: 1fr;
  }
}
</style>
