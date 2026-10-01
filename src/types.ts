export type BatchStatus = '生产中' | '待复核' | '可放行' | '隔离中' | '已放行' | '已报废'
export type DeviationStatus = '待调查' | '调查中' | '待复核' | '已关闭'
export type DecisionType = '返工' | '报废' | '让步接收'

/** 监测读数判定状态：未判定、待重判、待核、合格、超限 */
export type JudgeStatus = '未判定' | '待重判' | '待核' | '合格' | '超限'

export interface ProcessStep {
  id: string
  name: string
  equipment: string
  hazard: string
  controlPoint: string
  frequency: string
  /** 当前生效关键限值的展示文本，结构化范围以 LimitVersion.spec 为准 */
  limit: string
  correctiveAction: string
}

/** 关键限值的结构化判定范围 */
export interface LimitSpec {
  min: number | null
  max: number | null
  unit: string
  /** 原始展示文本，用于审计与界面 */
  text: string
}

/** 关键限值版本：同一步骤按 effectiveAt 构成生效时间线 */
export interface LimitVersion {
  id: string
  stepId: string
  /** 从 1 开始，同一控制点递增 */
  versionNo: number
  spec: LimitSpec
  frequency: string
  correctiveAction: string
  /** 生效时间（生产时点口径，可回溯发布） */
  effectiveAt: string
  /** 发布时间（写入时间线的时点） */
  publishedAt: string
  operator: string
  changeNote: string
  /** 被更新版本替换的时间；null 表示当前版本 */
  supersededAt: string | null
}

export interface MonitoringValue {
  /** 读数实例 id，供偏差关联与重判使用 */
  id: string
  stepId: string
  value: number
  unit: string
  /** 记录时点（现场实际测量时间），用于按点选版 */
  recordedAt: string
  /** 补录/录入时点（窗口提交时间） */
  enteredAt: string
  operator: string
  /** 判定所依据的限值版本 id */
  basisVersionId: string | null
  /** 晚到补录时现场声称的依据版本；与按记录时点选版结果不一致时进入待核 */
  claimedBasisVersionId?: string | null
  /** 最近一次判定使用的版本（重判另存时保留轨迹） */
  judgeStatus: JudgeStatus
  /** 重判时间（限值更新后先失效再按时点复判的痕迹） */
  rejudgedAt?: string
  /** 已判定结论是否锁定（已判偏差或放行批次）；锁定后限值更新不改写 */
  locked: boolean
  /** 待核原因 */
  pendingReason: string
  /** 补录提交所属的写入批次 id */
  writeBatchId: string | null
  /** 客户端幂等 id，写入失败恢复时用于只补未完成记录 */
  clientId: string
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

/** 偏差的一版判定结论：已判定偏差保留原版本，复判另存一版 */
export interface DeviationRevision {
  revisionNo: number
  basisVersionId: string
  limitText: string
  readingValue: number
  unit: string
  verdict: '超限' | '合格'
  note: string
  decidedAt: string
  operator: string
  source: '初判' | '复判'
  /** 复判后该版本是否被质量负责人确认关闭 */
  confirmed: boolean
}

export interface Deviation {
  id: string
  batchId: string
  stepId: string
  /** 触发该初判的监测读数 id */
  readingId: string
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
  /** 判定版本链：第 1 版为初判，复判追加 */
  revisions: DeviationRevision[]
}

export interface AuditEntry {
  id: string
  entity: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 关联的限值版本 id，用于在时间线上对齐 */
  versionRef: string | null
  category: '限值版本' | '监测判定' | '偏差处置' | '批次流转' | '写入恢复'
}

/** 一次写入批次（现场补录可能跨窗口批量提交） */
export interface WriteBatch {
  id: string
  batchId: string
  submittedAt: string
  operator: string
  clientIds: string[]
  /** completed=已全部落库并建检查点；failed=写入中途失败（只完成部分） */
  status: 'completed' | 'failed'
  completedCount: number
  note: string
  /** 失败时暂存待补写的记录；恢复时据此只补未完成记录 */
  records?: MonitoringValue[]
}

/** 最后完整时间线检查点；恢复时只补未完成记录 */
export interface TimelineCheckpoint {
  id: string
  label: string
  createdAt: string
  /** 检查点时刻完整的读数 id 集合（用于只补未完成记录） */
  readingIds: string[]
  writeBatchIds: string[]
  /** 对上一检查点的哈希链，用于校验时间线完整性 */
  digest: string
}

/** 两个窗口同提一个控制点时的冲突状态；后到一方须重新选择依据 */
export interface EntryConflict {
  id: string
  batchId: string
  stepId: string
  /** 先到窗口已经使用的限值版本 */
  existingBasisVersionId: string
  existingRecordedAt: string
  existingEnteredAt: string
  /** 后到窗口原本默认选择的版本 */
  requestedBasisVersionId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
  enteredAt: string
}
