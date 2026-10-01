export type BatchStatus = '生产中' | '待复核' | '可放行' | '隔离中' | '已放行' | '已报废'
export type DeviationStatus = '待调查' | '调查中' | '待复核' | '已关闭'
export type DecisionType = '返工' | '报废' | '让步接收'

export interface ProcessStep {
  id: string
  name: string
  equipment: string
  hazard: string
  controlPoint: string
  limit: string
  frequency: string
  correctiveAction: string
}

/** 可被时间线判定引擎执行的结构化关键限值 */
export interface LimitRule {
  /** ≤ 上限（温度、金属粒径等，越小越安全） */
  max?: number
  /** ≥ 下限（杀菌温度、封口压力等，越大越安全） */
  min?: number
  /** 区间上限，配合 rangeMin */
  rangeMax?: number
  /** 区间下限 */
  rangeMin?: number
  unit: string
}

export interface LimitVersion {
  id: string
  stepId: string
  /** 同一控制点的版本序号，V1、V2…… */
  revision: number
  /** 面向操作人员的限值文本，如「≥ 73 ℃ / 15 s」 */
  label: string
  frequency: string
  correctiveAction: string
  rule: LimitRule | null
  /** 生效起始时间（含），在此时点之后记录的读数适用本版 */
  effectiveFrom: string
  /** 失效时间（不含）；新版本生效后旧版本自动封闭 */
  effectiveTo: string | null
  /** 发布提交时间，写入失败恢复后仍保留原始时点 */
  publishedAt: string
  operator: string
  /** 上一版版本号；版本时间线的链 */
  supersedes: string | null
  /** 由写入失败恢复重放产生 */
  recovered?: boolean
}

/** 读数判定状态：合格 / 超限 / 尚未重判的旧读数 / 待核 / 已驳回 / 草稿（重判未确认） */
export type ReadingStatus = '合格' | '超限' | '失效待重判' | '待核' | '已驳回'

export interface MonitoringValue {
  id: string
  stepId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
  /** 判定所依据的限值版本；重判或补录选版后写入 */
  basisVersionId: string | null
  status: ReadingStatus
  /** 完成判定的时间 */
  judgedAt: string | null
  /** 晚到现场补录的提交时间；与记录时点区分 */
  submittedAt: string | null
  /** 后到窗口重新选版时记录 */
  windowId?: string
  rebased?: boolean
  /** 重判产生，原判定保留在 prior 中 */
  rejudged?: boolean
  /** 原始判定（重判前），保证已判定结论不被覆盖 */
  prior?: {
    basisVersionId: string
    status: '合格' | '超限'
    judgedAt: string
  }
}

/** 晚到记录对应版本已失效时的待核队列条目 */
export interface PendingReading {
  id: string
  batchId: string
  reading: MonitoringValue
  /** 现场补录时声称依据的版本（已失效） */
  claimedVersionId: string
  reason: string
  submittedAt: string
  windowId?: string
}

export interface DeviationRevision {
  revision: number
  basisVersionId: string
  basisLabel: string
  conclusion: string
  decision: DecisionType
  judgedAt: string
  judge: string
  note: string
  /** 复判版本来源：原登记 / 限值更新复判 */
  origin: '原判定' | '限值复判'
}

export interface Batch {
  id: string
  product: string
  line: string
  quantity: number
  producedAt: string
  status: BatchStatus
  isolationScope: string
  monitoring: MonitoringValue[]
  version: number
}

export interface Investigation {
  cause: string
  evidence: string
  decision: DecisionType
  reworkInstruction: string
}

export interface Deviation {
  id: string
  batchId: string
  stepId: string
  title: string
  severity: '一般' | '重大'
  status: DeviationStatus
  owner: string
  openedAt: string
  dueDate: string
  investigation: Investigation
  reviewNote: string
  reviewer: string
  version: number
  /** 登记时依据的限值版本 */
  basisVersionId: string | null
  /** 历次判定版本；已判定偏差保留原版本和结论，复判另存一版 */
  revisions: DeviationRevision[]
  /** 依据版本已被新版替代，等待复判 */
  basisStale?: boolean
}

export interface AuditEntry {
  id: string
  entity: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 关联的限值版本，便于按版本关系追溯 */
  versionId?: string
  /** 时间线批次序号，所有入口看到同一顺序 */
  timelineSeq: number
  /** 写入失败恢复后补写 */
  recovered?: boolean
}

/** 并发提交槽：记录每个控制点最近一次提交来自哪个窗口 */
export interface SubmissionSlot {
  stepId: string
  windowId: string
  readingId: string
  submittedAt: string
}

/** 一次完整的写入事件；先入待写队列，落盘成功后才成为检查点 */
export interface TimelineEvent {
  id: string
  seq: number
  type:
    | 'LIMIT_PUBLISHED'
    | 'READING_ADDED'
    | 'READING_REJUDGED'
    | 'PENDING_ENQUEUED'
    | 'PENDING_RESOLVED'
    | 'DEVIATION_CREATED'
    | 'INVESTIGATION_SAVED'
    | 'DEVIATION_REVIEWED'
    | 'DEVIATION_REJUDGED'
    | 'BATCH_STATUS'
  at: string
  operator: string
  payload: unknown
}

export interface TimelineMeta {
  /** 最后完整时间线检查点时间 */
  checkpointAt: string | null
  /** 事件序列游标 */
  seq: number
  /** 上一次启动是否从检查点恢复过未完成记录 */
  lastRecovered: number
}
