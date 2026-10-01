import type { LimitSpec, LimitVersion, MonitoringValue } from '../types'

/** 将关键限值展示文本解析为可判定的数值范围 */
export function parseLimitText(text: string, unit: string): LimitSpec {
  const normalized = text.replace(/\s/g, '')
  // 区间 a-b 单位 / ...
  const range = normalized.match(/(-?\d+(?:\.\d+)?)\s*[-~～]\s*(-?\d+(?:\.\d+)?)/)
  if (range) return { min: Number(range[1]), max: Number(range[2]), unit, text }
  const atLeast = normalized.match(/[≥>=]\s*(-?\d+(?:\.\d+)?)/)
  if (atLeast) return { min: Number(atLeast[1]), max: null, unit, text }
  const atMost = normalized.match(/[≤<=]\s*(-?\d+(?:\.\d+)?)/)
  if (atMost) return { min: null, max: Number(atMost[1]), unit, text }
  const single = normalized.match(/^(-?\d+(?:\.\d+)?)/)
  if (single) return { min: Number(single[1]), max: Number(single[1]), unit, text }
  return { min: null, max: null, unit, text }
}

/**
 * 按记录时点在生效时间线上选版：
 * 取 effectiveAt <= 记录时点 的最后一版（可能已被新限值替代，但对该历史时点仍有效）。
 */
export function versionAt(versions: LimitVersion[], stepId: string, recordedAt: string): LimitVersion | null {
  const line = versions
    .filter((item) => item.stepId === stepId && item.effectiveAt <= recordedAt)
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.versionNo - b.versionNo)
  return line[line.length - 1] ?? null
}

/** 该时点之前不存在任何已生效版本（晚到记录比首版还早） */
export function hasVersionBefore(versions: LimitVersion[], stepId: string, recordedAt: string): boolean {
  return versions.some((item) => item.stepId === stepId && item.effectiveAt <= recordedAt)
}

/** 读数时点对应版本是否已失效（已有更新版本生效，但该时点仍落在旧版窗口内时不算失效） */
export function basisIsActive(version: LimitVersion | null): boolean {
  return !!version && version.supersededAt === null
}

export function judgeValue(value: number, spec: LimitSpec): '合格' | '超限' {
  if (spec.min !== null && value < spec.min) return '超限'
  if (spec.max !== null && value > spec.max) return '超限'
  return '合格'
}

/** 同一控制点同一批次重复提交（两个窗口并发）判定 */
export function findConcurrentReading(readings: MonitoringValue[], batchId: string, stepId: string): MonitoringValue | undefined {
  return readings.find((item) => item.id.startsWith(`${batchId}:`) && item.stepId === stepId && item.judgeStatus !== '待核')
}

/** 轻量摘要：时间线检查点之间形成哈希链，恢复时校验完整性 */
export function digest(...parts: Array<string | number | null | undefined>): string {
  const raw = parts.map((part) => String(part ?? '')).join('|')
  let hash = 5381
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function formatTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}

export function formatDate(value: string): string {
  return value.slice(0, 10)
}
