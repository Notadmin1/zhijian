import type { JSONContent } from '@tiptap/react'

export type ThemeId = 'botanical' | 'editorial' | 'warm' | 'technical' | 'research' | 'tutorial' | 'minimal'
export type ReadingDensity = 'compact' | 'standard' | 'relaxed'
export type DecorationStrength = 'simple' | 'balanced' | 'expressive'
export interface Typography {
  fontSize: number
  lineHeight: number
  paragraphSpace: number
  accent: string
  serif: boolean
  indent: boolean
  includeTitle: boolean
  numberHeadings: boolean
  leadParagraph: boolean
  codeFontSize: number
  codeWrap: boolean
  tableMode: 'auto' | 'fit' | 'scroll'
  readingDensity: ReadingDensity
  smartSpacing: boolean
  decoration: DecorationStrength
}
export interface Article {
  id: string
  schemaVersion: 1
  title: string
  document: JSONContent
  sourceSnapshot: JSONContent
  themeId: ThemeId
  typography: Typography
  createdAt: number
  updatedAt: number
  deletedAt?: number
  ignoredLayoutIssues?: string[]
}
export interface ArticleVersion {
  id: string
  articleId: string
  createdAt: number
  reason: string
  article: Article
}
export interface StylePreset {
  id: string
  name: string
  themeId: ThemeId
  typography: Typography
  footer: string
  createdAt: number
  updatedAt: number
}
export type ContentTemplatePosition = 'header' | 'footer'
export interface ContentTemplate {
  id: string
  name: string
  position: ContentTemplatePosition
  document: JSONContent
  autoInsert: boolean
  createdAt: number
  updatedAt: number
}
export interface Asset {
  id: string
  name: string
  mime: string
  blob: Blob
  createdAt: number
}
export interface WeixinSyncRecord {
  id: string
  articleId: string
  articleUpdatedAt: number
  articleTitle: string
  accountName: string
  status: 'syncing' | 'succeeded' | 'failed' | 'unknown'
  stage: string
  images: number
  startedAt: number
  finishedAt?: number
  draftUrl?: string
  error?: string
}
export interface Theme {
  id: ThemeId
  name: string
  subtitle: string
  accent: string
  soft: string
  label: string
  sampleTitle: string
  features: string
}
