import type { AuditEntry, Batch, Deviation, LimitVersion, MonitoringValue, ProcessStep, TimelineCheckpoint, WriteBatch } from '../types'

/** 限值版本 id */
const V = {
  p1v1: 'LV-P1-1', p2v1: 'LV-P2-1', p2v2: 'LV-P2-2', p3v1: 'LV-P3-1',
  p4v1: 'LV-P4-1', p4v2: 'LV-P4-2', p5v1: 'LV-P5-1'
}

export const processSteps: ProcessStep[] = [
  { id: 'P1', name: '原料验收', equipment: '冷藏收货台', hazard: '致病菌、温度失控', controlPoint: '原料中心温度', limit: '≤ 4 ℃', frequency: '每批', correctiveAction: '拒收并隔离供应商批次' },
  { id: 'P2', name: '巴氏杀菌', equipment: 'HTST-02', hazard: '致病菌残留', controlPoint: '杀菌温度', limit: '≥ 74 ℃ / 15 s', frequency: '连续记录', correctiveAction: '自动回流并触发偏差，复测前保持回流' },
  { id: 'P3', name: '金属探测', equipment: 'MD-06', hazard: '金属异物', controlPoint: 'Fe/SUS灵敏度', limit: 'Fe 1.5 mm / SUS 2.0 mm', frequency: '每半小时', correctiveAction: '隔离末次合格点以来产品' },
  { id: 'P4', name: '灌装封口', equipment: 'FILL-01', hazard: '密封不良', controlPoint: '封口压力', limit: '0.40-0.48 MPa', frequency: '每半小时', correctiveAction: '停机调机、更换密封圈并复检留样' },
  { id: 'P5', name: '终产品冷却', equipment: '冷却隧道', hazard: '芽孢萌发', controlPoint: '冷却结束温度', limit: '≤ 10 ℃ / 2 h', frequency: '每批', correctiveAction: '延长冷却并观察质量' }
]

export const limitVersions: LimitVersion[] = [
  {
    id: V.p1v1, stepId: 'P1', versionNo: 1,
    spec: { min: null, max: 4, unit: '℃', text: '≤ 4 ℃' },
    frequency: '每批', correctiveAction: '拒收并隔离供应商批次',
    effectiveAt: '2026-01-01T00:00:00', publishedAt: '2026-01-01T08:00:00',
    operator: '质量负责人 秦岚', changeNote: '控制计划首版发布', supersededAt: null
  },
  {
    id: V.p2v1, stepId: 'P2', versionNo: 1,
    spec: { min: 72, max: null, unit: '℃', text: '≥ 72 ℃ / 15 s' },
    frequency: '连续记录', correctiveAction: '自动回流并触发偏差',
    effectiveAt: '2026-01-01T00:00:00', publishedAt: '2026-01-01T08:00:00',
    operator: '质量负责人 秦岚', changeNote: '控制计划首版发布', supersededAt: '2026-09-29T07:00:00'
  },
  {
    id: V.p2v2, stepId: 'P2', versionNo: 2,
    spec: { min: 74, max: null, unit: '℃', text: '≥ 74 ℃ / 15 s' },
    frequency: '连续记录', correctiveAction: '自动回流并触发偏差，复测前保持回流',
    effectiveAt: '2026-09-29T07:00:00', publishedAt: '2026-09-29T06:40:00',
    operator: '质量主管 何舟', changeNote: '根据秋季杀菌验证报告上调2℃，同步收紧纠偏', supersededAt: null
  },
  {
    id: V.p3v1, stepId: 'P3', versionNo: 1,
    spec: { min: 1.5, max: null, unit: 'mm Fe', text: 'Fe 1.5 mm / SUS 2.0 mm' },
    frequency: '每半小时', correctiveAction: '隔离末次合格点以来产品',
    effectiveAt: '2026-01-01T00:00:00', publishedAt: '2026-01-01T08:00:00',
    operator: '质量负责人 秦岚', changeNote: '控制计划首版发布', supersededAt: null
  },
  {
    id: V.p4v1, stepId: 'P4', versionNo: 1,
    spec: { min: 0.38, max: 0.45, unit: 'MPa', text: '0.38-0.45 MPa' },
    frequency: '每小时', correctiveAction: '停机调机并复检留样',
    effectiveAt: '2026-01-01T00:00:00', publishedAt: '2026-01-01T08:00:00',
    operator: '质量负责人 秦岚', changeNote: '控制计划首版发布', supersededAt: '2026-09-29T08:00:00'
  },
  {
    id: V.p4v2, stepId: 'P4', versionNo: 2,
    spec: { min: 0.4, max: 0.48, unit: 'MPa', text: '0.40-0.48 MPa' },
    frequency: '每半小时', correctiveAction: '停机调机、更换密封圈并复检留样',
    effectiveAt: '2026-09-29T07:30:00', publishedAt: '2026-09-29T08:00:00',
    operator: '质量主管 何舟', changeNote: '封口验证窗口收窄并提高监控频率，自07:30起追溯执行', supersededAt: null
  },
  {
    id: V.p5v1, stepId: 'P5', versionNo: 1,
    spec: { min: null, max: 10, unit: '℃', text: '≤ 10 ℃ / 2 h' },
    frequency: '每批', correctiveAction: '延长冷却并观察质量',
    effectiveAt: '2026-01-01T00:00:00', publishedAt: '2026-01-01T08:00:00',
    operator: '质量负责人 秦岚', changeNote: '控制计划首版发布', supersededAt: null
  }
]

function reading(
  id: string, batchId: string, stepId: string, value: number, unit: string,
  recordedAt: string, operator: string, basisVersionId: string | null,
  judgeStatus: MonitoringValue['judgeStatus'], extra: Partial<MonitoringValue> = {}
): MonitoringValue {
  return {
    id: `${batchId}:R-${id}`, stepId, value, unit, recordedAt,
    enteredAt: extra.enteredAt ?? recordedAt, operator,
    basisVersionId, claimedBasisVersionId: null, judgeStatus,
    rejudgedAt: undefined, locked: false, pendingReason: '', writeBatchId: null,
    clientId: `CID-${batchId}-${id}`, ...extra
  }
}

export const seedBatches: Batch[] = [
  {
    id: 'B260929-01', product: '低温鲜奶 950mL', line: 'L1', quantity: 3200, producedAt: '2026-09-29T06:20:00', status: '隔离中', isolationScope: '杀菌后至金属探测前全部在制品', version: 4,
    monitoring: [
      reading('01', 'B260929-01', 'P1', 3.4, '℃', '2026-09-29T06:25:00', '陈莉', V.p1v1, '合格'),
      // 06:48 落在 V1（≥72℃）窗口；70.8 初判超限并锁定，07:00 的新版不改写结论，复判另存第2版
      reading('02', 'B260929-01', 'P2', 70.8, '℃', '2026-09-29T06:48:00', '系统采集', V.p2v1, '超限', { locked: true, writeBatchId: 'WB-1' }),
      reading('03', 'B260929-01', 'P3', 1.5, 'mm Fe', '2026-09-29T07:20:00', '杨鸣', V.p3v1, '合格'),
      // 晚到补录：07:05 落在 V2（≥74℃）窗口，73.2 应超限；现场按旧版 V1 声称合格，进入待核
      reading('04', 'B260929-01', 'P2', 73.2, '℃', '2026-09-29T07:05:00', '夜班补录 赵海', V.p2v2, '待核', {
        claimedBasisVersionId: V.p2v1,
        enteredAt: '2026-09-29T14:30:00',
        pendingReason: '14:30晚到补录：现场声称按旧版V1（≥72℃）判合格，但记录时点07:05已适用V2（≥74℃）应判超限，两版结论冲突',
        writeBatchId: 'WB-3'
      })
    ]
  },
  {
    id: 'B260929-02', product: '原味酸奶 200g', line: 'L2', quantity: 8600, producedAt: '2026-09-29T07:10:00', status: '隔离中', isolationScope: 'FILL-01本次清洁后产品', version: 3,
    monitoring: [
      // 08:40 落在 V2 窗口，0.36 初判即超限并锁定
      reading('01', 'B260929-02', 'P4', 0.36, 'MPa', '2026-09-29T08:40:00', '系统采集', V.p4v2, '超限', { locked: true }),
      reading('02', 'B260929-02', 'P5', 8.2, '℃', '2026-09-29T10:10:00', '郑凯', V.p5v1, '合格'),
      // 07:45 记录先按 V1 判合格；08:00 发布追溯版 V2（07:30生效）后，未锁定旧读数先失效再按时点复判为超限
      reading('03', 'B260929-02', 'P4', 0.39, 'MPa', '2026-09-29T07:45:00', '系统采集', V.p4v2, '超限', { rejudgedAt: '2026-09-29T08:00:00', locked: true })
    ]
  },
  {
    id: 'B260928-07', product: '低脂牛奶 1L', line: 'L1', quantity: 5100, producedAt: '2026-09-28T16:20:00', status: '已放行', isolationScope: '无', version: 6,
    monitoring: (() => {
      const rows: Array<[string, number, string, string]> = [
        ['P1', 3.0, '℃', V.p1v1], ['P2', 73.2, '℃', V.p2v1], ['P3', 1.6, 'mm Fe', V.p3v1],
        ['P4', 0.41, 'MPa', V.p4v1], ['P5', 7.8, '℃', V.p5v1]
      ]
      return rows.map(([stepId, value, unit, basis], index) =>
        reading(`0${index + 1}`, 'B260928-07', stepId, value, unit, '2026-09-28T17:00:00', '生产线记录', basis, '合格', { locked: true }))
    })()
  }
]

export const seedDeviations: Deviation[] = [
  {
    id: 'DEV-260929-01', batchId: 'B260929-01', stepId: 'P2', readingId: 'B260929-01:R-02',
    title: '杀菌温度低于关键限值', severity: '重大', status: '调查中', owner: '质量工程组', openedAt: '2026-09-29T06:55:00', dueDate: '2026-09-29', version: 3,
    investigation: { cause: '蒸汽调节阀响应滞后', evidence: '趋势图显示70.8℃持续42秒；阀门检修记录已上传', decision: '返工', reworkInstruction: '隔离产品全部回流至平衡槽，重新杀菌并留样验证' }, reviewNote: '', reviewer: '',
    revisions: [
      { revisionNo: 1, basisVersionId: V.p2v1, limitText: '≥ 72 ℃ / 15 s', readingValue: 70.8, unit: '℃', verdict: '超限', note: '初判：70.8℃低于72℃限值（06:48记录时点适用V1），批次隔离；该版结论冻结保留', decidedAt: '2026-09-29T06:55:00', operator: '监控系统', source: '初判', confirmed: false },
      { revisionNo: 2, basisVersionId: V.p2v2, limitText: '≥ 74 ℃ / 15 s', readingValue: 70.8, unit: '℃', verdict: '超限', note: '复判：07:00新版生效后对同一读数复判，70.8℃低于74℃仍超限，维持返工；初判V1版本与结论不改写', decidedAt: '2026-09-29T07:12:00', operator: '质量主管 何舟', source: '复判', confirmed: false }
    ]
  },
  {
    id: 'DEV-260929-02', batchId: 'B260929-02', stepId: 'P4', readingId: 'B260929-02:R-01',
    title: '封口压力偏低', severity: '一般', status: '待复核', owner: '设备保障组', openedAt: '2026-09-29T08:52:00', dueDate: '2026-09-30', version: 2,
    investigation: { cause: '气缸密封圈磨损', evidence: '压力曲线、拆检照片、备件领用单', decision: '返工', reworkInstruction: '更换密封圈，返封隔离产品并恢复压力。' }, reviewNote: '', reviewer: '',
    revisions: [
      { revisionNo: 1, basisVersionId: V.p4v2, limitText: '0.40-0.48 MPa', readingValue: 0.36, unit: 'MPa', verdict: '超限', note: '初判：08:40记录时点适用V2（0.40-0.48MPa，07:30生效），0.36低于0.40下限，批次隔离', decidedAt: '2026-09-29T08:52:00', operator: '监控系统', source: '初判', confirmed: false }
    ]
  },
  {
    id: 'DEV-260929-03', batchId: 'B260929-02', stepId: 'P4', readingId: 'B260929-02:R-03',
    title: '限值更新后封口压力复判超限', severity: '一般', status: '待调查', owner: '设备保障组', openedAt: '2026-09-29T08:00:00', dueDate: '2026-09-30', version: 1,
    investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }, reviewNote: '', reviewer: '',
    revisions: [
      { revisionNo: 1, basisVersionId: V.p4v2, limitText: '0.40-0.48 MPa', readingValue: 0.39, unit: 'MPa', verdict: '超限', note: '限值更新复判：记录时点07:45按追溯生效的V2选版，0.39低于0.40下限；该读数在V1（0.38-0.45MPa）下原为合格，旧结论已先失效', decidedAt: '2026-09-29T08:00:00', operator: '系统时间线引擎', source: '初判', confirmed: false }
    ]
  }
]

export const seedWriteBatches: WriteBatch[] = [
  { id: 'WB-1', batchId: 'B260929-01', submittedAt: '2026-09-29T06:55:00', operator: '监控系统', clientIds: ['CID-B260929-01-02'], status: 'completed', completedCount: 1, note: '连续采集自动写入，时间线完整' },
  { id: 'WB-3', batchId: 'B260929-01', submittedAt: '2026-09-29T14:30:00', operator: '夜班补录 赵海', clientIds: ['CID-B260929-01-04'], status: 'completed', completedCount: 1, note: '晚到补录：依据版本存疑，读数进入待核队列，未改写结论' }
]

export const seedCheckpoints: TimelineCheckpoint[] = [
  {
    id: 'CP-1', label: 'B260928-07 放行封存检查点', createdAt: '2026-09-28T18:05:00',
    readingIds: ['B260928-07:R-01', 'B260928-07:R-02', 'B260928-07:R-03', 'B260928-07:R-04', 'B260928-07:R-05'],
    writeBatchIds: [], digest: 'a6440f53'
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'AUD-V1', entity: 'P2 巴氏杀菌', action: '限值版本发布', operator: '质量主管 何舟', detail: 'V2（≥74℃/15s）06:40发布、07:00生效，替代V1（≥72℃）；V1窗口内已判偏差保留原版结论，未锁定读数先失效再按记录时点复判', createdAt: '2026-09-29T06:40:00', versionRef: V.p2v2, category: '限值版本' },
  { id: 'AUD-1', entity: 'B260929-01', action: '自动创建偏差', operator: '监控系统', detail: '06:48杀菌温度70.8℃低于限值72℃（记录时点适用V1），批次已隔离；初判版本冻结', createdAt: '2026-09-29T06:55:00', versionRef: V.p2v1, category: '偏差处置' },
  { id: 'AUD-R1', entity: 'DEV-260929-01', action: '偏差复判另存', operator: '质量主管 何舟', detail: 'V2生效后复判70.8℃仍超限，追加第2版；V1初判版本与结论保留不改写', createdAt: '2026-09-29T07:12:00', versionRef: V.p2v2, category: '偏差处置' },
  { id: 'AUD-V2', entity: 'P4 灌装封口', action: '限值版本发布', operator: '质量主管 何舟', detail: 'V2（0.40-0.48MPa，每半小时）08:00发布并追溯至07:30生效，替代V1（0.38-0.45MPa）；07:45的0.39MPa旧读数失效后复判：由合格变为超限', createdAt: '2026-09-29T08:00:00', versionRef: V.p4v2, category: '限值版本' },
  { id: 'AUD-R2', entity: 'B260929-02:R-03', action: '旧读数失效后复判', operator: '系统时间线引擎', detail: '07:45读数0.39MPa按记录时点选V2（0.40-0.48MPa）复判为超限（V1下原为合格），自动登记DEV-260929-03并隔离批次', createdAt: '2026-09-29T08:00:00', versionRef: V.p4v2, category: '监测判定' },
  { id: 'AUD-3', entity: 'B260929-02', action: '状态流转', operator: '杨鸣', detail: '由生产中转为待复核', createdAt: '2026-09-29T08:52:00', versionRef: null, category: '批次流转' },
  { id: 'AUD-2', entity: 'DEV-260929-01', action: '提交调查', operator: '质量工程组', detail: '记录蒸汽阀响应滞后与趋势证据', createdAt: '2026-09-29T09:15:00', versionRef: null, category: '偏差处置' },
  { id: 'AUD-5', entity: 'B260929-01:R-04', action: '晚到记录待核', operator: '夜班补录 赵海', detail: '14:30补录07:05读数73.2℃，现场声称依据V1判合格，与按时点选版V2（超限）冲突，进入待核队列，未改写任何结论', createdAt: '2026-09-29T14:30:00', versionRef: V.p2v2, category: '监测判定' }
]
