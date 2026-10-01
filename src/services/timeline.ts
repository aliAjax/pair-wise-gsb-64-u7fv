import type { LimitRule, LimitVersion, MonitoringValue } from '../types'

/** 按记录时点选版：取生效起始时间 ≤ at 的最后一版（版本在同一控制点上线性叠加） */
export function versionAt(versions: LimitVersion[], stepId: string, at: string): LimitVersion | null {
  return versions
    .filter((item) => item.stepId === stepId && item.effectiveFrom <= at)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
}

/** 控制点当前生效版本 */
export function currentVersion(versions: LimitVersion[], stepId: string): LimitVersion | null {
  return versions
    .filter((item) => item.stepId === stepId && item.effectiveTo === null)
    .sort((a, b) => b.revision - a.revision)[0] ?? null
}

/** 结构化限值判定；无结构化规则（如金属粒径组合限值）返回 null，由人工判定 */
export function judgeRule(rule: LimitRule | null, value: number): boolean | null {
  if (!rule) return null
  if (rule.max !== undefined) return value <= rule.max
  if (rule.min !== undefined) return value >= rule.min
  if (rule.rangeMin !== undefined && rule.rangeMax !== undefined) return value >= rule.rangeMin && value <= rule.rangeMax
  return null
}

/** 按某版本判定读数，返回新的判定视图（不写库） */
export function evaluate(reading: Pick<MonitoringValue, 'value'>, version: LimitVersion): { status: '合格' | '超限'; label: string } {
  const pass = judgeRule(version.rule, reading.value)
  return { status: pass === false ? '超限' : '合格', label: version.label }
}

export function versionTag(v: LimitVersion | undefined): string {
  return v ? `V${v.revision}（${v.label}）` : '无适用版本'
}

/** 版本是否已被封闭（新版本生效后旧版失效） */
export function isExpired(v: LimitVersion | null | undefined, at: string): boolean {
  return !!v && v.effectiveTo !== null && at >= v.effectiveTo
}

let seqCounter = 0
export function nextId(prefix: string): string {
  seqCounter += 1
  return `${prefix}-${Date.now().toString(36)}${seqCounter.toString(36)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').slice(0, 16)
}

/* ---------------- 时间线持久化：检查点 + 待写队列 ---------------- */

const CHECKPOINT_KEY = 'gsb64:timeline-checkpoint'
const OUTBOX_KEY = 'gsb64:timeline-outbox'

/** 演示用：置为 true 后下一次检查点推进必失败（待写队列仍可落盘），用于验证「从最后完整时间线恢复」 */
let failNextWrite = false
export function armWriteFailure(): void { failNextWrite = true }
export function writeFailureArmed(): boolean { return failNextWrite }

export interface Checkpoint {
  state: unknown
  events: unknown[]
  at: string
}

/**
 * 两阶段写入：
 * 1) persistOutbox 先把未完成事件追加到待写队列（WAL）；
 * 2) advanceCheckpoint 在内存状态已包含全部事件后推进检查点，再清空 WAL。
 * 任一步失败都抛出；恢复时用事件 id 去重，checkpoint 与 WAL 的重叠不会被重复应用。
 */
export function persistOutbox(outbox: unknown[]): void {
  // WAL 始终可写：失败注入只针对检查点推进，确保未完成记录不丢
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox))
}

export function advanceCheckpoint(checkpoint: Checkpoint): void {
  if (failNextWrite) {
    failNextWrite = false
    throw new Error('模拟写入失败：检查点暂不可推进')
  }
  localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint))
  localStorage.removeItem(OUTBOX_KEY)
}

export function loadCheckpoint(): Checkpoint | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY)
    return raw ? (JSON.parse(raw) as Checkpoint) : null
  } catch {
    return null
  }
}

export function loadOutbox(): unknown[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    return raw ? (JSON.parse(raw) as unknown[]) : []
  } catch {
    return []
  }
}

export function clearTimelineStorage(): void {
  localStorage.removeItem(CHECKPOINT_KEY)
  localStorage.removeItem(OUTBOX_KEY)
  localStorage.removeItem('gsb64:haccp-platform')
}
