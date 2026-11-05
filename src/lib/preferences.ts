import type { Article, ThemeId, Typography } from '../types'
import { defaultTypography, safeTypography, themes } from './themes'

export interface Preferences {
  themeId: ThemeId
  typography: Typography
  autoBeautify: boolean
}

const key = 'zijian-preferences-v1'

export function readPreferences(): Preferences {
  const defaults: Preferences = { themeId: 'botanical', typography: defaultTypography(), autoBeautify: true }
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    if (!value || typeof value !== 'object') return defaults
    return {
      themeId: themes.some(theme => theme.id === value.themeId) ? value.themeId : defaults.themeId,
      typography: safeTypography(value.typography && typeof value.typography === 'object' ? value.typography : {}),
      autoBeautify: value.autoBeautify !== false,
    }
  } catch { return defaults }
}

export function writePreferences(value: Preferences) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Article saving is independent of optional defaults. */ }
}

export function applyPreferences(article: Article, preferences: Preferences): Article {
  return { ...article, themeId: preferences.themeId, typography: { ...preferences.typography } }
}
