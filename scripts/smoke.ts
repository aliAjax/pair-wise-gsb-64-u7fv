// 纯逻辑冒烟测试：通过 esbuild 临时打包后在 node 中运行
import { configureStore } from '@reduxjs/toolkit'
import reducer, {
  publishLimitVersion, addMonitoringReading, rejudgeReading, resolvePendingReading,
  createDeviation, rejudgeDeviation, retryFlush
} from '../src/store/haccpSlice'
import { armWriteFailure, versionAt, judgeRule } from '../src/services/timeline'

const localStorageMap = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => localStorageMap.get(k) ?? null,
  setItem: (k: string, v: string) => localStorageMap.set(k, v),
  removeItem: (k: string) => localStorageMap.delete(k)
}

function makeStore() {
  return configureStore({ reducer: { haccp: reducer } })
}

let pass = 0, fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra) }
}

// 1. 选版引擎
const s0 = makeStore().getState().haccp
check('P2 在 07:00 选 V1', versionAt(s0.limitVersions, 'P2', '2026-09-29T07:00:00')?.id === 'LV-P2-V1')
check('P2 在 08:00 选 V2', versionAt(s0.limitVersions, 'P2', '2026-09-29T08:00:00')?.id === 'LV-P2-V2')
check('P4 V1 区间判定 0.39 合格', judgeRule({ rangeMin: 0.38, rangeMax: 0.45, unit: 'MPa' }, 0.39) === true)
check('P4 V2 区间判定 0.39 超限', judgeRule({ rangeMin: 0.4, rangeMax: 0.48, unit: 'MPa' }, 0.39) === false)

// 2. 发布新版本：生效前旧读数全部失效（先失效），原结论存 prior
const store = makeStore()
const before = store.getState().haccp
const p2StaleBefore = before.batches.flatMap(b => b.monitoring).filter(m => m.stepId === 'P2' && m.status === '失效待重判').length
store.dispatch(publishLimitVersion({
  stepId: 'P5', label: '≤ 9 ℃ / 2 h', frequency: '每批',
  correctiveAction: '延长冷却', rule: { max: 9, unit: '℃' },
  effectiveFrom: new Date('2026-09-29T12:00:00').toISOString(), operator: '质量主管'
}))
const after = store.getState().haccp
const p5Readings = after.batches.flatMap(b => b.monitoring).filter(m => m.stepId === 'P5')
check('P5 发布后生效前读数失效', p5Readings.every(m => m.status === '失效待重判'), JSON.stringify(p5Readings))
check('失效读数保留原结论 prior', p5Readings.every(m => m.prior && m.prior.status === '合格'))
const v2 = after.limitVersions.find(v => v.stepId === 'P5' && v.effectiveTo === null)!
const v1 = after.limitVersions.find(v => v.stepId === 'P5' && v.effectiveTo !== null)!
check('旧版封闭、新版现行', v2.revision === 2 && v1.effectiveTo === v2.effectiveFrom)
check('已判定偏差未被改写', after.deviations.map(d => d.revisions.length).join(',') === '1,1')

// 3. 重判：按记录时点选旧版 V1 → 0.39 在 P4 V1 区间合格；原结论留痕
const b2 = after.batches.find(b => b.id === 'B260929-02')!
const m0202 = b2.monitoring.find(m => m.id === 'M-0202')!
store.dispatch(rejudgeReading('B260929-02', 'M-0202', 'LV-P4-V1', '质量主管', '按时点复判'))
const r3 = store.getState().haccp.batches.find(b => b.id === 'B260929-02')!.monitoring.find(m => m.id === 'M-0202')!
check('重判按 V1 结论合格', r3.status === '合格' && r3.basisVersionId === 'LV-P4-V1', r3.status)
check('重判标记且原结论保留', r3.rejudged === true && r3.prior?.status === '合格')

// 4. 晚到补录：声称版本已失效 → 待核队列，不改结论
const pendingBefore = store.getState().haccp.pendingReadings.length
const late = store.dispatch(addMonitoringReading({
  batchId: 'B260928-07', stepId: 'P2', value: 71.9, unit: '℃',
  recordedAt: '2026-09-28T18:00:00', operator: '补录员', windowId: 'W-FIELD'
}))
check('晚到补录返回 enqueued', late.enqueued === true)
check('待核队列+1', store.getState().haccp.pendingReadings.length === pendingBefore + 1)
const releasedStatus = store.getState().haccp.batches.find(b => b.id === 'B260928-07')!.status
check('已放行批次结论未变', releasedStatus === '已放行', releasedStatus)

// 5. 待核核定：超限另立偏差，不回写
const pend = store.getState().haccp.pendingReadings[0]
const devCountBefore = store.getState().haccp.deviations.length
store.dispatch(resolvePendingReading(pend.id, true, 'LV-P2-V1', '质量员', '补录核实', true))
const st5 = store.getState().haccp
check('超晚到 71.9 按 V1 超限入批次读数', st5.batches.find(b => b.id === 'B260928-07')!.monitoring.some(m => m.id === pend.reading.id && m.status === '超限'))
check('另立偏差', st5.deviations.length === devCountBefore + 1)
check('原已放行批次仍未被直接改判隔离', st5.batches.find(b => b.id === 'B260928-07')!.status === '已放行')

// 驳回路径
const late2 = store.dispatch(addMonitoringReading({ batchId: 'B260928-07', stepId: 'P4', value: 0.2, unit: 'MPa', recordedAt: '2026-09-28T18:30:00', operator: '补录员', windowId: 'W-FIELD' }))
check('P4 晚到同样入待核', late2.enqueued === true)
const pend2 = store.getState().haccp.pendingReadings[0]
store.dispatch(resolvePendingReading(pend2.id, false, null, '质量员', '无法核实', false))
const st5b = store.getState().haccp
check('驳回后读数为已驳回且不入结论', st5b.batches.find(b => b.id === 'B260928-07')!.monitoring.some(m => m.id === pend2.reading.id && m.status === '已驳回'))

// 6. 并发窗口：W-1 先交，W-2 后交必须重选
const r6a = store.dispatch(addMonitoringReading({ batchId: 'B260929-01', stepId: 'P3', value: 1.2, unit: 'mm Fe', recordedAt: new Date().toISOString(), operator: 'A', windowId: 'W-1' }))
check('W-1 正常提交', !r6a.conflict && !r6a.enqueued)
const r6b = store.dispatch(addMonitoringReading({ batchId: 'B260929-01', stepId: 'P3', value: 1.3, unit: 'mm Fe', recordedAt: new Date().toISOString(), operator: 'B', windowId: 'W-2' }))
check('W-2 收到冲突需重选', r6b.conflict === true && r6b.rivalWindowId === 'W-1')
check('冲突时读数未入库', store.getState().haccp.batches.find(b => b.id === 'B260929-01')!.monitoring.filter(m => m.stepId === 'P3').length === 2)
const r6c = store.dispatch(addMonitoringReading({ batchId: 'B260929-01', stepId: 'P3', value: 1.3, unit: 'mm Fe', recordedAt: new Date().toISOString(), operator: 'B', windowId: 'W-2', rebased: true }))
check('重选后提交成功并标记 rebased', !r6c.conflict && store.getState().haccp.batches.find(b => b.id === 'B260929-01')!.monitoring.some(m => m.operator === 'B' && m.rebased))

// 7. 偏差复判另存一版
const dev = store.getState().haccp.deviations.find(d => d.id === 'DEV-260929-01')!
const revsBefore = dev.revisions.length
const origConclusion = dev.revisions[0].conclusion
store.dispatch(rejudgeDeviation(dev.id, 'LV-P2-V1', '质量主管', '维持原结论'))
const dev2 = store.getState().haccp.deviations.find(d => d.id === dev.id)!
check('复判追加一版', dev2.revisions.length === revsBefore + 1)
check('原结论原样保留', dev2.revisions[0].conclusion === origConclusion && dev2.revisions[0].origin === '原判定')
check('复判版标记 origin', dev2.revisions[dev2.revisions.length - 1].origin === '限值复判')
check('basisStale 清除', dev2.basisStale === false)

// 8. 新建偏差自动绑定当前/读数版本
store.dispatch(createDeviation({ batchId: 'B260929-01', stepId: 'P2', title: '测试偏差', severity: '一般', owner: '工程组' }))
const devNew = store.getState().haccp.deviations[0]
check('新偏差按读数时点绑定 V1（07:10 读数）', devNew.basisVersionId === 'LV-P2-V1' && devNew.revisions.length === 1, devNew.basisVersionId ?? 'null')

// 9. 写入失败 → 检查点不动、WAL 保留 → 重载恢复只补未完成
const seqBefore = store.getState().haccp.timeline.seq
const checkpointBefore = localStorageMap.get('gsb64:timeline-checkpoint')!
armWriteFailure() // 下一次 advanceCheckpoint 失败
const failRes = store.dispatch(addMonitoringReading({ batchId: 'B260929-01', stepId: 'P1', value: 3.9, unit: '℃', recordedAt: new Date().toISOString(), operator: 'C', windowId: 'W-1' }))
check('提交返回失败', failRes.ok === false)
check('内存待写队列有 1 条', store.getState().haccp.outbox.length === 1)
check('检查点停在旧时间线', localStorageMap.get('gsb64:timeline-checkpoint') === checkpointBefore)
check('WAL 已落盘', JSON.parse(localStorageMap.get('gsb64:timeline-outbox')!).length === 1)

// 模拟重开应用：重建 reducer（initialState 从检查点+WAL 恢复）
const store2 = makeStore()
const hs = store2.getState().haccp
check('恢复后未完成记录已补', hs.batches.find(b => b.id === 'B260929-01')!.monitoring.some(m => m.operator === 'C'))
check('恢复计数=1', hs.timeline.lastRecovered === 1)
check('恢复事件带 recovered 审计标记', hs.audit.some(a => a.recovered))
check('恢复后待写队列仍保留待重试', hs.outbox.length === 1)
const seqAfter = hs.timeline.seq
check('seq 连续未跳号', seqAfter === seqBefore + 1, `${seqBefore} -> ${seqAfter}`)
// 重试落盘
const retry = store2.dispatch(retryFlush())
check('重试成功', retry.ok === true && store2.getState().haccp.outbox.length === 0)
check('重试后再重载无重复（幂等）', makeStore().getState().haccp.batches.find(b => b.id === 'B260929-01')!.monitoring.filter(m => m.operator === 'C').length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
