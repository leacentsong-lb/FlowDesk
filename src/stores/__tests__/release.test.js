import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useReleaseStore } from '../release'

describe('release store generic agent mode', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('starts as a generic development assistant with generic entry actions', async () => {
    const release = useReleaseStore()

    await release.agentStart()

    expect(release.mode).toBe('general')
    expect(release.chatMessages[0].text).toContain('开发助手')
    expect(release.chatMessages[0].actions.map(action => action.id)).toContain('mode-general-workspace')
    expect(release.chatMessages[0].actions.map(action => action.id)).toContain('mode-release-production')
  })
})
