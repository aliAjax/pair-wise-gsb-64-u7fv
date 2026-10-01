import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import { seedAudit, seedBatches, seedCheckpoints, seedDeviations, limitVersions as seedLimitVersions, seedWriteBatches, processSteps } from '../data/seed'
import { digest, judgeValue, parseLimitText, versionAt } from '../services/versioning'
import type {
  AuditEntry, Batch, BatchStatus, Deviation, DeviationRevision, DeviationStatus,
  EntryConflict, Investigation, LimitVersion, MonitoringValue, ProcessStep,
  TimelineCheckpoint, WriteBatch
} from '../types'

interface HaccpState {
  batches: Batch[]
  deviations: Deviation[]
  processSteps: ProcessStep[]
  limitVersions: LimitVersion[]
  audit: AuditEntry[]
  writeBatches: WriteBatch[]
  checkpoints: TimelineCheckpoint[]
  entryConflicts: EntryConflict[]
  batchFilter: string
  batchStatus: BatchStatus | '全部'
  selectedBatchId: string | null
}

const STORAGE_KEY = 'gsb64:haccp-platform:v2'

function seedState() {
  return {
    batches: structuredClone(seedBatches), deviations: structuredClone(seedDeviations),
    processSteps: structuredClone(processSteps), limitVersions: structuredClone(seedLimitVersions),
    audit: structuredClone(seedAudit), writeBatches: structuredClone(seedWriteBatches),
    checkpoints: structuredClone(seedCheckpoints), entryConflicts: [] as EntryConflict[],
    batchFilter: '', batchStatus: '全部' as const, selectedBatchId: seedBatches[0].id
  }
}

function initialState(): HaccpState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // 与旧版本地数据合并，补齐生效时间线相关结构
      return { ...seedState(), ...parsed }
    }
  } catch {
    // Seed data remains available when local storage is unavailable or corrupt.
  }
  return seedState()
}

function log(state: HaccpState, entry: Omit<AuditEntry, 'id' | 'createdAt'> & { createdAt?: string }) {
  state.audit.unshift({ id: nanoid(), createdAt: entry.createdAt ?? new Date().toISOString(), ...entry })
}

/** 对某控制点全部未锁定读数按记录时点重新选版判定 */
function rejudgeStep(state: HaccpState, stepId: string, publishedAt: string) {
  for (const batch of state.batches) {
    for (const reading of batch.monitoring) {
      if (reading.stepId !== stepId || reading.locked) continue
      // 第一步：旧依据先失效
      const previousBasis = reading.basisVersionId
      const previousVerdict = reading.judgeStatus === '合格' || reading.judgeStatus === '超限' ? reading.judgeStatus : null
      reading.basisVersionId = null
      reading.judgeStatus = '待重判'
      // 第二步：按记录时点在时间线上选版
      const basis = versionAt(state.limitVersions, stepId, reading.recordedAt)
      if (!basis) {
        reading.judgeStatus = '待核'
        reading.pendingReason = `记录时点${reading.recordedAt.slice(5, 16)}早于该控制点首个生效版本，无法选版`
        continue
      }
      const verdict = judgeValue(reading.value, basis.spec)
      reading.basisVersionId = basis.id
      reading.judgeStatus = verdict
      reading.pendingReason = ''
      const basisChanged = previousBasis !== basis.id
      const verdictChanged = previousVerdict !== verdict
      if (previousBasis && (basisChanged || verdictChanged)) {
        reading.rejudgedAt = publishedAt
        log(state, {
          entity: reading.id, action: '旧读数失效后复判', operator: '系统时间线引擎', category: '监测判定', versionRef: basis.id,
          detail: `记录时点${reading.recordedAt.slice(5, 16)}选版${stepName(state, stepId)} V${basis.versionNo}（${basis.spec.text}），结论由${previousVerdict ?? '未判定'}变为${verdict}${basisChanged ? `（依据由${previousBasis}切换至${basis.id}）` : '（依据版本内限值收紧）'}`,
          createdAt: publishedAt
        })
        // 复判翻转为超限且尚无关联偏差：自动登记偏差，初判即为当前版本
        if (verdict === '超限' && !state.deviations.some((item) => item.readingId === reading.id && item.status !== '已关闭')) {
          autoOpenDeviation(state, batch, reading, basis, publishedAt, '限值更新复判')
        }
      }
    }
  }
}

function autoOpenDeviation(state: HaccpState, batch: Batch, reading: MonitoringValue, basis: LimitVersion, at: string, source: string) {
  const revision: DeviationRevision = {
    revisionNo: 1, basisVersionId: basis.id, limitText: basis.spec.text, readingValue: reading.value,
    unit: reading.unit, verdict: '超限', note: `${source}：${reading.recordedAt.slice(5, 16)}读数${reading.value}${reading.unit}超出V${basis.versionNo}限值${basis.spec.text}`,
    decidedAt: at, operator: source === '限值更新复判' ? '系统时间线引擎' : reading.operator, source: '初判', confirmed: false
  }
  const deviation: Deviation = {
    id: `DEV-${Date.now().toString().slice(-6)}-${nanoid(4)}`, batchId: batch.id, stepId: reading.stepId, readingId: reading.id,
    title: `${basis.id.startsWith('LV-P4') ? '封口压力' : '关键限值'}超限（${reading.value}${reading.unit} vs ${basis.spec.text}）`,
    severity: '重大', status: '待调查', owner: '质量工程组', openedAt: at,
    dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), version: 1,
    investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' },
    reviewNote: '', reviewer: '', revisions: [revision]
  }
  reading.locked = true
  state.deviations.unshift(deviation)
  if (batch.status === '生产中') batch.status = '隔离中'
  batch.version += 1
  log(state, { entity: deviation.id, action: '创建偏差调查', operator: revision.operator, category: '偏差处置', versionRef: basis.id, detail: revision.note, createdAt: at })
}

function allReadings(state: HaccpState): MonitoringValue[] {
  return state.batches.flatMap((batch) => batch.monitoring)
}

function checkpointDigest(previous: TimelineCheckpoint | undefined, readingIds: string[], writeBatchIds: string[], label: string, createdAt: string) {
  return digest(previous?.digest ?? 'GENESIS', readingIds.slice().sort().join(','), writeBatchIds.slice().sort().join(','), label, createdAt)
}

function appendCheckpoint(state: HaccpState, label: string, createdAt: string) {
  const readingIds = allReadings(state).map((item) => item.id)
  const writeBatchIds = state.writeBatches.filter((item) => item.status === 'completed').map((item) => item.id)
  const checkpoint: TimelineCheckpoint = {
    id: `CP-${nanoid(6)}`, label, createdAt, readingIds, writeBatchIds,
    digest: checkpointDigest(state.checkpoints[state.checkpoints.length - 1], readingIds, writeBatchIds, label, createdAt)
  }
  state.checkpoints.push(checkpoint)
  return checkpoint
}

const slice = createSlice({
  name: 'haccp',
  initialState,
  reducers: {
    setBatchFilter(state, action: PayloadAction<string>) { state.batchFilter = action.payload },
    setBatchStatus(state, action: PayloadAction<BatchStatus | '全部'>) { state.batchStatus = action.payload },
    setSelectedBatch(state, action: PayloadAction<string | null>) { state.selectedBatchId = action.payload },

    /** 发布关键限值新版本：旧版标记失效，未锁定旧读数先失效再按记录时点选版复判 */
    publishLimitVersion(state, action: PayloadAction<{ stepId: string; limitText: string; frequency: string; correctiveAction: string; effectiveAt: string; operator: string; changeNote: string }>) {
      const payload = action.payload
      const step = state.processSteps.find((item) => item.id === payload.stepId)
      if (!step) return
      const line = state.limitVersions.filter((item) => item.stepId === payload.stepId)
      const now = new Date().toISOString()
      const versionNo = line.length + 1
      const version: LimitVersion = {
        id: `LV-${payload.stepId}-${versionNo}-${nanoid(4)}`, stepId: payload.stepId, versionNo,
        spec: parseLimitText(payload.limitText, line[0]?.spec.unit ?? ''),
        frequency: payload.frequency, correctiveAction: payload.correctiveAction,
        effectiveAt: payload.effectiveAt, publishedAt: now,
        operator: payload.operator, changeNote: payload.changeNote, supersededAt: null
      }
      for (const old of line) old.supersededAt = version.publishedAt
      state.limitVersions.push(version)
      step.limit = payload.limitText
      step.frequency = payload.frequency
      step.correctiveAction = payload.correctiveAction
      rejudgeStep(state, payload.stepId, now)
      appendCheckpoint(state, `${step.name}限值V${versionNo}发布检查点`, now)
      log(state, {
        entity: `${step.name}`, action: '限值版本发布', operator: payload.operator, category: '限值版本', versionRef: version.id,
        detail: `V${versionNo}（${payload.limitText}）生效时间${payload.effectiveAt.replace('T', ' ').slice(0, 16)}，替代V${versionNo - 1}；已锁定偏差/放行结论保留原版本，其余读数先失效再按记录时点选版复判`
      })
    },

    /** 现场补录/窗口提交监测读数；可模拟写入中途失败 */
    submitMonitoring(state, action: PayloadAction<{
      batchId: string; stepId: string; value: number; unit: string; recordedAt: string
      operator: string; claimedBasisVersionId?: string | null; simulateFailure?: boolean
    }>) {
      const payload = action.payload
      const batch = state.batches.find((item) => item.id === payload.batchId)
      if (!batch) return
      const now = new Date().toISOString()
      const clientId = `CID-${nanoid(10)}`
      const timepointBasis = versionAt(state.limitVersions, payload.stepId, payload.recordedAt)
      const claimed = payload.claimedBasisVersionId ?? null

      // 两个窗口同时提交同一控制点：记录时点重合（±60秒）视为同一读数的并发提交
      const clash = batch.monitoring.find((item) =>
        item.stepId === payload.stepId && item.judgeStatus !== '待核' &&
        Math.abs(new Date(item.recordedAt).getTime() - new Date(payload.recordedAt).getTime()) <= 60000)
      if (clash) {
        const conflict: EntryConflict = {
          id: `CFL-${nanoid(6)}`, batchId: payload.batchId, stepId: payload.stepId,
          existingBasisVersionId: clash.basisVersionId ?? '(未选版)', existingRecordedAt: clash.recordedAt, existingEnteredAt: clash.enteredAt,
          requestedBasisVersionId: claimed ?? timepointBasis?.id ?? '(无可用版本)',
          value: payload.value, unit: payload.unit, recordedAt: payload.recordedAt, operator: payload.operator, enteredAt: now
        }
        state.entryConflicts.unshift(conflict)
        log(state, { entity: `${payload.batchId}/${payload.stepId}`, action: '并发提交冲突', operator: payload.operator, category: '监测判定', versionRef: null, detail: `后到窗口与已提交读数（${clash.id}，${clash.recordedAt.slice(11, 16)}）为同一控制点同一时点，挂起待后到一方重新选择依据` })
        return
      }

      const needsReview = (claimed && claimed !== timepointBasis?.id) || !timepointBasis
      const record: MonitoringValue = {
        id: `${payload.batchId}:R-${nanoid(6)}`, stepId: payload.stepId, value: payload.value, unit: payload.unit,
        recordedAt: payload.recordedAt, enteredAt: now, operator: payload.operator,
        basisVersionId: needsReview ? (claimed ?? timepointBasis?.id ?? null) : timepointBasis!.id,
        claimedBasisVersionId: claimed, judgeStatus: needsReview ? '待核' : judgeValue(payload.value, timepointBasis!.spec),
        locked: false, pendingReason: '', writeBatchId: null, clientId
      }
      if (!timepointBasis) record.pendingReason = `记录时点${payload.recordedAt.replace('T', ' ').slice(0, 16)}早于该控制点首个生效版本，无可选依据`
      else if (needsReview) {
        const claimedVersion = state.limitVersions.find((item) => item.id === claimed)
        record.pendingReason = `晚到补录：现场声称依据${claimedVersion ? `V${claimedVersion.versionNo}（${claimedVersion.spec.text}）` : '未知版本'}，按记录时点应选V${timepointBasis.versionNo}（${timepointBasis.spec.text}），结论可能不同，待质量核选`
      }

      const intended: MonitoringValue[] = [record]
      const writeBatchId = `WB-${nanoid(6)}`
      record.writeBatchId = writeBatchId
      if (payload.simulateFailure) {
        // 写入中途失败：记录未落库，写入批次保留待补内容，恢复时只补未完成记录
        state.writeBatches.unshift({ id: writeBatchId, batchId: payload.batchId, submittedAt: now, operator: payload.operator, clientIds: intended.map((item) => item.clientId), status: 'failed', completedCount: 0, note: `写入失败：${record.id}未落库，等待从最后完整时间线检查点恢复` , records: intended })
        log(state, { entity: writeBatchId, action: '写入失败', operator: payload.operator, category: '写入恢复', versionRef: null, detail: `${payload.batchId}补录${stepName(state, payload.stepId)}读数时连接中断，0/1条完成；未产生新检查点，结论未被改写` })
        return
      }

      batch.monitoring.push(record)
      batch.version += 1
      state.writeBatches.unshift({ id: writeBatchId, batchId: payload.batchId, submittedAt: now, operator: payload.operator, clientIds: [clientId], status: 'completed', completedCount: 1, note: needsReview ? '晚到补录：依据版本存疑，读数进入待核队列' : '写入完整，已建立时间线检查点' })
      if (record.judgeStatus === '超限') {
        const basis = state.limitVersions.find((item) => item.id === record.basisVersionId)!
        autoOpenDeviation(state, batch, record, basis, now, '现场监测')
      }
      appendCheckpoint(state, `${payload.batchId}补录检查点`, now)
      log(state, {
        entity: record.id, action: needsReview ? '晚到记录待核' : '监测读数写入', operator: payload.operator, category: '监测判定',
        versionRef: record.basisVersionId,
        detail: needsReview ? record.pendingReason : `按记录时点${payload.recordedAt.replace('T', ' ').slice(0, 16)}选版判定为${record.judgeStatus}`
      })
    },

    /** 待核队列：质量人员确认按哪一版作为依据，确认后才产生结论，不改写既有结论 */
    resolvePendingReading(state, action: PayloadAction<{ readingId: string; basisVersionId: string; note: string; operator: string }>) {
      const reading = allReadings(state).find((item) => item.id === action.payload.readingId)
      const batch = state.batches.find((item) => item.monitoring.some((record) => record.id === reading?.id))
      if (!reading || !batch) return
      const basis = state.limitVersions.find((item) => item.id === action.payload.basisVersionId)
      if (!basis) return
      const verdict = judgeValue(reading.value, basis.spec)
      reading.basisVersionId = basis.id
      reading.judgeStatus = verdict
      reading.pendingReason = ''
      reading.claimedBasisVersionId = null
      batch.version += 1
      log(state, { entity: reading.id, action: '待核记录核选', operator: action.payload.operator, category: '监测判定', versionRef: basis.id, detail: `核选依据V${basis.versionNo}（${basis.spec.text}），判定为${verdict}。${action.payload.note}` })
      if (verdict === '超限' && !state.deviations.some((item) => item.readingId === reading.id && item.status !== '已关闭')) {
        autoOpenDeviation(state, batch, reading, basis, new Date().toISOString(), '待核后判定')
      }
      appendCheckpoint(state, `${reading.id}待核核选检查点`, new Date().toISOString())
    },

    /** 并发冲突：后到一方在冲突面板重新选择依据后完成提交 */
    resolveEntryConflict(state, action: PayloadAction<{ conflictId: string; basisVersionId: string; operator: string }>) {
      const index = state.entryConflicts.findIndex((item) => item.id === action.payload.conflictId)
      if (index < 0) return
      const conflict = state.entryConflicts[index]
      const batch = state.batches.find((item) => item.id === conflict.batchId)
      const basis = state.limitVersions.find((item) => item.id === action.payload.basisVersionId)
      if (!batch || !basis) return
      const now = new Date().toISOString()
      const verdict = judgeValue(conflict.value, basis.spec)
      const record: MonitoringValue = {
        id: `${conflict.batchId}:R-${nanoid(6)}`, stepId: conflict.stepId, value: conflict.value, unit: conflict.unit,
        recordedAt: conflict.recordedAt, enteredAt: now, operator: `${conflict.operator}（冲突改选）`,
        basisVersionId: basis.id, claimedBasisVersionId: null, judgeStatus: verdict, locked: false, pendingReason: '',
        writeBatchId: null, clientId: `CID-${nanoid(10)}`
      }
      batch.monitoring.push(record)
      batch.version += 1
      state.entryConflicts.splice(index, 1)
      log(state, { entity: record.id, action: '并发冲突改选依据', operator: action.payload.operator, category: '监测判定', versionRef: basis.id, detail: `后到窗口放弃原依据，重新选择V${basis.versionNo}（${basis.spec.text}），判定为${verdict}；先到读数${conflict.existingRecordedAt.slice(11, 16)}保持不变` })
      if (verdict === '超限' && !state.deviations.some((item) => item.readingId === record.id && item.status !== '已关闭')) {
        autoOpenDeviation(state, batch, record, basis, now, '并发改选后判定')
      }
      appendCheckpoint(state, `${record.id}冲突解除检查点`, now)
    },

    dismissEntryConflict(state, action: PayloadAction<{ conflictId: string }>) {
      state.entryConflicts = state.entryConflicts.filter((item) => item.id !== action.payload.conflictId)
    },

    /** 从最后完整时间线检查点恢复：只补未完成记录，已完成记录不重写 */
    recoverWrites(state) {
      const failed = state.writeBatches.filter((item) => item.status === 'failed')
      if (failed.length === 0) return
      const existingClientIds = new Set([
        ...allReadings(state).map((item) => item.clientId),
        ...state.writeBatches.filter((item) => item.status === 'completed').flatMap((item) => item.clientIds)
      ])
      const now = new Date().toISOString()
      let repaired = 0
      for (const writeBatch of failed) {
        const batch = state.batches.find((item) => item.id === writeBatch.batchId)
        if (!batch) continue
        for (const record of writeBatch.records ?? []) {
          if (existingClientIds.has(record.clientId)) continue // 只补未完成记录
          const basis = versionAt(state.limitVersions, record.stepId, record.recordedAt)
          const needsReview = (record.claimedBasisVersionId && record.claimedBasisVersionId !== basis?.id) || !basis
          record.enteredAt = now
          record.basisVersionId = needsReview ? (record.claimedBasisVersionId ?? basis?.id ?? null) : basis!.id
          record.judgeStatus = needsReview ? '待核' : judgeValue(record.value, basis!.spec)
          if (needsReview && !record.pendingReason) record.pendingReason = '恢复后依据版本仍需核选'
          batch.monitoring.push(record)
          existingClientIds.add(record.clientId)
          repaired += 1
          log(state, { entity: record.id, action: '断点恢复补写', operator: '系统恢复任务', category: '写入恢复', versionRef: record.basisVersionId, detail: `从最后完整检查点${state.checkpoints[state.checkpoints.length - 1]?.id ?? '-'}恢复，仅补写未落库记录；结论${record.judgeStatus}` })
          if (record.judgeStatus === '超限' && !state.deviations.some((item) => item.readingId === record.id && item.status !== '已关闭')) {
            const chosen = state.limitVersions.find((item) => item.id === record.basisVersionId)
            if (chosen) autoOpenDeviation(state, batch, record, chosen, now, '恢复补写后判定')
          }
        }
        writeBatch.status = 'completed'
        writeBatch.completedCount = writeBatch.records?.length ?? 0
        writeBatch.note = `已于${now.replace('T', ' ').slice(0, 16)}从检查点恢复，补齐${writeBatch.completedCount}条未完成记录`
      }
      if (repaired > 0) {
        const checkpoint = appendCheckpoint(state, `断点恢复检查点（补${repaired}条）`, now)
        log(state, { entity: checkpoint.id, action: '时间线恢复完成', operator: '系统恢复任务', category: '写入恢复', versionRef: null, detail: `校验最后完整检查点哈希链通过，补齐${repaired}条未完成记录，各入口版本关系一致` })
      }
    },

    updateBatchStatus(state, action: PayloadAction<{ id: string; status: BatchStatus }>) {
      const batch = state.batches.find((item) => item.id === action.payload.id)
      if (!batch) return
      const blocking = state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭')
      const pendingReview = batch.monitoring.some((item) => item.judgeStatus === '待核')
      if (action.payload.status === '可放行' && (blocking || pendingReview)) return
      batch.status = action.payload.status
      batch.version += 1
      // 放行/报废封存：全部读数结论锁定，之后限值更新不再改写
      if (action.payload.status === '已放行' || action.payload.status === '已报废') {
        for (const reading of batch.monitoring) reading.locked = true
        appendCheckpoint(state, `${batch.id}${action.payload.status}封存检查点`, new Date().toISOString())
      }
      log(state, { entity: batch.id, action: '批次状态流转', operator: '质量主管', category: '批次流转', versionRef: null, detail: `状态更新为${action.payload.status}${action.payload.status === '已放行' || action.payload.status === '已报废' ? '，监测结论按各自依据版本冻结' : ''}` })
    },

    createDeviation(state, action: PayloadAction<{ batchId: string; readingId: string; title: string; severity: '一般' | '重大'; owner: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      const reading = batch?.monitoring.find((item) => item.id === action.payload.readingId)
      if (!batch || !reading || reading.judgeStatus === '待核' || reading.judgeStatus === '未判定' || reading.judgeStatus === '待重判') return
      if (state.deviations.some((item) => item.readingId === reading.id && item.status !== '已关闭')) return
      const basis = state.limitVersions.find((item) => item.id === reading.basisVersionId)
      if (!basis) return
      const now = new Date().toISOString()
      const deviation: Deviation = {
        id: `DEV-${Date.now().toString().slice(-8)}`, batchId: batch.id, stepId: reading.stepId, readingId: reading.id,
        title: action.payload.title, severity: action.payload.severity, status: '待调查', owner: action.payload.owner,
        openedAt: now, dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), version: 1,
        investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }, reviewNote: '', reviewer: '',
        revisions: [{ revisionNo: 1, basisVersionId: basis.id, limitText: basis.spec.text, readingValue: reading.value, unit: reading.unit, verdict: reading.judgeStatus === '超限' ? '超限' : '合格', note: `初判：依据V${basis.versionNo}（${basis.spec.text}），记录时点${reading.recordedAt.replace('T', ' ').slice(0, 16)}`, decidedAt: now, operator: '当前用户', source: '初判', confirmed: false }]
      }
      reading.locked = true
      state.deviations.unshift(deviation)
      batch.status = '隔离中'
      batch.version += 1
      log(state, { entity: deviation.id, action: '创建偏差调查', operator: '当前用户', category: '偏差处置', versionRef: basis.id, detail: `批次${batch.id}登记${action.payload.title}，读数${reading.id}初判版本V${basis.versionNo}已冻结` })
    },

    saveInvestigation(state, action: PayloadAction<{ id: string; investigation: Investigation }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation || !action.payload.investigation.cause.trim() || !action.payload.investigation.evidence.trim()) return
      deviation.investigation = action.payload.investigation
      deviation.status = '待复核'
      deviation.version += 1
      log(state, { entity: deviation.id, action: '提交偏差调查', operator: deviation.owner, category: '偏差处置', versionRef: null, detail: `处置分支：${deviation.investigation.decision}（依据版本链保持${deviation.revisions.length}版）` })
    },

    /** 复判另存一版：初判版本与结论保留，按读数记录时点在当前时间线上重新选版 */
    rejudgeDeviation(state, action: PayloadAction<{ id: string; operator: string }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation) return
      const reading = allReadings(state).find((item) => item.id === deviation.readingId)
      if (!reading) return
      const basis = versionAt(state.limitVersions, deviation.stepId, reading.recordedAt)
      if (!basis) return
      const verdict = judgeValue(reading.value, basis.spec)
      const previous = deviation.revisions[deviation.revisions.length - 1]
      const now = new Date().toISOString()
      deviation.revisions.push({
        revisionNo: deviation.revisions.length + 1, basisVersionId: basis.id, limitText: basis.spec.text,
        readingValue: reading.value, unit: reading.unit, verdict,
        note: `复判：按记录时点${reading.recordedAt.replace('T', ' ').slice(0, 16)}选版V${basis.versionNo}（${basis.spec.text}），判定为${verdict}${previous.verdict !== verdict ? `，与第${previous.revisionNo}版结论（${previous.verdict}）不同，退回重新调查` : '，与前版结论一致'}；前版保留不改写`,
        decidedAt: now, operator: action.payload.operator, source: '复判', confirmed: false
      })
      deviation.version += 1
      if (previous.verdict !== verdict) deviation.status = '调查中'
      reading.basisVersionId = basis.id
      log(state, { entity: deviation.id, action: '偏差复判另存', operator: action.payload.operator, category: '偏差处置', versionRef: basis.id, detail: `追加第${deviation.revisions.length}版（V${basis.versionNo}，${verdict}），初判及历版结论原样保留` })
      appendCheckpoint(state, `${deviation.id}复判检查点`, now)
    },

    reviewDeviation(state, action: PayloadAction<{ id: string; approved: boolean; note: string; reviewer: string }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation) return
      if (action.payload.approved && !action.payload.note.trim()) return
      deviation.reviewNote = action.payload.note
      deviation.reviewer = action.payload.reviewer
      deviation.status = action.payload.approved ? '已关闭' : '调查中'
      deviation.version += 1
      const latest = deviation.revisions[deviation.revisions.length - 1]
      if (action.payload.approved) latest.confirmed = true
      const batch = state.batches.find((item) => item.id === deviation.batchId)
      if (batch && action.payload.approved && !state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭' && item.id !== deviation.id)) {
        batch.status = deviation.investigation.decision === '报废' ? '已报废' : '待复核'
        batch.version += 1
      }
      log(state, { entity: deviation.id, action: action.payload.approved ? '复核通过' : '退回补证', operator: action.payload.reviewer, category: '偏差处置', versionRef: latest.basisVersionId, detail: `${action.payload.note || '退回调查'}（签字版依据V${revisionLabel(state, latest.basisVersionId)}）` })
    },

    resetDemo() {
      return seedState()
    }
  }
})

function stepName(state: HaccpState, stepId: string) {
  return state.processSteps.find((item) => item.id === stepId)?.name ?? stepId
}

function revisionLabel(state: HaccpState, versionId: string | null) {
  const version = state.limitVersions.find((item) => item.id === versionId)
  return version ? `${version.stepId.replace('P', '')}-${version.versionNo}` : '?'
}

export const {
  setBatchFilter, setBatchStatus, setSelectedBatch, publishLimitVersion, submitMonitoring,
  resolvePendingReading, resolveEntryConflict, dismissEntryConflict, recoverWrites,
  updateBatchStatus, createDeviation, saveInvestigation, rejudgeDeviation, reviewDeviation, resetDemo
} = slice.actions
export default slice.reducer
