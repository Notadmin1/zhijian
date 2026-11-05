import type { JSONContent } from '@tiptap/react'
import { nodeText } from './document'

export const calloutKinds = {
  note: { label: '说明', color: '#3f6580', background: '#eff5fa', symbol: 'i' },
  warning: { label: '注意', color: '#9a5a31', background: '#fff5e9', symbol: '!' },
  prerequisite: { label: '前置条件', color: '#73558f', background: '#f5f0fa', symbol: '◇' },
  goal: { label: '目标', color: '#366c70', background: '#edf7f6', symbol: '◎' },
  result: { label: '观察与结果', color: '#3e7156', background: '#eef6ef', symbol: '✓' },
  tip: { label: '建议', color: '#7d693a', background: '#faf6e9', symbol: '↗' },
} as const
export type CalloutKind = keyof typeof calloutKinds
export const isCalloutKind = (value: unknown): value is CalloutKind => typeof value === 'string' && Object.prototype.hasOwnProperty.call(calloutKinds, value)
export const safeCallout = (value: unknown): CalloutKind | 'none' | null => value === 'none' || isCalloutKind(value) ? value : null

export function inferCallout(node: JSONContent): CalloutKind | null {
  if (node.type !== 'paragraph' || node.attrs?.callout === 'none' || node.content?.some(child => !['text', 'hardBreak'].includes(child.type || ''))) return null
  if (isCalloutKind(node.attrs?.callout)) return node.attrs.callout
  const text = nodeText(node).trim()
  const patterns: [CalloutKind, RegExp][] = [
    ['warning', /^(?:注意|警告|重要提醒|特别提醒|风险提示)[：:]\s*\S/],
    ['prerequisite', /^(?:前置条件|准备工作|环境要求)[：:]\s*\S/],
    ['goal', /^(?:目标|本节目标|测试目标)[：:]\s*\S/],
    ['result', /^(?:观察|执行结果|预期结果|验证结果|测试结果)[：:]\s*\S/],
    ['tip', /^(?:建议|修复建议|小技巧)[：:]\s*\S/],
    ['note', /^(?:说明|备注|提示)[：:]\s*\S/],
  ]
  return patterns.find(([, pattern]) => pattern.test(text))?.[0] || null
}
