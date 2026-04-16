import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from './settings'
import {
  createEditableAppSkill,
  getEditableAppSkills,
  resetEditableAppSkill,
  saveEditableAppSkill
} from '../agent/skills'
import {
  getEditableAppTools,
  resetEditableAppTool,
  saveEditableAppTool
} from '../agent/tools'

const SKILL_ROOTS_STORAGE_KEY = 'tools_skill_scan_roots_v1'
const DEFAULT_GLOBAL_ROOTS = ['~/.codex/skills', '~/.cursor/skills', '~/.agents/skills']

function normalizeRoots(roots = []) {
  return [...new Set(
    roots
      .map(root => String(root || '').trim())
      .filter(Boolean)
  )]
}

function loadStoredRoots(workspacePath) {
  try {
    const raw = localStorage.getItem(SKILL_ROOTS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const normalized = normalizeRoots(parsed)
      if (normalized.length > 0) return normalized
    }
  } catch {
    // ignore
  }

  return normalizeRoots([workspacePath, ...DEFAULT_GLOBAL_ROOTS])
}

export const useToolsStore = defineStore('tools', () => {
  const settings = useSettingsStore()
  const scanRoots = ref(loadStoredRoots(settings.workspacePath))
  const skills = ref([])
  const selectedSkill = ref(null)
  const selectedContent = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const deleting = ref(false)
  const error = ref('')
  const lastScanAt = ref('')
  const appSkills = ref([])
  const selectedAppSkill = ref(null)
  const selectedAppSkillContent = ref('')
  const selectedAppSkillEnabled = ref(true)
  const appTools = ref([])
  const selectedAppTool = ref(null)
  const selectedAppToolLabel = ref('')
  const selectedAppToolDescription = ref('')
  const selectedAppToolEnabled = ref(true)
  const appStatusMessage = ref('')

  function persistRoots() {
    localStorage.setItem(SKILL_ROOTS_STORAGE_KEY, JSON.stringify(scanRoots.value))
  }

  function setScanRoots(nextRoots) {
    scanRoots.value = normalizeRoots(nextRoots)
    persistRoots()
  }

  function addScanRoot(root) {
    setScanRoots([...scanRoots.value, root])
  }

  function removeScanRoot(root) {
    setScanRoots(scanRoots.value.filter(item => item !== root))
  }

  async function refreshSkills(nextRoots = scanRoots.value) {
    loading.value = true
    error.value = ''
    setScanRoots(nextRoots)

    try {
      const result = await invoke('agent_scan_skills', {
        roots: scanRoots.value
      })

      skills.value = Array.isArray(result?.skills) ? result.skills : []
      lastScanAt.value = new Date().toISOString()

      if (selectedSkill.value) {
        const nextSelected = skills.value.find(skill => skill.id === selectedSkill.value.id) || null
        selectedSkill.value = nextSelected
        if (!nextSelected) {
          selectedContent.value = ''
        }
      }
    } catch (scanError) {
      error.value = scanError?.message || String(scanError)
    } finally {
      loading.value = false
    }
  }

  async function selectSkill(skill) {
    selectedSkill.value = skill || null
    selectedContent.value = ''
    if (!skill?.skillPath) return

    const result = await invoke('agent_read_skill', {
      skillPath: skill.skillPath
    })

    selectedContent.value = String(result?.content || '')
  }

  async function saveSelectedSkill(content = selectedContent.value) {
    if (!selectedSkill.value?.skillPath) return

    saving.value = true
    error.value = ''

    try {
      await invoke('agent_write_skill', {
        skillPath: selectedSkill.value.skillPath,
        content
      })
      selectedContent.value = content
    } catch (saveError) {
      error.value = saveError?.message || String(saveError)
      throw saveError
    } finally {
      saving.value = false
    }
  }

  async function deleteSkill(skill) {
    if (!skill?.skillPath) return

    deleting.value = true
    error.value = ''

    try {
      await invoke('agent_delete_skill', {
        skillPath: skill.skillPath
      })

      skills.value = skills.value.filter(item => item.id !== skill.id)
      if (selectedSkill.value?.id === skill.id) {
        selectedSkill.value = null
        selectedContent.value = ''
      }
    } catch (deleteError) {
      error.value = deleteError?.message || String(deleteError)
      throw deleteError
    } finally {
      deleting.value = false
    }
  }

  const skillCount = computed(() => skills.value.length)

  function refreshAppSkillRegistry() {
    appSkills.value = getEditableAppSkills()

    if (selectedAppSkill.value) {
      const nextSelected = appSkills.value.find(skill => skill.name === selectedAppSkill.value.name) || null
      selectedAppSkill.value = nextSelected
      if (nextSelected) {
        selectedAppSkillContent.value = nextSelected.content
        selectedAppSkillEnabled.value = nextSelected.enabled !== false
      }
    }
  }

  async function selectAppSkill(nameOrSkill) {
    const skillName = typeof nameOrSkill === 'string' ? nameOrSkill : nameOrSkill?.name
    refreshAppSkillRegistry()
    const skill = appSkills.value.find(item => item.name === skillName) || null
    selectedAppSkill.value = skill
    selectedAppSkillContent.value = skill?.content || ''
    selectedAppSkillEnabled.value = skill?.enabled !== false
  }

  function saveSelectedAppSkill() {
    if (!selectedAppSkill.value?.name) return

    saveEditableAppSkill(selectedAppSkill.value.name, {
      content: selectedAppSkillContent.value,
      enabled: selectedAppSkillEnabled.value
    })
    refreshAppSkillRegistry()
    selectAppSkill(selectedAppSkill.value.name)
    appStatusMessage.value = '已保存 App 内置 Skill，并对当前桌面 App 的 AI chat 生效。'
  }

  async function createAppSkill() {
    const draft = createEditableAppSkill()
    refreshAppSkillRegistry()
    await selectAppSkill(draft.name)
    appStatusMessage.value = '已新增 App 自定义 Skill，请补充内容后保存，即可对当前桌面 App 的 AI chat 生效。'
  }

  function resetSelectedAppSkill() {
    if (!selectedAppSkill.value?.name) return

    const skillName = selectedAppSkill.value.name
    resetEditableAppSkill(skillName)
    refreshAppSkillRegistry()
    selectAppSkill(skillName)
    appStatusMessage.value = '已恢复默认 App 内置 Skill；如果是自定义新增 skill，则已从当前桌面 App 中移除。'
  }

  function refreshAppToolRegistry() {
    appTools.value = getEditableAppTools()

    if (selectedAppTool.value) {
      const nextSelected = appTools.value.find(tool => tool.name === selectedAppTool.value.name) || null
      selectedAppTool.value = nextSelected
      if (nextSelected) {
        selectedAppToolLabel.value = nextSelected.label || ''
        selectedAppToolDescription.value = nextSelected.description || ''
        selectedAppToolEnabled.value = nextSelected.enabled !== false
      }
    }
  }

  async function selectAppTool(nameOrTool) {
    const toolName = typeof nameOrTool === 'string' ? nameOrTool : nameOrTool?.name
    refreshAppToolRegistry()
    const tool = appTools.value.find(item => item.name === toolName) || null
    selectedAppTool.value = tool
    selectedAppToolLabel.value = tool?.label || ''
    selectedAppToolDescription.value = tool?.description || ''
    selectedAppToolEnabled.value = tool?.enabled !== false
  }

  function saveSelectedAppTool() {
    if (!selectedAppTool.value?.name) return

    saveEditableAppTool(selectedAppTool.value.name, {
      label: selectedAppToolLabel.value,
      description: selectedAppToolDescription.value,
      enabled: selectedAppToolEnabled.value
    })
    refreshAppToolRegistry()
    selectAppTool(selectedAppTool.value.name)
    appStatusMessage.value = '已保存 App 内置 Tool，并对当前桌面 App 的 AI chat 生效。'
  }

  function resetSelectedAppTool() {
    if (!selectedAppTool.value?.name) return

    const toolName = selectedAppTool.value.name
    resetEditableAppTool(toolName)
    refreshAppToolRegistry()
    selectAppTool(toolName)
    appStatusMessage.value = '已恢复默认 App 内置 Tool，并对当前桌面 App 的 AI chat 生效。'
  }

  refreshAppSkillRegistry()
  refreshAppToolRegistry()

  return {
    scanRoots,
    skills,
    selectedSkill,
    selectedContent,
    loading,
    saving,
    deleting,
    error,
    lastScanAt,
    appSkills,
    selectedAppSkill,
    selectedAppSkillContent,
    selectedAppSkillEnabled,
    appTools,
    selectedAppTool,
    selectedAppToolLabel,
    selectedAppToolDescription,
    selectedAppToolEnabled,
    appStatusMessage,
    skillCount,
    setScanRoots,
    addScanRoot,
    removeScanRoot,
    refreshSkills,
    selectSkill,
    saveSelectedSkill,
    deleteSkill,
    refreshAppSkillRegistry,
    createAppSkill,
    selectAppSkill,
    saveSelectedAppSkill,
    resetSelectedAppSkill,
    refreshAppToolRegistry,
    selectAppTool,
    saveSelectedAppTool,
    resetSelectedAppTool
  }
})
