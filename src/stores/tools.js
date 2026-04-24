import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from './settings'
import {
  getEditableAppTools,
  resetEditableAppTool,
  saveEditableAppTool
} from '../agent/tools'
import { clearAppSkillOverrides, loadAppSkillOverrides } from '../agent/customization'

const MAX_SCAN_ROOTS = 8

function buildDefaultSkillRoots(workspacePath = '') {
  const workspace = String(workspacePath || '').trim()
  if (!workspace) return []

  return normalizeRoots([
    `${workspace}/app-skills`,
    `${workspace}/.flow-desk/app-skills`
  ])
}

function normalizeWorkspaceInstallPath(path = '') {
  const trimmed = String(path || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/.flow-desk/app-skills')) {
    return trimmed.slice(0, -'/ .flow-desk/app-skills'.replace(' ', '').length)
  }
  if (trimmed.endsWith('/.flow-desk')) {
    return trimmed.slice(0, -'/ .flow-desk'.replace(' ', '').length)
  }
  return trimmed
}

function normalizeRoots(roots = []) {
  return [...new Set(
    roots
      .map(root => String(root || '').trim())
      .filter(Boolean)
  )]
}

function isScanRootLimitExceeded(roots = []) {
  return normalizeRoots(roots).length > MAX_SCAN_ROOTS
}


export const useToolsStore = defineStore('tools', () => {
  const settings = useSettingsStore()
  const scanRoots = ref([])
  const discoveredSkills = ref([])
  const selectedDiscoveredSkillIds = ref([])
  const skills = discoveredSkills
  const librarySkills = ref([])
  const selectedLibrarySkill = ref(null)
  const selectedSkill = ref(null)
  const selectedContent = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const deleting = ref(false)
  const error = ref('')
  const lastScanAt = ref('')
  const appSkills = ref([])
  const selectedAppSkill = ref(null)
  const selectedAppSkillName = ref('')
  const selectedAppSkillContent = ref('')
  const selectedAppSkillEnabled = ref(true)
  const appTools = ref([])
  const selectedAppTool = ref(null)
  const selectedAppToolLabel = ref('')
  const selectedAppToolDescription = ref('')
  const selectedAppToolEnabled = ref(true)
  const appStatusMessage = ref('')

  async function loadScanRoots() {
    try {
      const result = await invoke('agent_get_skill_scan_roots')
      const roots = Array.isArray(result?.roots)
        ? result.roots.filter(item => item?.enabled !== false).map(item => String(item?.path || '').trim())
        : []
      scanRoots.value = normalizeRoots(roots)
      if (scanRoots.value.length === 0) {
        scanRoots.value = buildDefaultSkillRoots(settings.workspacePath)
      }
    } catch {
      scanRoots.value = buildDefaultSkillRoots(settings.workspacePath)
    }
  }

  async function setScanRoots(nextRoots) {
    const normalized = normalizeRoots(nextRoots)
    if (isScanRootLimitExceeded(normalized)) {
      appStatusMessage.value = `最多只允许配置 ${MAX_SCAN_ROOTS} 个扫描目录`
      return false
    }

    const result = await invoke('agent_set_skill_scan_roots', {
      roots: normalized.map(path => ({ path, enabled: true }))
    })
    scanRoots.value = Array.isArray(result?.roots)
      ? normalizeRoots(result.roots.filter(item => item?.enabled !== false).map(item => String(item?.path || '').trim()))
      : normalized
    return true
  }

  async function addScanRoot(root) {
    const nextRoot = String(root || '').trim()
    if (!nextRoot) return false
    if (scanRoots.value.includes(nextRoot)) {
      appStatusMessage.value = `扫描目录已存在：${nextRoot}`
      return false
    }
    return setScanRoots([...scanRoots.value, nextRoot])
  }

  async function removeScanRoot(root) {
    return setScanRoots(scanRoots.value.filter(item => item !== root))
  }

  async function discoverSkills(nextRoots = scanRoots.value) {
    loading.value = true
    error.value = ''
    await setScanRoots(nextRoots)

    try {
      const result = await invoke('agent_discover_skills', {
        roots: scanRoots.value
      })

      discoveredSkills.value = Array.isArray(result?.skills) ? result.skills : []
      selectedDiscoveredSkillIds.value = selectedDiscoveredSkillIds.value.filter(id => (
        discoveredSkills.value.some(skill => skill.id === id)
      ))
      lastScanAt.value = new Date().toISOString()

      if (selectedSkill.value) {
        const nextSelected = discoveredSkills.value.find(skill => skill.id === selectedSkill.value.id) || null
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

  const refreshSkills = discoverSkills

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

      discoveredSkills.value = discoveredSkills.value.filter(item => item.id !== skill.id)
      selectedDiscoveredSkillIds.value = selectedDiscoveredSkillIds.value.filter(id => id !== skill.id)
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

  async function loadLibrarySkills() {
    loading.value = true
    error.value = ''

    try {
      const result = await invoke('agent_list_library_skills')
      librarySkills.value = Array.isArray(result?.skills) ? result.skills : []
      if (selectedLibrarySkill.value) {
        selectedLibrarySkill.value = librarySkills.value.find(item => item.name === selectedLibrarySkill.value.name) || null
      }
    } catch (loadError) {
      error.value = loadError?.message || String(loadError)
      throw loadError
    } finally {
      loading.value = false
    }
  }

  function selectLibrarySkill(skill) {
    selectedLibrarySkill.value = skill || null
  }

  async function importDiscoveredSkillToLibrary(skill) {
    if (!skill?.skillPath) return

    saving.value = true
    error.value = ''

    try {
      const result = await invoke('agent_import_skill_to_library', {
        skillPath: skill.skillPath
      })
      await loadLibrarySkills()
      selectedLibrarySkill.value = result?.skill || null
      appStatusMessage.value = `已导入到 Central Library：${result?.skill?.name || skill.name}`
    } catch (importError) {
      error.value = importError?.message || String(importError)
      throw importError
    } finally {
      saving.value = false
    }
  }

  const importSkillToApp = importDiscoveredSkillToLibrary

  const selectedDiscoveredSkillCount = computed(() => selectedDiscoveredSkillIds.value.length)

  function toggleDiscoveredSkillSelection(skill) {
    const skillId = skill?.id
    if (!skillId) return
    if (selectedDiscoveredSkillIds.value.includes(skillId)) {
      selectedDiscoveredSkillIds.value = selectedDiscoveredSkillIds.value.filter(id => id !== skillId)
      return
    }
    selectedDiscoveredSkillIds.value = [...selectedDiscoveredSkillIds.value, skillId]
  }

  function toggleAllDiscoveredSkills(skillsToToggle = discoveredSkills.value) {
    const ids = skillsToToggle
      .map(skill => skill?.id)
      .filter(Boolean)
    if (ids.length === 0) return

    const allSelected = ids.every(id => selectedDiscoveredSkillIds.value.includes(id))
    if (allSelected) {
      selectedDiscoveredSkillIds.value = selectedDiscoveredSkillIds.value.filter(id => !ids.includes(id))
      return
    }

    selectedDiscoveredSkillIds.value = [...new Set([...selectedDiscoveredSkillIds.value, ...ids])]
  }

  async function importSelectedDiscoveredSkillsToLibrary() {
    const selectedSkills = discoveredSkills.value.filter(skill => selectedDiscoveredSkillIds.value.includes(skill.id))
    if (selectedSkills.length === 0) return

    saving.value = true
    error.value = ''

    try {
      let lastImportedSkill = null
      for (const skill of selectedSkills) {
        const result = await invoke('agent_import_skill_to_library', {
          skillPath: skill.skillPath
        })
        lastImportedSkill = result?.skill || null
      }
      await loadLibrarySkills()
      selectedLibrarySkill.value = lastImportedSkill
        ? librarySkills.value.find(item => item.name === lastImportedSkill.name) || lastImportedSkill
        : null
      selectedDiscoveredSkillIds.value = []
      appStatusMessage.value = `已导入 ${selectedSkills.length} 个 Skills 到 Central Library`
    } catch (importError) {
      error.value = importError?.message || String(importError)
      throw importError
    } finally {
      saving.value = false
    }
  }

  async function migrateLegacyAppSkillOverrides() {
    const overrides = loadAppSkillOverrides()
    if (Object.keys(overrides || {}).length === 0) return

    saving.value = true
    error.value = ''

    try {
      await refreshAppSkillRegistry()
      const result = await invoke('agent_migrate_app_skill_overrides', {
        overrides
      })
      clearAppSkillOverrides()
      await refreshAppSkillRegistry()
      const migratedCount = Array.isArray(result?.migrated) ? result.migrated.length : 0
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0
      appStatusMessage.value = `已迁移 ${migratedCount} 个 legacy App Skills${skippedCount > 0 ? `，跳过 ${skippedCount} 个同名技能` : ''}`
    } catch (migrationError) {
      error.value = migrationError?.message || String(migrationError)
      throw migrationError
    } finally {
      saving.value = false
    }
  }

  async function installLibrarySkillToApp(skillName, scope = 'workspace', targetWorkspacePath = settings.workspacePath) {
    if (!skillName) return

    const normalizedWorkspacePath = scope === 'workspace'
      ? normalizeWorkspaceInstallPath(targetWorkspacePath)
      : settings.workspacePath
    if (scope === 'workspace' && !normalizedWorkspacePath) {
      appStatusMessage.value = '请选择有效的工作区目录'
      return
    }

    saving.value = true
    error.value = ''
    try {
      await invoke('agent_install_library_skill_to_app', {
        skillName,
        scope,
        workspacePath: normalizedWorkspacePath
      })
      if (scope === 'workspace' && normalizedWorkspacePath === settings.workspacePath) {
        await refreshAppSkillRegistry()
        await selectAppSkill(skillName)
      }
      if (scope === 'workspace' && normalizedWorkspacePath !== settings.workspacePath) {
        appStatusMessage.value = `已安装到指定目录：${normalizedWorkspacePath}/.flow-desk/app-skills/${skillName}`
      } else {
        appStatusMessage.value = `已安装到 ${scope} App Skills：${skillName}`
      }
    } catch (installError) {
      error.value = installError?.message || String(installError)
      throw installError
    } finally {
      saving.value = false
    }
  }

  async function uninstallLibrarySkillFromApp(skillName, scope = 'workspace') {
    if (!skillName) return

    saving.value = true
    error.value = ''
    try {
      await invoke('agent_uninstall_library_skill_from_app', {
        skillName,
        scope,
        workspacePath: settings.workspacePath
      })
      await refreshAppSkillRegistry()
      appStatusMessage.value = `已从 ${scope} App Skills 卸载：${skillName}`
    } catch (uninstallError) {
      error.value = uninstallError?.message || String(uninstallError)
      throw uninstallError
    } finally {
      saving.value = false
    }
  }

  const skillCount = computed(() => discoveredSkills.value.length)

  async function refreshAppSkillRegistry() {
    const result = await invoke('agent_list_app_skills', {
      workspacePath: settings.workspacePath
    })
    appSkills.value = Array.isArray(result?.skills) ? result.skills : []

    if (!selectedAppSkill.value) {
      return
    }

    const nextSelected = appSkills.value.find(skill => skill.name === selectedAppSkill.value.name) || null
    if (!nextSelected) {
      selectedAppSkill.value = null
      selectedAppSkillName.value = ''
      selectedAppSkillContent.value = ''
      selectedAppSkillEnabled.value = true
      return
    }

    selectedAppSkill.value = nextSelected
    selectedAppSkillName.value = nextSelected.name
    selectedAppSkillContent.value = nextSelected.content || ''
    selectedAppSkillEnabled.value = nextSelected.enabled !== false
  }

  async function selectAppSkill(nameOrSkill) {
    const skillName = typeof nameOrSkill === 'string' ? nameOrSkill : nameOrSkill?.name
    if (appSkills.value.length === 0) {
      await refreshAppSkillRegistry()
    }
    const skill = appSkills.value.find(item => item.name === skillName) || null
    selectedAppSkill.value = skill
    selectedAppSkillName.value = skill?.name || ''
    selectedAppSkillContent.value = skill?.content || ''
    selectedAppSkillEnabled.value = skill ? skill.enabled !== false : true
  }

  async function saveSelectedAppSkill() {
    if (!selectedAppSkill.value?.effectivePath || !selectedAppSkill.value?.writable) return

    saving.value = true
    error.value = ''
    const skillName = selectedAppSkill.value.name

    try {
      await invoke('agent_save_app_skill', {
        skillPath: selectedAppSkill.value.effectivePath,
        content: selectedAppSkillContent.value,
        workspacePath: settings.workspacePath
      })
      await refreshAppSkillRegistry()
      await selectAppSkill(skillName)
      appStatusMessage.value = `已保存 App Skill：${skillName}`
    } catch (saveError) {
      error.value = saveError?.message || String(saveError)
      throw saveError
    } finally {
      saving.value = false
    }
  }

  async function createAppSkill() {
    saving.value = true
    error.value = ''

    try {
      const result = await invoke('agent_create_app_skill', {
        workspacePath: settings.workspacePath,
        baseName: 'custom-debug-skill'
      })
      const skillName = result?.skill?.name || 'custom-debug-skill'
      await refreshAppSkillRegistry()
      await selectAppSkill(skillName)
      appStatusMessage.value = `已新增 App Skill：${skillName}`
    } catch (createError) {
      error.value = createError?.message || String(createError)
      throw createError
    } finally {
      saving.value = false
    }
  }

  async function resetSelectedAppSkill() {
    if (!selectedAppSkill.value?.name) return
    await selectAppSkill(selectedAppSkill.value.name)
    appStatusMessage.value = `已恢复当前 App Skill 内容：${selectedAppSkill.value.name}`
  }

  async function deleteSelectedAppSkill() {
    if (!selectedAppSkill.value?.effectivePath || !selectedAppSkill.value?.writable) return

    saving.value = true
    error.value = ''
    const skillName = selectedAppSkill.value.name

    try {
      await invoke('agent_delete_app_skill', {
        skillPath: selectedAppSkill.value.effectivePath,
        workspacePath: settings.workspacePath
      })
      await refreshAppSkillRegistry()
      appStatusMessage.value = `已删除 App Skill：${skillName}`
    } catch (deleteError) {
      error.value = deleteError?.message || String(deleteError)
      throw deleteError
    } finally {
      saving.value = false
    }
  }

  async function copyAppSkillToWorkspace() {
    if (!selectedAppSkill.value?.effectivePath || selectedAppSkill.value?.writable) return

    saving.value = true
    error.value = ''
    const skillName = selectedAppSkill.value.name

    try {
      await invoke('agent_copy_app_skill_to_workspace', {
        skillPath: selectedAppSkill.value.effectivePath,
        workspacePath: settings.workspacePath
      })
      await refreshAppSkillRegistry()
      await selectAppSkill(skillName)
      appStatusMessage.value = `已复制到工作区并切换为可编辑版本：${skillName}`
    } catch (copyError) {
      error.value = copyError?.message || String(copyError)
      throw copyError
    } finally {
      saving.value = false
    }
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

  refreshAppToolRegistry()

  return {
    scanRoots,
    skills,
    discoveredSkills,
    selectedDiscoveredSkillIds,
    librarySkills,
    selectedLibrarySkill,
    selectedSkill,
    selectedContent,
    loading,
    saving,
    deleting,
    error,
    lastScanAt,
    appSkills,
    selectedAppSkill,
    selectedAppSkillName,
    selectedAppSkillContent,
    selectedAppSkillEnabled,
    appTools,
    selectedAppTool,
    selectedAppToolLabel,
    selectedAppToolDescription,
    selectedAppToolEnabled,
    appStatusMessage,
    skillCount,
    selectedDiscoveredSkillCount,
    maxScanRoots: MAX_SCAN_ROOTS,
    loadScanRoots,
    setScanRoots,
    addScanRoot,
    removeScanRoot,
    discoverSkills,
    refreshSkills,
    selectSkill,
    saveSelectedSkill,
    deleteSkill,
    loadLibrarySkills,
    selectLibrarySkill,
    importDiscoveredSkillToLibrary,
    toggleDiscoveredSkillSelection,
    toggleAllDiscoveredSkills,
    importSelectedDiscoveredSkillsToLibrary,
    migrateLegacyAppSkillOverrides,
    installLibrarySkillToApp,
    uninstallLibrarySkillFromApp,
    importSkillToApp,
    refreshAppSkillRegistry,
    createAppSkill,
    selectAppSkill,
    saveSelectedAppSkill,
    resetSelectedAppSkill,
    deleteSelectedAppSkill,
    copyAppSkillToWorkspace,
    refreshAppToolRegistry,
    selectAppTool,
    saveSelectedAppTool,
    resetSelectedAppTool
  }
})
