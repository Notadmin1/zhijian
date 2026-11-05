import type { Theme, Typography } from '../types'

export const themes: Theme[] = [
  { id: 'botanical', name: '青绿留白', subtitle: '清爽自然，让阅读轻一点', accent: '#416c58', soft: '#eff4ef', label: '简洁阅读', sampleTitle: '把日子，写成诗', features: '青绿章节 · 轻盈导读' },
  { id: 'editorial', name: '墨色专栏', subtitle: '克制有序，让观点更清晰', accent: '#354c70', soft: '#eef1f7', label: '商务专业', sampleTitle: '让每一个观点被看见', features: '线条标题 · 清晰层级' },
  { id: 'warm', name: '日光随笔', subtitle: '温柔质感，记录生活片刻', accent: '#ac6c4c', soft: '#fbf1e9', label: '温暖随笔', sampleTitle: '收藏生活里的微光', features: '暖色标题 · 柔和引文' },
  { id: 'technical', name: '技术手记', subtitle: '清晰的步骤、代码与图表', accent: '#365c86', soft: '#edf3fa', label: '技术与实践', sampleTitle: '让代码与思路同样清晰', features: '深色代码 · 蓝色章节' },
  { id: 'research', name: '安全研究', subtitle: '从问题背景，到验证与结论', accent: '#294f59', soft: '#edf4f4', label: 'RESEARCH NOTES', sampleTitle: '把验证过程，讲清楚', features: '章节档案 · 深色代码 · 结果卡片' },
  { id: 'tutorial', name: '实战教程', subtitle: '一步一步，让读者跟得上', accent: '#9a5b37', soft: '#fbf1e8', label: 'LEARN BY DOING', sampleTitle: '跟着步骤，完成实践', features: '步骤标题 · 浅色代码 · 操作提示' },
  { id: 'minimal', name: '极简长文', subtitle: '少一些装饰，多一些阅读空间', accent: '#3d4941', soft: '#f3f5f2', label: 'SLOW READING', sampleTitle: '留白之间，读懂思考', features: '克制标题 · 疏朗段落 · 细线引文' },
]

export const defaultTypography = (accent = themes[0].accent): Typography => ({
  fontSize: 16, lineHeight: 1.8, paragraphSpace: 16, accent,
  serif: false, indent: false, includeTitle: false,
  numberHeadings: true, leadParagraph: true,
  codeFontSize: 13, codeWrap: true, tableMode: 'auto',
  readingDensity: 'standard', smartSpacing: true, decoration: 'balanced',
})

export const validAccent = (value: string) => /^#[0-9a-f]{6}$/i.test(value)
export const clamp = (n: number, min: number, max: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback

export function safeTypography(value: Partial<Typography> = {}): Typography {
  return {
    fontSize: clamp(Number(value.fontSize), 12, 24, 16),
    lineHeight: clamp(Number(value.lineHeight), 1.2, 2.6, 1.8),
    paragraphSpace: clamp(Number(value.paragraphSpace), 0, 40, 16),
    accent: validAccent(value.accent || '') ? value.accent! : themes[0].accent,
    serif: value.serif === true, indent: value.indent === true, includeTitle: value.includeTitle === true,
    numberHeadings: value.numberHeadings !== false, leadParagraph: value.leadParagraph !== false,
    codeFontSize: clamp(Number(value.codeFontSize), 11, 18, 13), codeWrap: value.codeWrap !== false,
    tableMode: value.tableMode === 'fit' || value.tableMode === 'scroll' ? value.tableMode : 'auto',
    readingDensity: value.readingDensity === 'compact' || value.readingDensity === 'relaxed' ? value.readingDensity : 'standard',
    smartSpacing: value.smartSpacing !== false,
    decoration: value.decoration === 'simple' || value.decoration === 'expressive' ? value.decoration : 'balanced',
  }
}
