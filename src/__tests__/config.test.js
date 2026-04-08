import { beforeEach, describe, expect, it } from 'vitest'
import { getCurrentTheme, initTheme } from '../config'

describe('theme config', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('always defaults to lemon-fresh', () => {
    localStorage.setItem('dev_helper_theme', 'cyber-night')

    expect(getCurrentTheme()).toBe('lemon-fresh')
  })

  it('initializes app theme as lemon-fresh', () => {
    localStorage.setItem('dev_helper_theme', 'cyber-night')

    initTheme()

    expect(document.documentElement.getAttribute('data-theme')).toBe('lemon-fresh')
  })
})
