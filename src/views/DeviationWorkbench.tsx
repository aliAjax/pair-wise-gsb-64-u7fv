import { useMemo, useState } from 'react'
import { Badge, Button, Dropdown, Field, Input, Option, Textarea } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { createDeviation, reviewDeviation, rejudgeDeviation, saveInvestigation } from '../store/haccpSlice'
import { fmtTime } from '../services/timeline'
import { VersionBadge } from '../components/VersionBadge'
import type { DecisionType, Deviation, Investigation } from '../types'

export function DeviationWorkbench() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const [status, setStatus] = useState<Deviation['status'] | '全部'>('全部')
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const [showCreate, setShowCreate] = useState(false)
  const [newDeviation, setNewDeviation] = useState({ batchId: state.batches[0]?.id ?? '', stepId: state.processSteps[0]?.id ?? '', title: '', severity: '一般' as const, owner: '质量工程组' })
  const rows = useMemo(() => state.deviations.filter((item) => status === '全部' || item.status === status), [state.deviations, status])
  const selected = state.deviations.find((item) => item.id === selectedId) ?? rows[0]
  const [investigation, setInvestigation] = useState<Investigation | null>(null)
  const activeInvestigation = investigation?.cause === selected?.investigation.cause ? investigation : selected?.investigation

  return (
    <section className="page">
      <header className="page-head"><div><p>关键限值偏离 / 版本化调查与复核</p><h1>偏差处置工作台</h1></div><Button appearance="primary" onClick={() => setShowCreate(true)}>登记偏差</Button></header>
      <div className="rule-band warn"><strong>版本处置规则</strong><span>已判定偏差保留登记时的限值版本与结论；依据版本失效后通过「限值复判」另存一版，原判定不被覆盖。</span></div>
      <div className="toolbar"><Dropdown value={status} selectedOptions={[status]} onOptionSelect={(_, data) => setStatus(data.optionValue as typeof status)}>{['全部', '待调查', '调查中', '待复核', '已关闭'].map((item) => <Option key={item} value={item} text={item}>{item}</Option>)}</Dropdown><span>调查完成前批次保持隔离，复核签字后才能恢复放行流程。</span></div>
      <div className="split-layout">
        <div className="deviation-list">{rows.map((item) => <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setInvestigation(null) }}>
          <div><Badge color={item.severity === '重大' ? 'danger' : 'warning'}>{item.severity}</Badge><small>{item.id}</small></div>
          <strong>{item.title}</strong>
          <span>{item.batchId} · {item.owner}</span>
          <div className="dev-badges"><VersionBadge versionId={item.basisVersionId} />{item.basisStale && <Badge color="warning" appearance="tint">依据已失效·待复判</Badge>}</div>
          <footer><Badge appearance="tint">{item.status}</Badge><span>{item.dueDate} 截止 · {item.revisions.length} 版判定</span></footer>
        </button>)}</div>
        {selected && <div className="record-panel">
          <div className="record-title"><div><span>{selected.id} · 批次版本 V{selected.version}</span><h2>{selected.title}</h2></div><Badge color={selected.severity === '重大' ? 'danger' : 'warning'}>{selected.status}</Badge></div>

          <div className="basis-line">
            <span className="sub-text">登记依据</span><VersionBadge versionId={selected.basisVersionId} />
            {selected.basisStale && <Badge color="warning" appearance="tint">该版限值已封闭，结论维持原样，需复判另存</Badge>}
          </div>

          <div className="revision-rail">
            <h3>判定版本链（原版本与结论不可改写）</h3>
            {selected.revisions.map((rev) => <div key={rev.revision} className={`revision-card ${rev.origin === '限值复判' ? 'rejudged' : 'original'}`}>
              <header><b>第 {rev.revision} 版</b><Badge size="small" appearance="tint" color={rev.origin === '限值复判' ? 'brand' : 'success'}>{rev.origin}</Badge><small>{fmtTime(rev.judgedAt)} · {rev.judge}</small></header>
              <div className="revision-basis"><VersionBadge versionId={rev.basisVersionId} /></div>
              <p>{rev.conclusion}</p>
              {rev.note && <small className="sub-text">{rev.note}</small>}
              <small className="sub-text">处置分支：{rev.decision}</small>
            </div>)}
          </div>

          {selected.basisStale && <RejudgeBox deviationId={selected.id} stepId={selected.stepId} />}

          <Field label="原因判断"><Textarea value={activeInvestigation?.cause ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), cause: data.value })} /></Field>
          <Field label="证据摘要"><Textarea value={activeInvestigation?.evidence ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), evidence: data.value })} /></Field>
          <Field label="处置分支"><Dropdown value={activeInvestigation?.decision} selectedOptions={[activeInvestigation?.decision ?? '返工']} onOptionSelect={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), decision: data.optionValue as DecisionType })}>{['返工', '报废', '让步接收'].map((item) => <Option key={item} value={item} text={item}>{item}</Option>)}</Dropdown></Field>
          <Field label="返工或报废指令"><Textarea value={activeInvestigation?.reworkInstruction ?? ''} onChange={(_, data) => setInvestigation({ ...(activeInvestigation ?? selected.investigation), reworkInstruction: data.value })} /></Field>
          <div className="record-actions">
            <Button disabled={!activeInvestigation?.cause || !activeInvestigation?.evidence} onClick={() => dispatch(saveInvestigation(selected.id, activeInvestigation!))}>提交调查</Button>
            <Button appearance="primary" disabled={selected.status !== '待复核'} onClick={() => dispatch(reviewDeviation(selected.id, true, '调查证据充分，纠偏措施可执行。', '质量负责人 秦岚'))}>复核通过</Button>
          </div>
          <Button appearance="subtle" disabled={selected.status !== '待复核'} onClick={() => dispatch(reviewDeviation(selected.id, false, '需补充设备故障诊断记录。', '质量负责人 秦岚'))}>退回补充证据</Button>
        </div>}
      </div>
      {showCreate && <div className="edit-panel">
        <h3>登记关键限值偏差</h3>
        <div className="edit-grid">
          <Field label="批次"><Dropdown value={newDeviation.batchId} selectedOptions={[newDeviation.batchId]} onOptionSelect={(_, data) => setNewDeviation({ ...newDeviation, batchId: data.optionValue ?? '' })}>{state.batches.map((item) => <Option key={item.id} value={item.id} text={`${item.id} ${item.product}`}>{item.id} {item.product}</Option>)}</Dropdown></Field>
          <Field label="控制点"><Dropdown value={newDeviation.stepId} selectedOptions={[newDeviation.stepId]} onOptionSelect={(_, data) => setNewDeviation({ ...newDeviation, stepId: data.optionValue ?? '' })}>{state.processSteps.map((item) => <Option key={item.id} value={item.id} text={item.name}>{item.name}</Option>)}</Dropdown></Field>
          <Field label="偏差标题"><Input value={newDeviation.title} onChange={(_, data) => setNewDeviation({ ...newDeviation, title: data.value })} /></Field>
        </div>
        <p className="sub-text">登记时自动按该控制点最近读数的记录时点绑定限值版本；依据版本随版本链长期可追溯。</p>
        <div className="record-actions"><Button onClick={() => setShowCreate(false)}>取消</Button><Button appearance="primary" disabled={!newDeviation.title || !newDeviation.batchId} onClick={() => { dispatch(createDeviation(newDeviation)); setShowCreate(false) }}>创建并隔离批次</Button></div>
      </div>}
    </section>
  )
}

function RejudgeBox({ deviationId, stepId }: { deviationId: string; stepId: string }) {
  const dispatch = useDispatch<AppDispatch>()
  const { limitVersions, batches, deviations } = useSelector((root: RootState) => root.haccp)
  const deviation = deviations.find((d) => d.id === deviationId)
  const lastReading = batches.flatMap((b) => b.monitoring).filter((m) => m.stepId === stepId && (m.status === '合格' || m.status === '超限')).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]
  const stepVersions = limitVersions.filter((v) => v.stepId === stepId).sort((a, b) => a.revision - b.revision)
  const [versionId, setVersionId] = useState(lastReading?.basisVersionId ?? stepVersions[stepVersions.length - 1]?.id ?? '')
  const [note, setNote] = useState('')
  const v = limitVersions.find((item) => item.id === versionId)
  return (
    <div className="rejudge-box">
      <h3>限值复判（另存一版）</h3>
      <p className="sub-text">原第 1 版判定与结论保持不变；复判结果追加为第 {deviation?.revisions.length ?? 0 + 1} 版，写入同一时间线。</p>
      <div className="rejudge-form">
        <Dropdown size="small" value={v ? `V${v.revision} ${v.label}` : ''} selectedOptions={[versionId]} onOptionSelect={(_, d) => setVersionId(d.optionValue ?? '')}>
          {stepVersions.map((item) => <Option key={item.id} value={item.id} text={`V${item.revision} ${item.label}`}>V{item.revision} {item.label}{item.effectiveTo ? '（已封版）' : '（现行）'}</Option>)}
        </Dropdown>
        <Input size="small" placeholder="复判说明（可选）" value={note} onChange={(_, d) => setNote(d.value)} />
        <Button size="small" appearance="primary" disabled={!versionId || versionId === deviation?.basisVersionId && deviation.revisions.length > 1} onClick={() => { dispatch(rejudgeDeviation(deviationId, versionId, '质量主管', note)); setNote('') }}>提交复判（追加版本）</Button>
      </div>
    </div>
  )
}
