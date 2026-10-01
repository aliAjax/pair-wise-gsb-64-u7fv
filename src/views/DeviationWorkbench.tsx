import { useMemo, useState } from 'react'
import { Badge, Button, Dropdown, Field, Input, Option, Textarea } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { createDeviation, reviewDeviation, rejudgeDeviation, saveInvestigation } from '../store/haccpSlice'
import type { DecisionType, Deviation, Investigation, MonitoringValue } from '../types'
import { formatTime } from '../services/versioning'
import { JudgeBadge, useStepMap, useVersionMap, VersionTag } from './shared'

export function DeviationWorkbench() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const [status, setStatus] = useState<Deviation['status'] | '全部'>('全部')
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const [showCreate, setShowCreate] = useState(false)
  const rows = useMemo(() => state.deviations.filter((item) => status === '全部' || item.status === status), [state.deviations, status])
  const selected = state.deviations.find((item) => item.id === selectedId) ?? rows[0]
  const [investigation, setInvestigation] = useState<Investigation | null>(null)
  const activeInvestigation = investigation && selected && investigation.cause !== selected.investigation.cause ? investigation : selected?.investigation

  return (
    <section className="page">
      <header className="page-head"><div><p>关键限值偏离 / 调查与复核 / 版本化结论</p><h1>偏差处置工作台</h1></div><Button appearance="primary" onClick={() => setShowCreate(true)}>登记偏差</Button></header>
      <div className="toolbar"><Dropdown value={status} selectedOptions={[status]} onOptionSelect={(_, data) => setStatus(data.optionValue as typeof status)}>{['全部', '待调查', '调查中', '待复核', '已关闭'].map((item) => <Option key={item} value={item}>{item}</Option>)}</Dropdown><span>已判定偏差保留初判版本与结论；新版限值生效后只能“复判另存一版”，不改写历史。</span></div>
      <div className="split-layout">
        <div className="deviation-list">{rows.map((item) => {
          const latest = item.revisions[item.revisions.length - 1]
          return <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setInvestigation(null) }}>
            <div><Badge color={item.severity === '重大' ? 'danger' : 'warning'}>{item.severity}</Badge><small>{item.id}</small></div>
            <strong>{item.title}</strong>
            <span>{item.batchId} · {item.owner}</span>
            <footer><Badge appearance="tint">{item.status}</Badge><span>{item.revisions.length}版结论 · 当前依据V{latest ? state.limitVersions.find((v) => v.id === latest.basisVersionId)?.versionNo ?? '?' : '?'}</span><span>{item.dueDate} 截止</span></footer>
          </button>
        })}</div>
        {selected && <div className="record-panel deviation-panel">
          <div className="record-title"><div><span>{selected.id} · 批次 {selected.batchId}</span><h2>{selected.title}</h2></div><Badge color={selected.severity === '重大' ? 'danger' : 'warning'}>{selected.status}</Badge></div>
          <RevisionChain deviation={selected} />
          <Field label="原因判断"><Textarea value={activeInvestigation?.cause ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), cause: data.value })} /></Field>
          <Field label="证据摘要"><Textarea value={activeInvestigation?.evidence ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), evidence: data.value })} /></Field>
          <Field label="处置分支"><Dropdown value={activeInvestigation?.decision} selectedOptions={[activeInvestigation?.decision ?? '返工']} onOptionSelect={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), decision: data.optionValue as DecisionType })}>{['返工', '报废', '让步接收'].map((item) => <Option key={item} value={item} text={item}>{item}</Option>)}</Dropdown></Field>
          <Field label="返工或报废指令"><Textarea value={activeInvestigation?.reworkInstruction ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), reworkInstruction: data.value })} /></Field>
          <div className="record-actions">
            <Button disabled={!activeInvestigation?.cause || !activeInvestigation?.evidence} onClick={() => dispatch(saveInvestigation({ id: selected.id, investigation: activeInvestigation! }))}>提交调查</Button>
            <Button appearance="subtle" onClick={() => dispatch(rejudgeDeviation({ id: selected.id, operator: '质量主管 何舟' }))}>按当前时间线重新选版复判（另存一版）</Button>
            <Button appearance="primary" disabled={selected.status !== '待复核'} onClick={() => dispatch(reviewDeviation({ id: selected.id, approved: true, note: '调查证据充分，纠偏措施可执行，确认最新版结论。', reviewer: '质量负责人 秦岚' }))}>复核通过</Button>
          </div>
          <Button appearance="subtle" disabled={selected.status !== '待复核'} onClick={() => dispatch(reviewDeviation({ id: selected.id, approved: false, note: '需补充设备故障诊断记录。', reviewer: '质量负责人 秦岚' }))}>退回补充证据</Button>
        </div>}
      </div>
      {showCreate && <CreateDeviation onClose={() => setShowCreate(false)} />}
    </section>
  )
}

function RevisionChain({ deviation }: { deviation: Deviation }) {
  const state = useSelector((root: RootState) => root.haccp)
  const versionMap = useVersionMap()
  const stepMap = useStepMap()
  const reading = state.batches.flatMap((b) => b.monitoring).find((r) => r.id === deviation.readingId)
  return (
    <div className="revision-chain">
      <h4>判定版本链（初判冻结，复判追加）</h4>
      {reading && <p className="small muted">关联读数：{reading.value}{reading.unit} · 记录时点 {formatTime(reading.recordedAt)} · {stepMap.get(reading.stepId)?.controlPoint} <JudgeBadge status={reading.judgeStatus} /></p>}
      {deviation.revisions.map((revision, index) => {
        const basis = versionMap.get(revision.basisVersionId)
        return <div key={revision.revisionNo} className={`revision-card ${revision.source === '初判' ? 'initial' : 'rejudge'}`}>
          <header>
            <Badge appearance="tint" color={revision.verdict === '超限' ? 'danger' : 'success'}>第{revision.revisionNo}版 · {revision.verdict}</Badge>
            <Badge appearance="outline">{revision.source}</Badge>
            {revision.confirmed && <Badge appearance="outline" color="success">已签字确认</Badge>}
            <span className="muted small">{formatTime(revision.decidedAt)} · {revision.operator}</span>
          </header>
          <div className="revision-basis"><small>该版依据</small><VersionTag version={basis} dim /><small>读数 {revision.readingValue} {revision.unit}（限值文本：{revision.limitText}）</small></div>
          <p className="small">{revision.note}</p>
          {index < deviation.revisions.length - 1 && <div className="revision-arrow">↓ 后续版本不改写本版结论</div>}
        </div>
      })}
    </div>
  )
}

function CreateDeviation({ onClose }: { onClose: () => void }) {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const versionMap = useVersionMap()
  const stepMap = useStepMap()
  const [batchId, setBatchId] = useState(state.batches[0]?.id ?? '')
  const eligibleReadings = state.batches.find((b) => b.id === batchId)?.monitoring.filter((r) => r.judgeStatus === '合格' || r.judgeStatus === '超限') ?? []
  const [readingId, setReadingId] = useState<MonitoringValue | null>(null)
  const [form, setForm] = useState<{ title: string; severity: '一般' | '重大'; owner: string }>({ title: '', severity: '一般', owner: '质量工程组' })
  const chosen = readingId ?? eligibleReadings[0] ?? null
  const basis = chosen ? versionMap.get(chosen.basisVersionId ?? '') : undefined

  return <div className="edit-panel">
    <h3>登记关键限值偏差（按读数版本锁定初判）</h3>
    <div className="edit-grid">
      <Field label="批次"><Dropdown value={state.batches.find((b) => b.id === batchId)?.id ?? ''} selectedOptions={[batchId]} onOptionSelect={(_, d) => { setBatchId(d.optionValue ?? ''); setReadingId(null) }}>{state.batches.map((b) => <Option key={b.id} value={b.id} text={`${b.id} ${b.product}`}>{b.id} {b.product}</Option>)}</Dropdown></Field>
      <Field label="读数（待核/待重判读数不能登记）"><Dropdown value={chosen ? `${chosen.value}${chosen.unit} ${formatTime(chosen.recordedAt)}` : ''} selectedOptions={chosen ? [chosen.id] : []} onOptionSelect={(_, d) => setReadingId(eligibleReadings.find((r) => r.id === d.optionValue) ?? null)}>
        {eligibleReadings.map((r) => <Option key={r.id} value={r.id} text={`${stepMap.get(r.stepId)?.name} ${r.value}${r.unit} ${formatTime(r.recordedAt)}`}>{stepMap.get(r.stepId)?.name} {r.value}{r.unit} {formatTime(r.recordedAt)} · {r.judgeStatus}</Option>)}
      </Dropdown></Field>
      <Field label="偏差标题"><Input value={form.title} onChange={(_, d) => setForm({ ...form, title: d.value })} /></Field>
      <Field label="严重度"><Dropdown value={form.severity} selectedOptions={[form.severity]} onOptionSelect={(_, d) => setForm({ ...form, severity: (d.optionValue ?? '一般') as '一般' | '重大' })}>{['一般', '重大'].map((v) => <Option key={v} value={v} text={v}>{v}</Option>)}</Dropdown></Field>
      <Field label="责任人/组"><Input value={form.owner} onChange={(_, d) => setForm({ ...form, owner: d.value })} /></Field>
    </div>
    {chosen && basis && <p className="rule-band"><strong>初判依据</strong><span>读数 {chosen.value}{chosen.unit} 记录于 {formatTime(chosen.recordedAt)}，按记录时点选版 V{basis.versionNo}（{basis.spec.text}），判定{chosen.judgeStatus}；登记后该读数及本版结论锁定，限值再更新只能复判另存。</span></p>}
    <div className="record-actions"><Button onClick={onClose}>取消</Button><Button appearance="primary" disabled={!form.title || !chosen} onClick={() => { if (chosen) dispatch(createDeviation({ batchId, readingId: chosen.id, title: form.title, severity: form.severity, owner: form.owner })); onClose() }}>创建并隔离批次</Button></div>
  </div>
}
