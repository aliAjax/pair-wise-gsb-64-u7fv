import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import { seedAudit, seedBatches, seedDeviations, seedLimitVersions, seedPendingReadings, processSteps } from '../data/seed'
import { currentVersion, evaluate, advanceCheckpoint, isExpired, loadCheckpoint, loadOutbox, nextId, nowIso, persistOutbox, versionAt } from '../services/timeline'
import type {
  AuditEntry, Batch, BatchStatus, Deviation, DeviationRevision, DeviationStatus, Investigation,
  LimitRule, LimitVersion, MonitoringValue, PendingReading, ProcessStep, SubmissionSlot, TimelineEvent, TimelineMeta
} from '../types'

interface HaccpState {
  batches: Batch[]
  deviations: Deviation[]
  processSteps: ProcessStep[]
  limitVersions: LimitVersion[]
  pendingReadings: PendingReading[]
  submissionSlots: SubmissionSlot[]
  audit: AuditEntry[]
  outbox: TimelineEvent[]
  timeline: TimelineMeta
  batchFilter: string
  batchStatus: BatchStatus | '全部'
  selectedBatchId: string | null
}

export const CHECKPOINT_KEY = 'gsb64:timeline-checkpoint'

/* ---------------- 事件载荷 ---------------- */

type PublishLimitPayload = { stepId: string; label: string; frequency: string; correctiveAction: string; rule: LimitRule | null; effectiveFrom: string; operator: string }
type ReadingAddedPayload = { batchId: string; reading: MonitoringValue; concurrentRival: boolean; rivalWindowId: string | null }
type PendingEnqueuedPayload = PendingReading
type PendingResolvedPayload = { pendingId: string; approved: boolean; basisVersionId: string | null; judge: string; note: string; createDeviation: boolean }
type ReadingRejudgedPayload = { batchId: string; readingId: string; basisVersionId: string; judge: string; note: string }
type DeviationCreatedPayload = Omit<Deviation, 'investigation' | 'reviewNote' | 'reviewer' | 'version'>
type InvestigationSavedPayload = { id: string; investigation: Investigation }
type DeviationReviewedPayload = { id: string; approved: boolean; note: string; reviewer: string }
type DeviationRejudgedPayload = { id: string; basisVersionId: string; judge: string; note: string }
type BatchStatusPayload = { id: string; status: BatchStatus }

export function seedState(): HaccpState {
  return {
    batches: structuredClone(seedBatches),
    deviations: structuredClone(seedDeviations),
    processSteps: structuredClone(processSteps),
    limitVersions: structuredClone(seedLimitVersions),
    pendingReadings: structuredClone(seedPendingReadings),
    submissionSlots: [],
    audit: structuredClone(seedAudit),
    outbox: [],
    timeline: { checkpointAt: null, seq: Math.max(...seedAudit.map((item) => item.timelineSeq)), lastRecovered: 0 },
    batchFilter: '',
    batchStatus: '全部',
    selectedBatchId: seedBatches[0].id
  }
}

function stepNameOf(state: HaccpState, stepId: string): string {
  return state.processSteps.find((item) => item.id === stepId)?.name ?? stepId
}

function pushAudit(state: HaccpState, event: TimelineEvent, action: string, entity: string, detail: string, versionId?: string, recovered = false) {
  state.audit.unshift({ id: `AUD-${event.seq}`, entity, action, operator: event.operator, detail, createdAt: event.at, versionId, timelineSeq: event.seq, recovered })
}

/* ---------------- 时间线事件应用（纯函数；启动恢复与跨窗口同步重放同一套逻辑） ---------------- */

function applyEvent(state: HaccpState, event: TimelineEvent, recovered = false) {
  switch (event.type) {
    case 'LIMIT_PUBLISHED': {
      const payload = event.payload as PublishLimitPayload
      const old = state.limitVersions
        .filter((item) => item.stepId === payload.stepId && item.effectiveTo === null)
        .sort((a, b) => b.revision - a.revision)[0]
      if (old) old.effectiveTo = payload.effectiveFrom
      const revision = (old?.revision ?? 0) + 1
      const version: LimitVersion = {
        id: nextId('LV'), stepId: payload.stepId, revision, label: payload.label, frequency: payload.frequency,
        correctiveAction: payload.correctiveAction, rule: payload.rule, effectiveFrom: payload.effectiveFrom,
        effectiveTo: null, publishedAt: event.at, operator: event.operator, supersedes: old?.id ?? null, recovered
      }
      state.limitVersions.push(version)
      const step = state.processSteps.find((item) => item.id === payload.stepId)
      if (step) { step.limit = payload.label; step.frequency = payload.frequency; step.correctiveAction = payload.correctiveAction }
      // 关键限值更新后：生效时点之前、且尚未重判的旧读数先失效（原判定存 prior），再按记录时点选版
      let invalidated = 0
      for (const batch of state.batches) {
        for (const reading of batch.monitoring) {
          if (reading.stepId !== payload.stepId || reading.recordedAt >= payload.effectiveFrom) continue
          if (reading.status === '待核' || reading.status === '已驳回' || reading.status === '失效待重判') continue
          if (!reading.prior && reading.basisVersionId) {
            reading.prior = { basisVersionId: reading.basisVersionId, status: reading.status, judgedAt: reading.judgedAt ?? event.at }
          }
          reading.status = '失效待重判'
          reading.basisVersionId = old?.id ?? reading.basisVersionId
          reading.judgedAt = null
          invalidated += 1
        }
      }
      // 已判定偏差保留原版本与结论，只挂起复判标记
      let staleDeviations = 0
      for (const deviation of state.deviations) {
        if (deviation.stepId === payload.stepId && old && deviation.basisVersionId === old.id && deviation.status !== '已关闭') {
          deviation.basisStale = true
          staleDeviations += 1
        }
      }
      pushAudit(state, event, '限值版本生效', `${step?.name ?? payload.stepId} 控制点`,
        `V${revision}「${payload.label}」${payload.effectiveFrom.slice(5, 16).replace('T', ' ')} 起生效${old ? `，V${old.revision} 同步封闭` : ''}；${invalidated} 条生效前旧读数先失效待按记录时点重判，${staleDeviations} 项已判定偏差保留原结论待复判`,
        version.id, recovered)
      break
    }
    case 'READING_ADDED': {
      const payload = event.payload as ReadingAddedPayload
      const batch = state.batches.find((item) => item.id === payload.batchId)
      if (batch) batch.monitoring.push(payload.reading)
      const slotIndex = state.submissionSlots.findIndex((slot) => slot.stepId === payload.reading.stepId)
      const slot: SubmissionSlot = { stepId: payload.reading.stepId, windowId: payload.reading.windowId ?? 'W', readingId: payload.reading.id, submittedAt: event.at }
      if (slotIndex >= 0) state.submissionSlots[slotIndex] = slot
      else state.submissionSlots.push(slot)
      const v = payload.reading.basisVersionId ? state.limitVersions.find((item) => item.id === payload.reading.basisVersionId) : null
      pushAudit(state, event,
        payload.reading.rebased ? '监测读数（后到窗口重选依据）' : '监测读数录入',
        payload.batchId,
        `${stepNameOf(state, payload.reading.stepId)} ${payload.reading.value}${payload.reading.unit} @${payload.reading.recordedAt.slice(5, 16).replace('T', ' ')}，依据 ${v ? `V${v.revision}「${v.label}」` : '待人工绑定版本'}，判定${payload.reading.status}${payload.concurrentRival ? `；与窗口 ${payload.rivalWindowId ?? ''} 并发，后到一方已重新选版` : ''}`,
        v?.id, recovered)
      break
    }
    case 'PENDING_ENQUEUED': {
      const payload = event.payload as PendingEnqueuedPayload
      if (!state.pendingReadings.some((item) => item.id === payload.id)) state.pendingReadings.unshift(payload)
      const v = state.limitVersions.find((item) => item.id === payload.claimedVersionId)
      pushAudit(state, event, '晚到记录进入待核', payload.batchId,
        `${stepNameOf(state, payload.reading.stepId)} 补录 ${payload.reading.value}${payload.reading.unit}（记录于 ${payload.reading.recordedAt.slice(5, 16).replace('T', ' ')}）声称依据已失效的 V${v?.revision ?? '?'}，隔离待核，不改写既有结论`,
        payload.claimedVersionId, recovered)
      break
    }
    case 'PENDING_RESOLVED': {
      const payload = event.payload as PendingResolvedPayload
      const index = state.pendingReadings.findIndex((item) => item.id === payload.pendingId)
      if (index < 0) break
      const pending = state.pendingReadings[index]
      const batch = state.batches.find((item) => item.id === pending.batchId)
      if (!payload.approved) {
        pending.reading.status = '已驳回'
        pending.reading.judgedAt = event.at
        if (batch) batch.monitoring.push(pending.reading)
        pushAudit(state, event, '待核记录驳回', pending.batchId,
          `${stepNameOf(state, pending.reading.stepId)} 补录 ${pending.reading.value}${pending.reading.unit} 经核实不予采信，不影响批次既有结论`,
          pending.claimedVersionId, recovered)
      } else {
        const version = state.limitVersions.find((item) => item.id === payload.basisVersionId)
        const result = version ? evaluate(pending.reading, version) : null
        pending.reading.basisVersionId = payload.basisVersionId
        pending.reading.status = result?.status ?? '合格'
        pending.reading.judgedAt = event.at
        if (batch) batch.monitoring.push(pending.reading)
        pushAudit(state, event, '待核记录核定', pending.batchId,
          `${stepNameOf(state, pending.reading.stepId)} 补录 ${pending.reading.value}${pending.reading.unit} 核定依据 ${version ? `V${version.revision}「${version.label}」` : '人工判定'}，结论${pending.reading.status}；晚到补录单独存证，不回写原结论`,
          payload.basisVersionId ?? undefined, recovered)
        if (payload.createDeviation && pending.reading.status === '超限' && batch) {
          const id = nextId('DEV')
          const rev: DeviationRevision = {
            revision: 1, basisVersionId: payload.basisVersionId ?? '', basisLabel: version?.label ?? '人工判定',
            conclusion: `晚到补录核定超限：${pending.reading.value}${pending.reading.unit} 对照 ${version?.label ?? '限值'}`,
            decision: '返工', judgedAt: event.at, judge: event.operator, note: payload.note, origin: '限值复判'
          }
          state.deviations.unshift({
            id, batchId: batch.id, stepId: pending.reading.stepId, title: `晚到补录超限：${stepNameOf(state, pending.reading.stepId)}`,
            severity: '重大', status: '待调查', owner: event.operator, openedAt: event.at, dueDate: event.at.slice(0, 10),
            investigation: { cause: payload.note || '晚到现场补录，原因待查', evidence: `待核记录 ${pending.id}`, decision: '返工', reworkInstruction: '' },
            reviewNote: '', reviewer: '', version: 1, basisVersionId: payload.basisVersionId, basisStale: false, revisions: [rev]
          })
          // 晚到补录另立案，不回写原批次结论；仅在制批次才挂隔离
          if (batch.status !== '已放行' && batch.status !== '已报废') batch.status = '隔离中'
          pushAudit(state, event, '待核核定触发偏差', id, `补录 ${pending.reading.value}${pending.reading.unit} 超限，另立案调查，不回写旧结论`, payload.basisVersionId ?? undefined, recovered)
        }
      }
      state.pendingReadings.splice(index, 1)
      break
    }
    case 'READING_REJUDGED': {
      const payload = event.payload as ReadingRejudgedPayload
      const batch = state.batches.find((item) => item.id === payload.batchId)
      const reading = batch?.monitoring.find((item) => item.id === payload.readingId)
      if (!reading) break
      const version = state.limitVersions.find((item) => item.id === payload.basisVersionId)
      const result = version ? evaluate(reading, version) : null
      const status = result?.status ?? '合格'
      if (!reading.prior && reading.basisVersionId) {
        reading.prior = { basisVersionId: reading.basisVersionId, status: reading.status as '合格' | '超限', judgedAt: reading.judgedAt ?? event.at }
      }
      reading.basisVersionId = payload.basisVersionId
      reading.status = status
      reading.judgedAt = event.at
      reading.rejudged = true
      pushAudit(state, event, '旧读数按时点重判', payload.batchId,
        `${stepNameOf(state, reading.stepId)} ${reading.value}${reading.unit} 记录于 ${reading.recordedAt.slice(5, 16).replace('T', ' ')}，按该时点选 ${version ? `V${version.revision}「${version.label}」` : '人工判定'}，重判${status}（原${reading.prior?.status ?? '—'}结论留痕不变）${payload.note ? `；${payload.note}` : ''}`,
        payload.basisVersionId, recovered)
      break
    }
    case 'DEVIATION_CREATED': {
      const payload = event.payload as DeviationCreatedPayload
      state.deviations.unshift({ ...payload, investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }, reviewNote: '', reviewer: '', version: 1 })
      const batch = state.batches.find((item) => item.id === payload.batchId)
      if (batch) { batch.status = '隔离中'; batch.version += 1 }
      pushAudit(state, event, '创建偏差调查', payload.id, `批次${payload.batchId}因「${payload.title}」进入隔离，登记依据 ${payload.revisions[0] ? 'V' + (state.limitVersions.find((v) => v.id === payload.basisVersionId)?.revision ?? '?') : '待绑定'}`, payload.basisVersionId ?? undefined, recovered)
      break
    }
    case 'INVESTIGATION_SAVED': {
      const payload = event.payload as InvestigationSavedPayload
      const deviation = state.deviations.find((item) => item.id === payload.id)
      if (!deviation || !payload.investigation.cause.trim() || !payload.investigation.evidence.trim()) break
      deviation.investigation = payload.investigation
      deviation.status = '待复核'
      deviation.version += 1
      pushAudit(state, event, '提交偏差调查', deviation.id, `处置分支：${payload.investigation.decision}`, deviation.basisVersionId ?? undefined, recovered)
      break
    }
    case 'DEVIATION_REVIEWED': {
      const payload = event.payload as DeviationReviewedPayload
      const deviation = state.deviations.find((item) => item.id === payload.id)
      if (!deviation) break
      if (payload.approved && !payload.note.trim()) break
      deviation.reviewNote = payload.note
      deviation.reviewer = payload.reviewer
      deviation.status = payload.approved ? '已关闭' : '调查中'
      deviation.version += 1
      const batch = state.batches.find((item) => item.id === deviation.batchId)
      if (batch && payload.approved && !state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭' && item.id !== deviation.id)) {
        batch.status = deviation.investigation.decision === '报废' ? '已报废' : '待复核'
        batch.version += 1
      }
      pushAudit(state, event, payload.approved ? '复核通过' : '退回补证', deviation.id, payload.note || '退回调查', deviation.basisVersionId ?? undefined, recovered)
      break
    }
    case 'DEVIATION_REJUDGED': {
      const payload = event.payload as DeviationRejudgedPayload
      const deviation = state.deviations.find((item) => item.id === payload.id)
      if (!deviation) break
      const version = state.limitVersions.find((item) => item.id === payload.basisVersionId)
      const batch = state.batches.find((item) => item.id === deviation.batchId)
      const lastReading = batch?.monitoring
        .filter((item) => item.stepId === deviation.stepId && (item.status === '合格' || item.status === '超限'))
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]
      const result = version && lastReading ? evaluate(lastReading, version) : null
      const conclusion = version && lastReading && result
        ? `${lastReading.value}${lastReading.unit} 对照 V${version.revision}「${version.label}」复判为${result.status}`
        : `按 V${version?.revision ?? ''}「${version?.label ?? '人工判定'}」复判${payload.note ? '；' + payload.note : '，结论另存'}`
      const rev: DeviationRevision = {
        revision: deviation.revisions.length + 1,
        basisVersionId: payload.basisVersionId,
        basisLabel: version?.label ?? '人工判定',
        conclusion,
        decision: deviation.investigation.decision,
        judgedAt: event.at,
        judge: event.operator,
        note: payload.note || '限值更新后按记录时点复判；原判定版本与结论保留',
        origin: '限值复判'
      }
      deviation.revisions.push(rev)
      deviation.version += 1
      deviation.basisStale = false
      const first = deviation.revisions[0]
      pushAudit(state, event, '偏差限值复判', deviation.id,
        `复判另存第 ${rev.revision} 版（依据 V${version?.revision ?? '?'}）；原版「${first.conclusion.slice(0, 24)}…」原样保留`,
        payload.basisVersionId, recovered)
      break
    }
    case 'BATCH_STATUS': {
      const payload = event.payload as BatchStatusPayload
      const batch = state.batches.find((item) => item.id === payload.id)
      if (!batch) break
      const blocking = state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭')
      if (payload.status === '可放行' && blocking) break
      batch.status = payload.status
      batch.version += 1
      pushAudit(state, event, '批次状态流转', batch.id, `状态更新为${payload.status}`, undefined, recovered)
      break
    }
  }
}

/* ---------------- 持久化恢复 ---------------- */

/** 从最后完整检查点重建；检查点之后只补未完成（待写队列）记录 */
export function buildStateFromStorage(countRecovery: boolean): HaccpState | null {
  const checkpoint = loadCheckpoint()
  if (!checkpoint) return null
  const pending = loadOutbox() as TimelineEvent[]
  const base = checkpoint.state as HaccpState
  base.outbox = pending
  base.timeline.lastRecovered = 0
  const appliedAt = new Set((checkpoint.events as TimelineEvent[]).map((item) => item.id))
  for (const event of [...pending].sort((a, b) => a.seq - b.seq)) {
    if (appliedAt.has(event.id)) continue
    applyEvent(base, event, true)
    // 游标跟随待补事件推进，避免恢复后新事件与已补事件撞号
    base.timeline.seq = Math.max(base.timeline.seq, event.seq)
    if (countRecovery) base.timeline.lastRecovered += 1
  }
  return base
}

function initialState(): HaccpState {
  return buildStateFromStorage(true) ?? seedState()
}

const slice = createSlice({
  name: 'haccp',
  initialState,
  reducers: {
    setBatchFilter(state, action: PayloadAction<string>) { state.batchFilter = action.payload },
    setBatchStatus(state, action: PayloadAction<BatchStatus | '全部'>) { state.batchStatus = action.payload },
    setSelectedBatch(state, action: PayloadAction<string | null>) { state.selectedBatchId = action.payload },
    /** 以一份完整时间线整体替换内存状态（提交回执 / 跨窗口同步共用） */
    hydrate(state, action: PayloadAction<HaccpState>) {
      const incoming = action.payload
      return { ...incoming, batchFilter: state.batchFilter, batchStatus: state.batchStatus, selectedBatchId: state.selectedBatchId }
    },
    outboxFlushed(state, action: PayloadAction<string>) {
      state.outbox = []
      state.timeline.checkpointAt = action.payload
    },
    resetDemo() {
      return seedState()
    }
  }
})

/* ---------------- 统一写入：事件先入待写队列，再推进检查点 ---------------- */

function scrub(state: HaccpState): HaccpState {
  return { ...state, batchFilter: '', batchStatus: '全部', outbox: [] }
}

function commit(type: TimelineEvent['type'], payload: unknown, operator: string, at: string) {
  return (dispatch: (a: unknown) => void, getState: () => { haccp: HaccpState }) => {
    const state = getState().haccp
    const seq = state.timeline.seq + 1
    const event: TimelineEvent = { id: nanoid(), seq, type, at, operator, payload }
    const draft: HaccpState = structuredClone({ ...state, outbox: [...state.outbox, event], timeline: { ...state.timeline, seq } })
    applyEvent(draft, event)
    let ok = true
    try {
      // 第一阶段：未完成事件先落入待写队列（WAL），保证刷新/重开仍可恢复
      persistOutbox(draft.outbox)
      // 第二阶段：推进到新的完整时间线并清空 WAL
      advanceCheckpoint({ state: scrub(draft), events: [], at })
      draft.outbox = []
      draft.timeline.checkpointAt = at
    } catch {
      // 检查点未推进：内存保留待完成记录，各入口看到「待补写」关系
      ok = false
    }
    dispatch(slice.actions.hydrate(draft))
    return { ok, event }
  }
}

/* ---------------- 对外动作 ---------------- */

export function publishLimitVersion(input: PublishLimitPayload) {
  return commit('LIMIT_PUBLISHED', input, input.operator, input.effectiveFrom)
}

export interface ReadingInput {
  batchId: string
  stepId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
  windowId: string
  /** 录入员显式选择的依据版本；缺省按记录时点自动选版 */
  chosenVersionId?: string
  /** 无结构化规则（如金属粒径组合限值）时的人工判定 */
  manualStatus?: '合格' | '超限'
  /** 已经历并发仲裁、重新选择依据后的提交 */
  rebased?: boolean
}

export interface ReadingSubmitResult {
  ok: boolean
  enqueued?: boolean
  /** 与另一窗口并发：后到一方须重新选择依据 */
  conflict?: boolean
  rivalWindowId?: string | null
  suggestedVersionId?: string | null
}

export function addMonitoringReading(input: ReadingInput): (dispatch: (a: unknown) => void, getState: () => { haccp: HaccpState }) => ReadingSubmitResult {
  return (dispatch, getState) => {
    const state = getState().haccp
    const at = nowIso()
    const chosen = input.chosenVersionId ? state.limitVersions.find((item) => item.id === input.chosenVersionId) ?? null : null
    const byTime = versionAt(state.limitVersions, input.stepId, input.recordedAt)
    const basis = chosen ?? byTime

    // 晚到现场补录：声称/选定时点的版本在提交时已失效 → 待核队列，不能直接改写结论
    if (basis && isExpired(basis, at)) {
      const pending: PendingReading = {
        id: nextId('PEND'),
        batchId: input.batchId,
        claimedVersionId: basis.id,
        reason: `现场补录晚到：记录时点 ${input.recordedAt.slice(5, 16).replace('T', ' ')}，提交时点 ${at.slice(5, 16).replace('T', ' ')}，依据 V${basis.revision} 已失效，待质量员核实选版`,
        submittedAt: at,
        windowId: input.windowId,
        reading: {
          id: nextId('M'), stepId: input.stepId, value: input.value, unit: input.unit,
          recordedAt: input.recordedAt, operator: input.operator, submittedAt: at,
          windowId: input.windowId, status: '待核', basisVersionId: null, judgedAt: null
        }
      }
      const r = dispatch(commit('PENDING_ENQUEUED', pending, input.operator, at)) as unknown as { ok: boolean }
      return { ok: r.ok, enqueued: true }
    }

    // 两个窗口同时提交同一控制点：槽位已被另一窗口占据 → 后到一方先停下重新选版
    const slot = state.submissionSlots.find((item) => item.stepId === input.stepId)
    if (!input.rebased && slot && slot.windowId !== input.windowId) {
      return { ok: true, conflict: true, rivalWindowId: slot.windowId, suggestedVersionId: basis?.id ?? null }
    }

    const engineResult = basis ? evaluate({ value: input.value }, basis) : null
    const reading: MonitoringValue = {
      id: nextId('M'), stepId: input.stepId, value: input.value, unit: input.unit,
      recordedAt: input.recordedAt, operator: input.operator, submittedAt: at, windowId: input.windowId,
      status: input.manualStatus ?? engineResult?.status ?? '合格',
      basisVersionId: basis?.id ?? null,
      judgedAt: basis ? at : null,
      rebased: input.rebased === true && !!slot && slot.windowId !== input.windowId
    }
    const rival = input.rebased && slot && slot.windowId !== input.windowId ? slot.windowId : null
    const r = dispatch(commit('READING_ADDED', { batchId: input.batchId, reading, concurrentRival: rival !== null, rivalWindowId: rival } satisfies ReadingAddedPayload, input.operator, at)) as unknown as { ok: boolean }
    return { ok: r.ok }
  }
}

export function rejudgeReading(batchId: string, readingId: string, basisVersionId: string, judge: string, note: string) {
  return commit('READING_REJUDGED', { batchId, readingId, basisVersionId, judge, note }, judge, nowIso())
}

export function resolvePendingReading(pendingId: string, approved: boolean, basisVersionId: string | null, judge: string, note: string, createDeviation: boolean) {
  return commit('PENDING_RESOLVED', { pendingId, approved, basisVersionId, judge, note, createDeviation }, judge, nowIso())
}

export function createDeviation(input: { batchId: string; stepId: string; title: string; severity: '一般' | '重大'; owner: string; basisVersionId?: string | null }) {
  return (dispatch: (a: unknown) => void, getState: () => { haccp: HaccpState }) => {
    const state = getState().haccp
    const batch = state.batches.find((item) => item.id === input.batchId)
    // 按该控制点最新记录时点选版，保证登记依据与读数判定同版
    const latestReading = batch?.monitoring
      .filter((m) => m.stepId === input.stepId && m.recordedAt)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]
    const explicit = input.basisVersionId ? state.limitVersions.find((item) => item.id === input.basisVersionId) ?? null : null
    const basis = explicit
      ?? (latestReading ? versionAt(state.limitVersions, input.stepId, latestReading.recordedAt) : null)
      ?? currentVersion(state.limitVersions, input.stepId)
    const now = nowIso()
    const payload: DeviationCreatedPayload = {
      id: nextId('DEV'),
      batchId: input.batchId,
      stepId: input.stepId,
      title: input.title,
      severity: input.severity,
      status: '待调查',
      owner: input.owner,
      openedAt: now,
      dueDate: now.slice(0, 10),
      basisVersionId: basis?.id ?? null,
      basisStale: basis ? isExpired(basis, now) : false,
      revisions: basis
        ? [{ revision: 1, basisVersionId: basis.id, basisLabel: basis.label, conclusion: input.title, decision: '返工', judgedAt: now, judge: input.owner, note: '登记时按记录时点绑定的限值版本', origin: '原判定' }]
        : []
    }
    return dispatch(commit('DEVIATION_CREATED', payload, input.owner, now))
  }
}

export function saveInvestigation(id: string, investigation: Investigation) {
  return commit('INVESTIGATION_SAVED', { id, investigation }, '当前用户', nowIso())
}
export function reviewDeviation(id: string, approved: boolean, note: string, reviewer: string) {
  return commit('DEVIATION_REVIEWED', { id, approved, note, reviewer }, reviewer, nowIso())
}
export function rejudgeDeviation(id: string, basisVersionId: string, judge: string, note: string) {
  return commit('DEVIATION_REJUDGED', { id, basisVersionId, judge, note }, judge, nowIso())
}
export function updateBatchStatus(id: string, status: BatchStatus): ReturnType<typeof commit>
export function updateBatchStatus(input: { id: string; status: BatchStatus }): ReturnType<typeof commit>
export function updateBatchStatus(arg: string | { id: string; status: BatchStatus }, maybeStatus?: BatchStatus) {
  const id = typeof arg === 'string' ? arg : arg.id
  const status = typeof arg === 'string' ? maybeStatus! : arg.status
  return commit('BATCH_STATUS', { id, status }, '质量主管', nowIso())
}

/** 重试落盘：内存中的完整时间线已含未完成记录，成功后清空待写队列、推进检查点 */
export function retryFlush() {
  return (dispatch: (a: unknown) => void, getState: () => { haccp: HaccpState }) => {
    const state = getState().haccp
    const at = nowIso()
    try {
      // 内存中的完整时间线已包含全部未完成记录：直接推进检查点并清空 WAL
      advanceCheckpoint({ state: scrub({ ...state }), events: [], at })
      dispatch(slice.actions.outboxFlushed(at))
      return { ok: true as const }
    } catch {
      return { ok: false as const }
    }
  }
}

/** 恢复演示数据：重写检查点，避免下次加载被旧时间线覆盖 */
export function resetDemoData() {
  return (dispatch: (a: unknown) => void) => {
    const fresh = seedState()
    try {
      advanceCheckpoint({ state: scrub(fresh), events: [], at: nowIso() })
    } catch {
      // 存储不可用时仅重置内存
    }
    dispatch(slice.actions.resetDemo())
  }
}

export const { setBatchFilter, setBatchStatus, setSelectedBatch, hydrate, resetDemo } = slice.actions
export type { DeviationStatus }
export default slice.reducer
