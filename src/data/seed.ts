import type { AuditEntry, Batch, Deviation, LimitVersion, MonitoringValue, PendingReading, ProcessStep } from '../types'

const PLAN_START = '2026-01-01T00:00:00'

export const processSteps: ProcessStep[] = [
  { id: 'P1', name: '原料验收', equipment: '冷藏收货台', hazard: '致病菌、温度失控', controlPoint: '原料中心温度', limit: '≤ 4 ℃', frequency: '每批', correctiveAction: '拒收并隔离供应商批次' },
  { id: 'P2', name: '巴氏杀菌', equipment: 'HTST-02', hazard: '致病菌残留', controlPoint: '杀菌温度', limit: '≥ 73 ℃ / 15 s', frequency: '连续记录', correctiveAction: '自动回流并触发偏差' },
  { id: 'P3', name: '金属探测', equipment: 'MD-06', hazard: '金属异物', controlPoint: 'Fe/SUS灵敏度', limit: 'Fe 1.5 mm / SUS 2.0 mm', frequency: '每半小时', correctiveAction: '隔离末次合格点以来产品' },
  { id: 'P4', name: '灌装封口', equipment: 'FILL-01', hazard: '密封不良', controlPoint: '封口压力', limit: '0.40-0.48 MPa', frequency: '每小时', correctiveAction: '停机调机并复检留样' },
  { id: 'P5', name: '终产品冷却', equipment: '冷却隧道', hazard: '芽孢萌发', controlPoint: '冷却结束温度', limit: '≤ 10 ℃ / 2 h', frequency: '每批', correctiveAction: '延长冷却并观察质量' }
]

export const seedLimitVersions: LimitVersion[] = [
  { id: 'LV-P1-V1', stepId: 'P1', revision: 1, label: '≤ 4 ℃', frequency: '每批', correctiveAction: '拒收并隔离供应商批次', rule: { max: 4, unit: '℃' }, effectiveFrom: PLAN_START, effectiveTo: null, publishedAt: PLAN_START, operator: '体系工程师', supersedes: null },
  // 巴氏杀菌：V1 72℃ → 2026-09-29 07:30 生产中途收紧到 73℃
  { id: 'LV-P2-V1', stepId: 'P2', revision: 1, label: '≥ 72 ℃ / 15 s', frequency: '连续记录', correctiveAction: '自动回流并触发偏差', rule: { min: 72, unit: '℃' }, effectiveFrom: PLAN_START, effectiveTo: '2026-09-29T07:30:00', publishedAt: PLAN_START, operator: '体系工程师', supersedes: null },
  { id: 'LV-P2-V2', stepId: 'P2', revision: 2, label: '≥ 73 ℃ / 15 s', frequency: '连续记录', correctiveAction: '自动回流并触发偏差；V1时期在制品按原版复判', rule: { min: 73, unit: '℃' }, effectiveFrom: '2026-09-29T07:30:00', effectiveTo: null, publishedAt: '2026-09-29T07:30:00', operator: '质量主管', supersedes: 'LV-P2-V1' },
  { id: 'LV-P3-V1', stepId: 'P3', revision: 1, label: 'Fe 1.5 mm / SUS 2.0 mm', frequency: '每半小时', correctiveAction: '隔离末次合格点以来产品', rule: null, effectiveFrom: PLAN_START, effectiveTo: null, publishedAt: PLAN_START, operator: '体系工程师', supersedes: null },
  // 灌装封口：V1 0.38-0.45 → 2026-09-29 09:00 上调到 0.40-0.48
  { id: 'LV-P4-V1', stepId: 'P4', revision: 1, label: '0.38-0.45 MPa', frequency: '每小时', correctiveAction: '停机调机并复检留样', rule: { rangeMin: 0.38, rangeMax: 0.45, unit: 'MPa' }, effectiveFrom: PLAN_START, effectiveTo: '2026-09-29T09:00:00', publishedAt: PLAN_START, operator: '体系工程师', supersedes: null },
  { id: 'LV-P4-V2', stepId: 'P4', revision: 2, label: '0.40-0.48 MPa', frequency: '每小时', correctiveAction: '停机调机并复检留样；旧版时期记录按0.38-0.45复判', rule: { rangeMin: 0.4, rangeMax: 0.48, unit: 'MPa' }, effectiveFrom: '2026-09-29T09:00:00', effectiveTo: null, publishedAt: '2026-09-29T09:00:00', operator: '质量主管', supersedes: 'LV-P4-V1' },
  { id: 'LV-P5-V1', stepId: 'P5', revision: 1, label: '≤ 10 ℃ / 2 h', frequency: '每批', correctiveAction: '延长冷却并观察质量', rule: { max: 10, unit: '℃' }, effectiveFrom: PLAN_START, effectiveTo: null, publishedAt: PLAN_START, operator: '体系工程师', supersedes: null }
]

function reading(id: string, r: Omit<MonitoringValue, 'id'>): MonitoringValue {
  return { id, ...r }
}

/** 已判定读数：按记录时点绑定依据版本 */
const judged = (basisVersionId: string, status: '合格' | '超限', judgedAt: string, prior?: MonitoringValue['prior']) =>
  ({ basisVersionId, status, judgedAt, prior })

export const seedBatches: Batch[] = [
  {
    id: 'B260929-01', product: '低温鲜奶 950mL', line: 'L1', quantity: 3200, producedAt: '2026-09-29T06:20:00', status: '隔离中', isolationScope: '杀菌后至金属探测前全部在制品', version: 4,
    monitoring: [
      reading('M-0101', { stepId: 'P1', value: 3.4, unit: '℃', recordedAt: '2026-09-29T06:25:00', operator: '陈莉', submittedAt: '2026-09-29T06:25:00', ...judged('LV-P1-V1', '合格', '2026-09-29T06:26:00') }),
      reading('M-0102', { stepId: 'P2', value: 70.8, unit: '℃', recordedAt: '2026-09-29T06:48:00', operator: '系统采集', submittedAt: '2026-09-29T06:48:00', ...judged('LV-P2-V1', '超限', '2026-09-29T06:49:00') }),
      // 07:30 V2 生效时尚未重判：先失效，按记录时点仍属 V1，等待复判确认
      reading('M-0103', { stepId: 'P2', value: 72.6, unit: '℃', recordedAt: '2026-09-29T07:10:00', operator: '系统采集', submittedAt: '2026-09-29T07:10:00', status: '失效待重判', basisVersionId: 'LV-P2-V1', judgedAt: null, prior: { basisVersionId: 'LV-P2-V1', status: '合格', judgedAt: '2026-09-29T07:12:00' } }),
      reading('M-0104', { stepId: 'P3', value: 1.5, unit: 'mm Fe', recordedAt: '2026-09-29T07:20:00', operator: '杨鸣', submittedAt: '2026-09-29T07:20:00', ...judged('LV-P3-V1', '合格', '2026-09-29T07:21:00') })
    ]
  },
  {
    id: 'B260929-02', product: '原味酸奶 200g', line: 'L2', quantity: 8600, producedAt: '2026-09-29T08:10:00', status: '待复核', isolationScope: 'FILL-01本次清洁后产品', version: 3,
    monitoring: [
      reading('M-0201', { stepId: 'P4', value: 0.36, unit: 'MPa', recordedAt: '2026-09-29T08:40:00', operator: '系统采集', submittedAt: '2026-09-29T08:40:00', ...judged('LV-P4-V1', '超限', '2026-09-29T08:41:00') }),
      // 09:00 V2 生效时尚未重判：0.39 在旧版区间内，重判须按 08:55 时点选 V1
      reading('M-0202', { stepId: 'P4', value: 0.39, unit: 'MPa', recordedAt: '2026-09-29T08:55:00', operator: '系统采集', submittedAt: '2026-09-29T08:55:00', status: '失效待重判', basisVersionId: 'LV-P4-V1', judgedAt: null, prior: { basisVersionId: 'LV-P4-V1', status: '合格', judgedAt: '2026-09-29T08:57:00' } }),
      reading('M-0203', { stepId: 'P5', value: 8.2, unit: '℃', recordedAt: '2026-09-29T10:10:00', operator: '郑凯', submittedAt: '2026-09-29T10:10:00', ...judged('LV-P5-V1', '合格', '2026-09-29T10:11:00') })
    ]
  },
  {
    id: 'B260928-07', product: '低脂牛奶 1L', line: 'L1', quantity: 5100, producedAt: '2026-09-28T16:20:00', status: '已放行', isolationScope: '无', version: 6,
    monitoring: [
      reading('M-0701', { stepId: 'P1', value: 3.0, unit: '℃', recordedAt: '2026-09-28T17:00:00', operator: '生产线记录', submittedAt: '2026-09-28T17:05:00', ...judged('LV-P1-V1', '合格', '2026-09-28T17:06:00') }),
      reading('M-0702', { stepId: 'P2', value: 73.2, unit: '℃', recordedAt: '2026-09-28T17:00:00', operator: '生产线记录', submittedAt: '2026-09-28T17:05:00', ...judged('LV-P2-V1', '合格', '2026-09-28T17:06:00') }),
      reading('M-0703', { stepId: 'P3', value: 1.2, unit: 'mm Fe', recordedAt: '2026-09-28T17:00:00', operator: '生产线记录', submittedAt: '2026-09-28T17:05:00', ...judged('LV-P3-V1', '合格', '2026-09-28T17:06:00') }),
      reading('M-0704', { stepId: 'P4', value: 0.41, unit: 'MPa', recordedAt: '2026-09-28T17:00:00', operator: '生产线记录', submittedAt: '2026-09-28T17:05:00', ...judged('LV-P4-V1', '合格', '2026-09-28T17:06:00') }),
      reading('M-0705', { stepId: 'P5', value: 7.8, unit: '℃', recordedAt: '2026-09-28T17:00:00', operator: '生产线记录', submittedAt: '2026-09-28T17:05:00', ...judged('LV-P5-V1', '合格', '2026-09-28T17:06:00') })
    ]
  }
]

/** 晚到现场补录：次日 14:20 才补录前一天 17:06 的杀菌温度，声称依据的 V1 已失效，进入待核 */
export const seedPendingReadings: PendingReading[] = [
  {
    id: 'PEND-01',
    batchId: 'B260928-07',
    claimedVersionId: 'LV-P2-V1',
    reason: '现场补录晚到：记录时点 09-28 17:06，提交时点 09-29 14:20，所依据 V1（≥72℃）已于是日 07:30 失效，不得直接改写已放行批次结论',
    submittedAt: '2026-09-29T14:20:00',
    reading: reading('M-0706', { stepId: 'P2', value: 71.5, unit: '℃', recordedAt: '2026-09-28T17:06:00', operator: '杀菌岗 补录', submittedAt: '2026-09-29T14:20:00', status: '待核', basisVersionId: null, judgedAt: null })
  }
]

export const seedDeviations: Deviation[] = [
  {
    id: 'DEV-260929-01', batchId: 'B260929-01', stepId: 'P2', title: '杀菌温度低于关键限值', severity: '重大', status: '调查中', owner: '质量工程组', openedAt: '2026-09-29T06:55:00', dueDate: '2026-09-29', basisVersionId: 'LV-P2-V1', basisStale: true,
    investigation: { cause: '蒸汽调节阀响应滞后', evidence: '趋势图显示70.8℃持续42秒；阀门检修记录已上传', decision: '返工', reworkInstruction: '隔离产品全部回流至平衡槽，重新杀菌并留样验证' }, reviewNote: '', reviewer: '', version: 3,
    revisions: [
      { revision: 1, basisVersionId: 'LV-P2-V1', basisLabel: '≥ 72 ℃ / 15 s', conclusion: '70.8℃ < 72℃，判定超限（重大偏差），批次隔离', decision: '返工', judgedAt: '2026-09-29T06:55:00', judge: '监控系统', note: '', origin: '原判定' }
    ]
  },
  {
    id: 'DEV-260929-02', batchId: 'B260929-02', stepId: 'P4', title: '封口压力偏低', severity: '一般', status: '待复核', owner: '设备保障组', openedAt: '2026-09-29T08:52:00', dueDate: '2026-09-30', basisVersionId: 'LV-P4-V1', basisStale: true,
    investigation: { cause: '气缸密封圈磨损', evidence: '压力曲线、拆检照片、备件领用单', decision: '返工', reworkInstruction: '更换密封圈，返封隔离产品并恢复压力。' }, reviewNote: '', reviewer: '', version: 2,
    revisions: [
      { revision: 1, basisVersionId: 'LV-P4-V1', basisLabel: '0.38-0.45 MPa', conclusion: '0.36MPa 低于区间下限0.38MPa，判定超限（一般偏差）', decision: '返工', judgedAt: '2026-09-29T08:52:00', judge: '监控系统', note: '', origin: '原判定' }
    ]
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'AUD-5', entity: 'P4 灌装封口', action: '限值版本生效', operator: '质量主管', detail: 'V2「0.40-0.48 MPa」09:00 生效，V1 封闭；1 条未重判旧读数失效待按记录时点复判', createdAt: '2026-09-29T09:00:00', versionId: 'LV-P4-V2', timelineSeq: 5 },
  { id: 'AUD-3', entity: 'B260929-02', action: '状态流转', operator: '杨鸣', detail: '由生产中转为待复核', createdAt: '2026-09-29T08:52:00', timelineSeq: 4 },
  { id: 'AUD-2', entity: 'DEV-260929-01', action: '提交调查', operator: '质量工程组', detail: '记录蒸汽阀响应滞后与趋势证据（依据 V1 限值）', createdAt: '2026-09-29T08:15:00', versionId: 'LV-P2-V1', timelineSeq: 3 },
  { id: 'AUD-4', entity: 'P2 巴氏杀菌', action: '限值版本生效', operator: '质量主管', detail: 'V2「≥ 73 ℃ / 15 s」07:30 生效，V1 封闭；1 条未重判旧读数失效，已判定偏差保留原结论待复判', createdAt: '2026-09-29T07:30:00', versionId: 'LV-P2-V2', timelineSeq: 2 },
  { id: 'AUD-1', entity: 'B260929-01', action: '自动创建偏差', operator: '监控系统', detail: '杀菌温度70.8℃低于 V1 限值72℃，批次已隔离', createdAt: '2026-09-29T06:55:00', versionId: 'LV-P2-V1', timelineSeq: 1 }
]
