import { useMemo, useState } from 'react'
import { Button, Field, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { publishLimitVersion } from '../store/haccpSlice'
import { formatTime } from '../services/versioning'
import { VersionTag } from './shared'

export function ProcessControl() {
  const dispatch = useDispatch<AppDispatch>()
  const { processSteps, limitVersions, batches } = useSelector((root: RootState) => root.haccp)
  const [activeStep, setActiveStep] = useState(processSteps[0]?.id ?? '')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ limitText: '', frequency: '', correctiveAction: '', effectiveAt: '', changeNote: '' })

  const step = processSteps.find((item) => item.id === activeStep)
  const timeline = useMemo(() =>
    limitVersions.filter((item) => item.stepId === activeStep).sort((a, b) => b.versionNo - a.versionNo),
  [limitVersions, activeStep])
  const current = timeline[0] && !timeline[0].supersededAt ? timeline[0] : timeline.find((item) => !item.supersededAt)

  const affectedReadings = useMemo(() => {
    let unlocked = 0
    let locked = 0
    for (const batch of batches) for (const reading of batch.monitoring) {
      if (reading.stepId !== activeStep) continue
      if (reading.locked) locked += 1
      else unlocked += 1
    }
    return { unlocked, locked }
  }, [batches, activeStep])

  const openPublish = () => {
    setForm({
      limitText: current?.spec.text ?? step?.limit ?? '', frequency: current?.frequency ?? step?.frequency ?? '',
      correctiveAction: current?.correctiveAction ?? step?.correctiveAction ?? '',
      effectiveAt: new Date(Date.now() + 300000).toISOString().slice(0, 16),
      changeNote: ''
    })
    setEditing(true)
  }

  const publish = () => {
    if (!form.limitText.trim() || !form.effectiveAt) return
    dispatch(publishLimitVersion({
      stepId: activeStep, limitText: form.limitText.trim(), frequency: form.frequency,
      correctiveAction: form.correctiveAction, effectiveAt: form.effectiveAt.length === 16 ? `${form.effectiveAt}:00` : form.effectiveAt,
      operator: '质量主管 何舟', changeNote: form.changeNote || '未填写变更说明'
    }))
    setEditing(false)
  }

  return (
    <section className="page">
      <header className="page-head"><div><p>危害分析 / 关键控制点 / 生效时间线</p><h1>HACCP控制矩阵</h1></div></header>
      <div className="process-flow">{processSteps.map((item, index) => (
        <button key={item.id} className={item.id === activeStep ? 'active' : ''} onClick={() => setActiveStep(item.id)}>
          <b>{index + 1}</b><span>{item.name}</span><small>{item.equipment}</small>
        </button>
      ))}</div>

      {step && <div className="timeline-layout">
        <div className="table-panel">
          <div className="panel-head">
            <h2>{step.name} · 关键限值生效时间线</h2>
            <Button appearance="primary" size="small" onClick={openPublish}>发布新版限值</Button>
          </div>
          <p className="panel-sub">控制点：{step.controlPoint} · {step.hazard}。新版本发布后，旧版标记失效；未锁定的旧读数先置为待重判，再按各读数的记录时点在时间线上选版复判。已判偏差与已放行批次锁定的结论保留原版本。</p>
          <ol className="version-timeline">
            {timeline.map((version) => (
              <li key={version.id} className={version.supersededAt ? 'superseded' : 'active-version'}>
                <div className="version-dot"><b>V{version.versionNo}</b></div>
                <div className="version-body">
                  <header><VersionTag version={version} /><span className="muted">生效 {formatTime(version.effectiveAt)} · 发布 {formatTime(version.publishedAt)}</span>{version.supersededAt && <span className="muted">失效 {formatTime(version.supersededAt)}</span>}</header>
                  <p><strong>{version.spec.text}</strong> · 频率：{version.frequency}</p>
                  <p className="muted small">纠偏：{version.correctiveAction}</p>
                  <p className="small change-note">变更说明：{version.changeNote} —— {version.operator}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <aside className="record-panel impact-panel">
          <h3>本次变更影响面</h3>
          <dl>
            <div><dt>未锁定旧读数</dt><dd><strong className="text-warn">{affectedReadings.unlocked}</strong> 条将先失效、再按时点复判</dd></div>
            <div><dt>已锁结论</dt><dd><strong>{affectedReadings.locked}</strong> 条保留原版本（偏差/放行）</dd></div>
            <div><dt>历史版本</dt><dd>{timeline.length} 版完整保留</dd></div>
          </dl>
          <div className="rule-band vertical"><strong>选版规则</strong><span>判定只看读数的记录时点：取 effectiveAt ≤ 记录时点 的最后一版。晚到补录按记录时点选版，与现场声称版本不一致时进入待核，不直接改写结论。</span></div>
        </aside>
      </div>}

      {editing && current && <div className="edit-panel">
        <h3>{step?.name} · 发布新关键限值版本（V{timeline.length + 1}）</h3>
        <div className="edit-grid">
          <Field label="关键限值（如 ≥ 74 ℃ / 15 s 或 0.40-0.48 MPa）"><Input value={form.limitText} onChange={(_, data) => setForm({ ...form, limitText: data.value })} /></Field>
          <Field label="监控频率"><Input value={form.frequency} onChange={(_, data) => setForm({ ...form, frequency: data.value })} /></Field>
          <Field label="生效时间（按生产时点选版依据）"><Input type="datetime-local" value={form.effectiveAt} onChange={(_, data) => setForm({ ...form, effectiveAt: data.value })} /></Field>
          <Field label="纠偏措施" style={{ gridColumn: '1 / -1' }}><Input value={form.correctiveAction} onChange={(_, data) => setForm({ ...form, correctiveAction: data.value })} /></Field>
          <Field label="变更说明（进入审计时间线）" style={{ gridColumn: '1 / -1' }}><Input value={form.changeNote} onChange={(_, data) => setForm({ ...form, changeNote: data.value })} placeholder="如：秋季验证报告要求上调2℃" /></Field>
        </div>
        <p className="validation-text">发布即写审计：旧版V{timeline.length}整体失效；{affectedReadings.unlocked}条未锁定旧读数进入“先失效→按记录时点复判”，{affectedReadings.locked}条已锁结论不受影响。</p>
        <div className="record-actions"><Button onClick={() => setEditing(false)}>取消</Button><Button appearance="primary" disabled={!form.limitText || !form.correctiveAction || !form.effectiveAt} onClick={publish}>发布并驱动复判</Button></div>
      </div>}
    </section>
  )
}
