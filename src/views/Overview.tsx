import { useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Badge, Button, Dropdown, Field, Input, Option, Switch, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import { dismissEntryConflict, recoverWrites, resolveEntryConflict, resolvePendingReading, setBatchFilter, setBatchStatus, setSelectedBatch, submitMonitoring, updateBatchStatus } from '../store/haccpSlice'
import type { BatchStatus, LimitVersion, MonitoringValue } from '../types'
import { formatTime, versionAt } from '../services/versioning'
import { useCheckReleaseReadinessQuery } from '../services/api'
import { JudgeBadge, useStepMap, useVersionMap, VersionTag } from './shared'

const statuses: Array<BatchStatus | '全部'> = ['全部', '生产中', '待复核', '可放行', '隔离中', '已放行', '已报废']
const statusColor = (status: BatchStatus) => status === '隔离中' || status === '已报废' ? 'danger' : status === '已放行' ? 'success' : status === '可放行' ? 'important' : 'warning'

export function Overview() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const versionMap = useVersionMap()
  const stepMap = useStepMap()
  const rows = useMemo(() => state.batches.filter((batch) => {
    const text = `${batch.id} ${batch.product} ${batch.line}`.toLowerCase()
    return (!state.batchFilter || text.includes(state.batchFilter.toLowerCase())) && (state.batchStatus === '全部' || batch.status === state.batchStatus)
  }), [state.batches, state.batchFilter, state.batchStatus])
  const selected = state.batches.find((item) => item.id === state.selectedBatchId) ?? rows[0]
  const selectedDeviations = state.deviations.filter((item) => item.batchId === selected?.id)
  const pendingAll = state.batches.flatMap((batch) => batch.monitoring.filter((r) => r.judgeStatus === '待核').map((r) => ({ batch, reading: r })))
  const failedWrites = state.writeBatches.filter((item) => item.status === 'failed')

  return (
    <section className="page">
      <header className="page-head"><div><p>质量运营中心 / 批次控制 / 按记录时点选版</p><h1>生产批次与放行</h1></div><span className="sync-state">限值版本时间线已挂接：{state.limitVersions.length}版 · {state.checkpoints.length}个检查点</span></header>
      <div className="metrics">
        <article><span>今日批次</span><strong>{state.batches.length}</strong><small>覆盖2条生产线</small></article>
        <article><span>隔离批次</span><strong>{state.batches.filter((item) => item.status === '隔离中').length}</strong><small>禁止放行</small></article>
        <article><span>待核队列</span><strong className={pendingAll.length ? 'text-danger' : ''}>{pendingAll.length}</strong><small>晚到/依据冲突，未改写结论</small></article>
        <article><span>写入异常</span><strong className={failedWrites.length ? 'text-danger' : ''}>{failedWrites.length}</strong><small>{failedWrites.length ? '可从检查点恢复' : '时间线完整'}</small></article>
      </div>
      <div className="toolbar">
        <Input value={state.batchFilter} onChange={(_, data) => dispatch(setBatchFilter(data.value))} placeholder="搜索批次、产品、产线" />
        <Dropdown value={state.batchStatus} selectedOptions={[state.batchStatus]} onOptionSelect={(_, data) => dispatch(setBatchStatus(data.optionValue as BatchStatus | '全部'))}>
          {statuses.map((status) => <Option key={status} value={status}>{status}</Option>)}
        </Dropdown>
        {failedWrites.length > 0 && <Button appearance="primary" onClick={() => dispatch(recoverWrites())}>从最后完整时间线恢复（只补未完成记录）</Button>}
        {state.entryConflicts.length > 0 && <Badge appearance="filled" color="danger">{state.entryConflicts.length} 个并发提交待后到方改选依据</Badge>}
      </div>
      <div className="split-layout">
        <div className="table-panel">
          <Table size="small" aria-label="生产批次">
            <TableHeader><TableRow><TableHeaderCell>批次</TableHeaderCell><TableHeaderCell>产品</TableHeaderCell><TableHeaderCell>产线</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>版本</TableHeaderCell></TableRow></TableHeader>
            <TableBody>
              {rows.map((batch) => {
                const pending = batch.monitoring.some((item) => item.judgeStatus === '待核')
                return <TableRow key={batch.id} onClick={() => dispatch(setSelectedBatch(batch.id))} className={batch.id === selected?.id ? 'selected-row' : ''}>
                  <TableCell>{batch.id}{pending && <Badge className="inline-badge" size="small" color="warning">待核</Badge>}</TableCell>
                  <TableCell>{batch.product}</TableCell><TableCell>{batch.line}</TableCell>
                  <TableCell><Badge appearance="tint" color={statusColor(batch.status)}>{batch.status}</Badge></TableCell><TableCell>V{batch.version}</TableCell>
                </TableRow>
              })}
            </TableBody>
          </Table>
          <BatchDetail key={selected?.id} batchId={selected?.id} />
        </div>
        <aside className="side-stack">
          {selected && <ReleasePanel batchId={selected.id} />}
          <PendingQueue items={pendingAll} />
          <ConflictPanel />
        </aside>
      </div>
    </section>
  )
}

function ReleasePanel({ batchId }: { batchId: string }) {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const batch = state.batches.find((item) => item.id === batchId)
  if (!batch) return null
  const openDeviations = state.deviations.filter((item) => item.batchId === batch.id && item.status !== '已关闭')
  const pending = batch.monitoring.filter((item) => item.judgeStatus === '待核')
  const { data: readiness } = useCheckReleaseReadinessQuery({ batchId: batch.id, openDeviations: openDeviations.length, pendingReadings: pending.length })
  return <div className="record-panel">
    <div className="record-title"><div><span>{batch.id} · {batch.line}</span><h2>{batch.product}</h2></div><Badge color={statusColor(batch.status)}>{batch.status}</Badge></div>
    <dl>
      <div><dt>生产数量</dt><dd>{batch.quantity.toLocaleString()} 件（{formatTime(batch.producedAt)} 投产）</dd></div>
      <div><dt>隔离范围</dt><dd>{batch.isolationScope}</dd></div>
      <div><dt>关联偏差</dt><dd>{state.deviations.filter((item) => item.batchId === batch.id).length} 项（未关闭 {openDeviations.length}）</dd></div>
      <div><dt>待核读数</dt><dd className={pending.length ? 'text-danger' : ''}>{pending.length} 条</dd></div>
    </dl>
    <div className="record-actions">
      <Button appearance="secondary" disabled={openDeviations.length > 0 || pending.length > 0} onClick={() => dispatch(updateBatchStatus({ id: batch.id, status: '可放行' }))}>提交放行复核</Button>
      <Button appearance="primary" disabled={batch.status !== '可放行'} onClick={() => dispatch(updateBatchStatus({ id: batch.id, status: '已放行' }))}>签字放行</Button>
    </div>
    {(openDeviations.length > 0 || pending.length > 0) && <div className="validation-text">{(readiness?.reasons ?? []).map((reason) => <div key={reason}>· {reason}</div>)}放行后全部判定版本将按各自依据冻结。</div>}
  </div>
}

/** 批次详情：监测结果按依据版本拆成限值前/后各段 */
function BatchDetail({ batchId }: { batchId?: string }) {
  const state = useSelector((root: RootState) => root.haccp)
  const versionMap = useVersionMap()
  const stepMap = useStepMap()
  const batch = state.batches.find((item) => item.id === batchId)
  const [showEntry, setShowEntry] = useState(false)
  if (!batch) return null

  // 按记录时点排序，再按依据版本分段；版本切换处插入“限值前后”分隔
  const ordered = [...batch.monitoring].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
  const segments: Array<{ version: LimitVersion | null; readings: MonitoringValue[]; pending?: boolean }> = []
  for (const reading of ordered) {
    const basis = reading.basisVersionId ? versionMap.get(reading.basisVersionId) ?? null : null
    const last = segments[segments.length - 1]
    if (last && (last.version?.id ?? null) === (basis?.id ?? null) && last.pending === (reading.judgeStatus === '待核' && !basis)) {
      last.readings.push(reading)
    } else {
      segments.push({ version: basis, readings: [reading] })
    }
  }

  return <div className="batch-detail">
    <div className="panel-head"><h3>监测段（按限值版本前后拆分）</h3><Button size="small" appearance="subtle" onClick={() => setShowEntry((v) => !v)}>{showEntry ? '收起补录' : '现场补录 / 窗口提交'}</Button></div>
    {showEntry && <EntryForm batchId={batch.id} />}
    <div className="monitoring-segments">
      {segments.map((segment, index) => {
        const stepIds = [...new Set(segment.readings.map((r) => r.stepId))]
        return <div key={index} className="monitor-segment">
          <div className="segment-head">
            {segment.version ? <VersionTag version={segment.version} /> : <Badge appearance="outline" color="informative">无可用依据版本</Badge>}
            <span className="muted small">{stepIds.map((id) => stepMap.get(id)?.name).join('、')} · {segment.readings.length}条 · 时段 {formatTime(segment.readings[0].recordedAt)}–{formatTime(segment.readings[segment.readings.length - 1].recordedAt)}</span>
          </div>
          {segment.readings.map((item) => {
            const step = stepMap.get(item.stepId)
            const basis = item.basisVersionId ? versionMap.get(item.basisVersionId) : undefined
            const autoBasis = versionAt(state.limitVersions, item.stepId, item.recordedAt)
            return <div key={item.id} className={`monitoring-row ${item.judgeStatus === '待核' ? 'pending-row' : ''} ${item.locked ? 'locked-row' : ''}`}>
              <div className="mr-main"><span>{step?.controlPoint}</span><strong>{item.value} {item.unit}</strong></div>
              <div className="mr-meta"><small>{item.operator} · 记录 {formatTime(item.recordedAt)}{item.enteredAt !== item.recordedAt && <em>（补录于 {formatTime(item.enteredAt)}）</em>}</small></div>
              <div className="mr-verdict"><JudgeBadge status={item.judgeStatus} />{item.rejudgedAt && <Badge size="small" appearance="outline" color="severe">限值更新后复判</Badge>}{item.locked && <Badge size="small" appearance="outline">结论已锁定</Badge>}</div>
              <div className="mr-basis">
                <small>判定依据：</small><VersionTag version={basis} />
                {item.judgeStatus === '待核' && autoBasis && item.claimedBasisVersionId && autoBasis.id !== item.claimedBasisVersionId &&
                  <small className="text-warn">现场声称 {versionMap.get(item.claimedBasisVersionId) ? `V${versionMap.get(item.claimedBasisVersionId)!.versionNo}` : '未知版本'}，按时点应为 V{autoBasis.versionNo}</small>}
                {item.judgeStatus === '待核' && <small className="pending-reason">{item.pendingReason}</small>}
              </div>
            </div>
          })}
        </div>
      })}
    </div>
    <WriteBatchStrip batchId={batch.id} />
  </div>
}

function EntryForm({ batchId }: { batchId: string }) {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const steps = state.processSteps
  const [form, setForm] = useState({
    stepId: steps[0]?.id ?? '', value: '', unit: '℃', recordedAt: new Date().toISOString().slice(0, 16),
    operator: '现场记录员', claimOld: false, simulateFailure: false
  })
  const stepVersions = state.limitVersions.filter((item) => item.stepId === form.stepId).sort((a, b) => b.versionNo - a.versionNo)
  const autoBasis = versionAt(state.limitVersions, form.stepId, form.recordedAt.length === 16 ? `${form.recordedAt}:00` : form.recordedAt)
  const claimed = form.claimOld ? stepVersions.find((v) => v.id !== autoBasis?.id)?.id ?? null : null
  const submit = () => {
    dispatch(submitMonitoring({
      batchId, stepId: form.stepId, value: Number(form.value), unit: form.unit,
      recordedAt: form.recordedAt.length === 16 ? `${form.recordedAt}:00` : form.recordedAt,
      operator: form.operator, claimedBasisVersionId: claimed, simulateFailure: form.simulateFailure
    }))
    setForm({ ...form, value: '', simulateFailure: false })
  }
  return <div className="entry-form">
    <div className="edit-grid">
      <Field label="控制点"><Dropdown value={steps.find((s) => s.id === form.stepId)?.name ?? ''} selectedOptions={[form.stepId]} onOptionSelect={(_, d) => {
        const step = state.processSteps.find((s) => s.id === d.optionValue)
        setForm({ ...form, stepId: d.optionValue ?? '', unit: state.limitVersions.find((v) => v.stepId === d.optionValue)?.spec.unit ?? '' })
        void step
      }}>{steps.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}</Dropdown></Field>
      <Field label="测量值"><Input type="number" value={form.value} onChange={(_, d) => setForm({ ...form, value: d.value })} placeholder="数值" /></Field>
      <Field label="单位"><Input value={form.unit} onChange={(_, d) => setForm({ ...form, unit: d.value })} /></Field>
      <Field label="记录时点（现场测量时间）"><Input type="datetime-local" value={form.recordedAt} onChange={(_, d) => setForm({ ...form, recordedAt: d.value })} /></Field>
      <Field label="记录人"><Input value={form.operator} onChange={(_, d) => setForm({ ...form, operator: d.value })} /></Field>
      <Field label="晚到补录选项"><Switch checked={form.claimOld} onChange={(_, d) => setForm({ ...form, claimOld: d.checked })} label={form.claimOld ? '现场坚持按旧版声称（将进待核）' : '按记录时点自动选版'} /></Field>
      <Field label="演练"><Switch checked={form.simulateFailure} onChange={(_, d) => setForm({ ...form, simulateFailure: d.checked })} label="模拟写入中途失败（记录不落库）" /></Field>
    </div>
    <p className="muted small">按时点自动选版：{autoBasis ? <>V{autoBasis.versionNo}（{autoBasis.spec.text}）{autoBasis.supersededAt && '，该版对此时点虽已被替代但仍是当时有效依据'}</> : '记录时点早于首版，将进入待核'}；与同批次同控制点±60秒内已提交读数并发时，后到一方须改选依据。</p>
    <div className="record-actions"><Button appearance="primary" disabled={!form.value || Number.isNaN(Number(form.value))} onClick={submit}>提交读数</Button></div>
  </div>
}

function PendingQueue({ items }: { items: Array<{ batch: { id: string; product: string }; reading: MonitoringValue }> }) {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const versionMap = useVersionMap()
  const stepMap = useStepMap()
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  if (items.length === 0) return <div className="record-panel queue-panel ok"><h3>待核队列</h3><p className="muted small">暂无待核晚到记录。对应版本已失效或现场声称版本与按时点选版不一致的补录会在此等待质量核选，不会直接改写任何结论。</p></div>
  return <div className="record-panel queue-panel">
    <h3>待核队列（{items.length}）</h3>
    {items.map(({ batch, reading }) => {
      const step = stepMap.get(reading.stepId)
      const options = state.limitVersions.filter((v) => v.stepId === reading.stepId)
      const autoBasis = versionAt(state.limitVersions, reading.stepId, reading.recordedAt)
      const chosen = choice[reading.id] ?? autoBasis?.id ?? options[0]?.id ?? ''
      return <div key={reading.id} className="queue-item">
        <header><Badge color="warning">待核</Badge><strong>{batch.id} · {step?.name}</strong><small>{reading.value}{reading.unit} · 记录{formatTime(reading.recordedAt)} · 补录{formatTime(reading.enteredAt)}</small></header>
        <p className="pending-reason">{reading.pendingReason}</p>
        <div className="queue-actions">
          <Dropdown size="small" value={versionMap.get(chosen) ? `V${versionMap.get(chosen)!.versionNo} ${versionMap.get(chosen)!.spec.text}` : chosen} selectedOptions={[chosen]} onOptionSelect={(_, d) => setChoice({ ...choice, [reading.id]: d.optionValue ?? '' })}>
            {options.map((v) => <Option key={v.id} value={v.id} text={`V${v.versionNo} ${v.spec.text}`}>V{v.versionNo} {v.spec.text}（{v.supersededAt ? `已失效，${formatTime(v.effectiveAt)}起适用` : '现行'}）</Option>)}
          </Dropdown>
          <Button size="small" appearance="primary" onClick={() => { dispatch(resolvePendingReading({ readingId: reading.id, basisVersionId: chosen, note: note || '质量核选确认', operator: '质量负责人 秦岚' })); setNote('') }}>核选并判定</Button>
        </div>
      </div>
    })}
    <Input value={note} onChange={(_, d) => setNote(d.value)} placeholder="核选备注（进入审计）" />
  </div>
}

function ConflictPanel() {
  const dispatch = useDispatch<AppDispatch>()
  const { entryConflicts, limitVersions, processSteps } = useSelector((root: RootState) => root.haccp)
  const [choice, setChoice] = useState<Record<string, string>>({})
  if (entryConflicts.length === 0) return null
  return <div className="record-panel conflict-panel">
    <h3>并发提交冲突（{entryConflicts.length}）</h3>
    {entryConflicts.map((conflict) => {
      const step = processSteps.find((s) => s.id === conflict.stepId)
      const options = limitVersions.filter((v) => v.stepId === conflict.stepId)
      const chosen = choice[conflict.id] ?? options.find((v) => v.id === conflict.existingBasisVersionId)?.id ?? options[0]?.id ?? ''
      return <div key={conflict.id} className="queue-item danger">
        <header><Badge color="danger">后到方改选</Badge><strong>{conflict.batchId} · {step?.name}</strong></header>
        <p className="small">同一控制点同一记录时点（{formatTime(conflict.recordedAt)}）已有读数：先到方已按 <span className="inline-tag"><VersionTag version={limitVersions.find((v) => v.id === conflict.existingBasisVersionId)} /></span> 提交于{formatTime(conflict.existingEnteredAt)}；后到值 {conflict.value} {conflict.unit} 已挂起，不能覆盖先到结论。</p>
        <div className="queue-actions">
          <Dropdown size="small" value={limitVersions.find((v) => v.id === chosen) ? `V${limitVersions.find((v) => v.id === chosen)!.versionNo} ${limitVersions.find((v) => v.id === chosen)!.spec.text}` : chosen} selectedOptions={[chosen]} onOptionSelect={(_, d) => setChoice({ ...choice, [conflict.id]: d.optionValue ?? '' })}>
            {options.map((v) => <Option key={v.id} value={v.id} text={`V${v.versionNo} ${v.spec.text}`}>V{v.versionNo} {v.spec.text}</Option>)}
          </Dropdown>
          <Button size="small" appearance="primary" onClick={() => dispatch(resolveEntryConflict({ conflictId: conflict.id, basisVersionId: chosen, operator: '后到窗口 ' + conflict.operator }))}>按所选依据补提</Button>
          <Button size="small" appearance="subtle" onClick={() => dispatch(dismissEntryConflict({ conflictId: conflict.id }))}>放弃后到提交</Button>
        </div>
      </div>
    })}
  </div>
}

function WriteBatchStrip({ batchId }: { batchId: string }) {
  const writeBatches = useSelector((root: RootState) => root.haccp.writeBatches.filter((w) => w.batchId === batchId))
  const checkpoints = useSelector((root: RootState) => root.haccp.checkpoints)
  const dispatch = useDispatch<AppDispatch>()
  if (writeBatches.length === 0) return null
  return <div className="write-strip">
    <h4>写入批次与时间线检查点</h4>
    {writeBatches.map((w) => <div key={w.id} className={`write-row ${w.status}`}>
      <Badge appearance="tint" color={w.status === 'completed' ? 'success' : 'danger'}>{w.status === 'completed' ? '已完整写入' : '写入失败'}</Badge>
      <span>{w.id} · {formatTime(w.submittedAt)} · {w.operator}</span>
      <small>{w.note}（完成 {w.completedCount}/{w.clientIds.length}）</small>
      {w.status === 'failed' && <Button size="small" appearance="primary" onClick={() => dispatch(recoverWrites())}>恢复</Button>}
    </div>)}
    <small className="muted">最后完整检查点：{checkpoints[checkpoints.length - 1]?.id} · {checkpoints[checkpoints.length - 1]?.label} · 摘要 {checkpoints[checkpoints.length - 1]?.digest.slice(0, 8)}</small>
  </div>
}
