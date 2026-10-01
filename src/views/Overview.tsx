import { useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Badge, Button, Dropdown, Field, Input, Option, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import { addMonitoringReading, rejudgeReading, resolvePendingReading, setBatchFilter, setBatchStatus, setSelectedBatch, updateBatchStatus, type ReadingInput } from '../store/haccpSlice'
import type { BatchStatus, LimitVersion, MonitoringValue } from '../types'
import { useLoadBatchSnapshotQuery } from '../services/api'
import { fmtTime, versionAt } from '../services/timeline'
import { VersionBadge, readingStatusColor } from '../components/VersionBadge'

const statuses: Array<BatchStatus | '全部'> = ['全部', '生产中', '待复核', '可放行', '隔离中', '已放行', '已报废']
const statusColor = (status: BatchStatus) => status === '隔离中' || status === '已报废' ? 'danger' : status === '已放行' ? 'success' : status === '可放行' ? 'important' : 'warning'

export function Overview() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const { isFetching } = useLoadBatchSnapshotQuery()
  const rows = useMemo(() => state.batches.filter((batch) => {
    const text = `${batch.id} ${batch.product} ${batch.line}`.toLowerCase()
    return (!state.batchFilter || text.includes(state.batchFilter.toLowerCase())) && (state.batchStatus === '全部' || batch.status === state.batchStatus)
  }), [state.batches, state.batchFilter, state.batchStatus])
  const selected = state.batches.find((item) => item.id === state.selectedBatchId) ?? rows[0]
  const selectedDeviations = state.deviations.filter((item) => item.batchId === selected?.id)

  return (
    <section className="page">
      <header className="page-head"><div><p>质量运营中心 / 批次控制 / 限值分段监测</p><h1>生产批次与放行</h1></div><span className="sync-state">{isFetching ? '正在同步' : '批次快照已加载'}</span></header>
      <div className="metrics">
        <article><span>今日批次</span><strong>{state.batches.length}</strong><small>覆盖2条生产线</small></article>
        <article><span>隔离批次</span><strong>{state.batches.filter((item) => item.status === '隔离中').length}</strong><small>禁止放行</small></article>
        <article><span>失效待重判</span><strong>{state.batches.reduce((n, b) => n + b.monitoring.filter((m) => m.status === '失效待重判').length, 0)}</strong><small>限值更新后先失效</small></article>
        <article><span>晚到待核</span><strong>{state.pendingReadings.length}</strong><small>补录版本已失效</small></article>
      </div>
      <div className="toolbar">
        <Input value={state.batchFilter} onChange={(_, data) => dispatch(setBatchFilter(data.value))} placeholder="搜索批次、产品、产线" />
        <Dropdown value={state.batchStatus} selectedOptions={[state.batchStatus]} onOptionSelect={(_, data) => dispatch(setBatchStatus(data.optionValue as BatchStatus | '全部'))}>
          {statuses.map((s) => <Option key={s} value={s} text={s}>{s}</Option>)}
        </Dropdown>
        <span>批次详情按限值版本拆分监测段；点击批次查看</span>
      </div>
      <div className="split-layout">
        <div className="table-panel">
          <Table size="small" aria-label="生产批次">
            <TableHeader><TableRow><TableHeaderCell>批次</TableHeaderCell><TableHeaderCell>产品</TableHeaderCell><TableHeaderCell>产线</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>版本</TableHeaderCell></TableRow></TableHeader>
            <TableBody>
              {rows.map((batch) => <TableRow key={batch.id} onClick={() => dispatch(setSelectedBatch(batch.id))} className={batch.id === selected?.id ? 'selected-row' : ''}>
                <TableCell>{batch.id}</TableCell><TableCell>{batch.product}</TableCell><TableCell>{batch.line}</TableCell>
                <TableCell><Badge appearance="tint" color={statusColor(batch.status)}>{batch.status}</Badge>
                  {(batch.monitoring.some((m) => m.status === '失效待重判') || state.pendingReadings.some((p) => p.batchId === batch.id)) && <Badge style={{ marginLeft: 6 }} color="warning" appearance="outline">待办</Badge>}
                </TableCell><TableCell>V{batch.version}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
          <PendingQueuePanel />
        </div>
        {selected && <aside className="record-panel">
          <div className="record-title"><div><span>{selected.id} · {selected.line}</span><h2>{selected.product}</h2></div><Badge color={statusColor(selected.status)}>{selected.status}</Badge></div>
          <dl><div><dt>生产数量</dt><dd>{selected.quantity.toLocaleString()} 件</dd></div><div><dt>隔离范围</dt><dd>{selected.isolationScope}</dd></div><div><dt>关联偏差</dt><dd>{selectedDeviations.length} 项</dd></div></dl>

          <h3>限值前后监测段（按依据版本拆分）</h3>
          <MonitoringSegments batchId={selected.id} readings={selected.monitoring} />

          <AddReadingForm batchId={selected.id} />

          <div className="record-actions">
            <Button appearance="secondary" disabled={selectedDeviations.some((item) => item.status !== '已关闭')} onClick={() => dispatch(updateBatchStatus({ id: selected.id, status: '可放行' }))}>提交放行复核</Button>
            <Button appearance="primary" disabled={selected.status !== '可放行'} onClick={() => dispatch(updateBatchStatus({ id: selected.id, status: '已放行' }))}>签字放行</Button>
          </div>
          {selectedDeviations.some((item) => item.status !== '已关闭') && <p className="validation-text">存在未关闭偏差，系统已阻止标记为可放行。</p>}
        </aside>}
      </div>
    </section>
  )
}

/* ---------- 监测段：失效读数置顶，其余按依据版本分组（限值前 / 限值后） ---------- */

function MonitoringSegments({ batchId, readings }: { batchId: string; readings: MonitoringValue[] }) {
  const { limitVersions, processSteps } = useSelector((root: RootState) => root.haccp)
  const stale = readings.filter((r) => r.status === '失效待重判')
  const groups = useMemo(() => {
    const map = new Map<string, MonitoringValue[]>()
    for (const r of readings) {
      if (r.status === '失效待重判') continue
      const key = r.basisVersionId ?? 'UNBOUND'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return [...map.entries()].map(([versionId, list]) => ({ versionId, list: [...list].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)) }))
  }, [readings])

  return (
    <div className="segments">
      {stale.length > 0 && <div className="segment stale-segment">
        <header><Badge color="warning">失效待重判</Badge><span>关键限值更新后先失效；按记录时点选版重判，原结论留痕</span></header>
        {stale.map((r) => <RejudgeRow key={r.id} batchId={batchId} reading={r} />)}
      </div>}
      {groups.map(({ versionId, list }) => {
        const v = limitVersions.find((item) => item.id === versionId)
        return <div key={versionId} className={`segment ${v?.effectiveTo ? 'pre-limit' : 'post-limit'}`}>
          <header>
            {versionId === 'UNBOUND' ? <Badge appearance="outline">未绑定版本</Badge> : <VersionBadge versionId={versionId} />}
            <span>{v ? `${fmtTime(v.effectiveFrom)} 起${v.effectiveTo ? ` 至 ${fmtTime(v.effectiveTo)}（限值前监测段）` : '（现行限值监测段）'}` : ''} · {list.length} 条</span>
          </header>
          {list.map((r) => {
            const s = processSteps.find((item) => item.id === r.stepId)
            return <div key={r.id} className="monitor-row">
              <div><span>{s?.controlPoint ?? r.stepId}</span><strong>{r.value} {r.unit}</strong>
                <small>{r.operator} · 记录 {fmtTime(r.recordedAt)}{r.submittedAt && r.submittedAt !== r.recordedAt ? ` · 补录提交 ${fmtTime(r.submittedAt)}` : ''}</small>
              </div>
              <div className="monitor-right">
                <Badge appearance="tint" color={readingStatusColor(r.status)}>{r.status}</Badge>
                {r.rejudged && <Badge appearance="outline" color="brand" title="旧读数按记录时点重判，原结论保留在审计中">已重判</Badge>}
                {r.rebased && <Badge appearance="outline" color="brand">后到窗口重选</Badge>}
                {r.status === '已驳回' && <small className="sub-text">补录未采信，不改结论</small>}
              </div>
            </div>
          })}
        </div>
      })}
      {readings.length === 0 && <p className="sub-text">暂无监测读数</p>}
    </div>
  )
}

function RejudgeRow({ batchId, reading }: { batchId: string; reading: MonitoringValue }) {
  const dispatch = useDispatch<AppDispatch>()
  const { limitVersions, processSteps } = useSelector((root: RootState) => root.haccp)
  const s = processSteps.find((item) => item.id === reading.stepId)
  const suggested = versionAt(limitVersions, reading.stepId, reading.recordedAt)
  const [picking, setPicking] = useState(false)
  const [versionId, setVersionId] = useState(suggested?.id ?? '')
  const [note, setNote] = useState('')
  const prior = reading.prior
  const v = limitVersions.find((item) => item.id === versionId)

  return (
    <div className="monitor-row rejudge-row">
      <div>
        <span>{s?.controlPoint ?? reading.stepId}</span><strong>{reading.value} {reading.unit}</strong>
        <small>记录 {fmtTime(reading.recordedAt)} · {reading.operator}</small>
        {prior && <small className="rejudge-prior">原判定（保留）：{prior.status}，依据 <VersionBadge versionId={prior.basisVersionId} /></small>}
      </div>
      {!picking ? (
        <div className="monitor-right">
          <Badge color="warning" appearance="tint">失效待重判</Badge>
          <Button size="small" appearance="primary" onClick={() => { setVersionId(suggested?.id ?? ''); setPicking(true) }}>
            按时点重判{suggested ? `（V${suggested.revision}）` : ''}
          </Button>
        </div>
      ) : (
        <div className="rejudge-pick">
          <Dropdown size="small" value={v ? `V${v.revision} ${v.label}` : ''} selectedOptions={[versionId]} onOptionSelect={(_, d) => setVersionId(d.optionValue ?? '')}>
            {limitVersions.filter((item) => item.stepId === reading.stepId && item.effectiveFrom <= reading.recordedAt).map((item) => <Option key={item.id} value={item.id} text={`V${item.revision} ${item.label}`}>V{item.revision} {item.label}</Option>)}
          </Dropdown>
          <Input size="small" placeholder="备注（可选）" value={note} onChange={(_, d) => setNote(d.value)} />
          <Button size="small" onClick={() => setPicking(false)}>取消</Button>
          <Button size="small" appearance="primary" disabled={!versionId} onClick={() => { dispatch(rejudgeReading(batchId, reading.id, versionId, '质量主管', note)); setPicking(false) }}>确认重判（另存）</Button>
        </div>
      )}
    </div>
  )
}

/* ---------- 读数录入：晚到入待核；并发窗口后到一方重新选版 ---------- */

function AddReadingForm({ batchId }: { batchId: string }) {
  const dispatch = useDispatch<AppDispatch>()
  const { processSteps, limitVersions } = useSelector((root: RootState) => root.haccp)
  const now = new Date(); now.setSeconds(0, 0)
  const [form, setForm] = useState({ stepId: processSteps[0].id, value: '', unit: '℃', recordedAt: toLocalInput(now), operator: '现场记录员', windowId: 'W-1', chosenVersionId: '' })
  const [message, setMessage] = useState<{ kind: 'conflict' | 'enqueued' | 'ok' | 'fail'; text: string; rival?: string | null } | null>(null)

  const stepVersions = limitVersions.filter((v) => v.stepId === form.stepId).sort((a, b) => a.revision - b.revision)

  const submit = (rebased: boolean) => {
    const value = Number(form.value)
    if (Number.isNaN(value) || !form.recordedAt) { setMessage({ kind: 'fail', text: '请填写有效数值与记录时间' }); return }
    const payload: ReadingInput = {
      batchId, stepId: form.stepId, value, unit: form.unit,
      recordedAt: new Date(form.recordedAt).toISOString(), operator: form.operator,
      windowId: form.windowId, rebased,
      chosenVersionId: form.chosenVersionId || undefined
    }
    const result = dispatch(addMonitoringReading(payload))
    if (result.conflict) {
      setMessage({ kind: 'conflict', text: `窗口 ${result.rivalWindowId} 已先提交该控制点（同一版本窗口）。本窗口为后到一方，请重新选择判定依据版本后再提交。`, rival: result.rivalWindowId })
    } else if (result.enqueued) {
      setMessage({ kind: 'enqueued', text: '该补录声称依据的版本在提交时已失效，已进入待核队列，不会直接改写既有结论。' })
    } else if (!result.ok) {
      setMessage({ kind: 'fail', text: '检查点写入失败，该记录已进入待写队列；可在顶部「重试落盘」或刷新后自动补写。' })
    } else {
      setMessage({ kind: 'ok', text: rebased ? '已按重新选择的依据提交，并标记为后到窗口重选。' : '读数已写入对应限值版本监测段。' })
      setForm((f) => ({ ...f, value: '' }))
    }
  }

  return (
    <div className="add-reading">
      <h3>录入监测读数 / 现场补录</h3>
      <div className="add-grid">
        <Field label="控制点"><Dropdown size="small" value={processSteps.find((s) => s.id === form.stepId)?.name} selectedOptions={[form.stepId]} onOptionSelect={(_, d) => setForm({ ...form, stepId: d.optionValue ?? '', chosenVersionId: '', unit: defaultUnit(d.optionValue ?? '', processSteps[0].id) })}>
          {processSteps.map((s) => <Option key={s.id} value={s.id} text={s.name}>{s.name}</Option>)}
        </Dropdown></Field>
        <Field label="数值"><Input size="small" type="number" value={form.value} onChange={(_, d) => setForm({ ...form, value: d.value })} /></Field>
        <Field label="单位"><Input size="small" value={form.unit} onChange={(_, d) => setForm({ ...form, unit: d.value })} /></Field>
        <Field label="记录时点（选版依据）"><Input size="small" type="datetime-local" value={form.recordedAt} onChange={(_, d) => setForm({ ...form, recordedAt: d.value, chosenVersionId: '' })} /></Field>
        <Field label="录入窗口"><Dropdown size="small" value={form.windowId} selectedOptions={[form.windowId]} onOptionSelect={(_, d) => setForm({ ...form, windowId: d.optionValue ?? 'W-1' })}>
          <Option value="W-1" text="窗口一 W-1">窗口一 W-1</Option><Option value="W-2" text="窗口二 W-2">窗口二 W-2</Option><Option value="W-FIELD" text="现场补录端">现场补录端</Option>
        </Dropdown></Field>
        <Field label="依据版本（留空按时点自动选）"><Dropdown size="small" value={form.chosenVersionId ? labelOf(stepVersions, form.chosenVersionId) : '按记录时点自动选版'} selectedOptions={form.chosenVersionId ? [form.chosenVersionId] : []} onOptionSelect={(_, d) => setForm({ ...form, chosenVersionId: d.optionValue ?? '' })}>
          <Option value="" text="按记录时点自动选版">按记录时点自动选版</Option>
          {stepVersions.map((v) => <Option key={v.id} value={v.id} text={`V${v.revision} ${v.label}`}>V{v.revision} {v.label}{v.effectiveTo ? '（已封版）' : '（现行）'}</Option>)}
        </Dropdown></Field>
        <Field label="记录人"><Input size="small" value={form.operator} onChange={(_, d) => setForm({ ...form, operator: d.value })} /></Field>
      </div>
      {message && (
        <p className={`inline-msg ${message.kind}`}>
          {message.text}
          {message.kind === 'conflict' && <>
            {' '}
            <Button size="small" appearance="primary" onClick={() => submit(true)}>我是后到窗口，重新选版后提交</Button>
          </>}
        </p>
      )}
      <div className="record-actions"><Button appearance="primary" onClick={() => submit(false)}>提交读数</Button></div>
    </div>
  )
}

/* ---------- 晚到待核队列：核定选版 / 驳回，均不回写原结论 ---------- */

function PendingQueuePanel() {
  const dispatch = useDispatch<AppDispatch>()
  const { pendingReadings, limitVersions, batches, processSteps } = useSelector((root: RootState) => root.haccp)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [raiseDev, setRaiseDev] = useState<Record<string, boolean>>({})
  if (pendingReadings.length === 0) return null

  return (
    <div className="pending-panel">
      <h3><Badge color="informative" appearance="tint">待核队列 {pendingReadings.length}</Badge> 晚到现场补录：声称版本已失效，核定前不参与任何结论</h3>
      {pendingReadings.map((p) => {
        const batch = batches.find((b) => b.id === p.batchId)
        const step = processSteps.find((s) => s.id === p.reading.stepId)
        const claimed = limitVersions.find((v) => v.id === p.claimedVersionId)
        const auto = versionAt(limitVersions, p.reading.stepId, p.reading.recordedAt)
        const pick = picks[p.id] ?? auto?.id ?? ''
        const pickVersion = limitVersions.find((v) => v.id === pick)
        return <div key={p.id} className="pending-card">
          <div className="pending-head">
            <strong>{batch?.id} · {step?.name} {p.reading.value}{p.reading.unit}</strong>
            <span className="sub-text">记录 {fmtTime(p.reading.recordedAt)} ｜ 补录提交 {fmtTime(p.submittedAt)} ｜ 窗口 {p.windowId ?? '—'}</span>
          </div>
          <p className="sub-text">{p.reason}</p>
          <div className="pending-controls">
            <Field label="核定依据版本（按记录时点可选的历史版本）">
              <Dropdown size="small" value={pickVersion ? `V${pickVersion.revision} ${pickVersion.label}` : ''} selectedOptions={[pick]} onOptionSelect={(_, d) => setPicks({ ...picks, [p.id]: d.optionValue ?? '' })}>
                {limitVersions.filter((v) => v.stepId === p.reading.stepId && v.effectiveFrom <= p.reading.recordedAt).map((v) => <Option key={v.id} value={v.id} text={`V${v.revision} ${v.label}`}>V{v.revision} {v.label}（{fmtTime(v.effectiveFrom)} 生效）</Option>)}
              </Dropdown>
            </Field>
            <Field label="核实备注"><Input size="small" value={notes[p.id] ?? ''} onChange={(_, d) => setNotes({ ...notes, [p.id]: d.value })} placeholder="证据链、补录原因" /></Field>
            <label className="raise-check"><input type="checkbox" checked={raiseDev[p.id] ?? false} onChange={(e) => setRaiseDev({ ...raiseDev, [p.id]: e.target.checked })} /> 超限则另立偏差（不回写原批次结论）</label>
            <div className="pending-buttons">
              <Button size="small" onClick={() => dispatch(resolvePendingReading(p.id, false, null, '质量员', notes[p.id] ?? '补录无法核实', false))}>驳回（不采信）</Button>
              <Button size="small" appearance="primary" disabled={!pick} onClick={() => dispatch(resolvePendingReading(p.id, true, pick, '质量员', notes[p.id] ?? '', raiseDev[p.id] ?? false))}>核定并按 V{pickVersion?.revision} 判定</Button>
            </div>
          </div>
          {claimed && <small className="sub-text">现场声称依据：V{claimed.revision}「{claimed.label}」，该版已封版，仅作来证记录。</small>}
        </div>
      })}
    </div>
  )
}

function labelOf(list: LimitVersion[], id: string): string {
  const v = list.find((item) => item.id === id)
  return v ? `V${v.revision} ${v.label}${v.effectiveTo ? '（已封版）' : '（现行）'}` : ''
}

function defaultUnit(stepId: string, fallback: string): string {
  if (stepId === 'P1' || stepId === 'P2' || stepId === 'P5') return '℃'
  if (stepId === 'P4') return 'MPa'
  if (stepId === 'P3') return 'mm Fe'
  return fallback
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
