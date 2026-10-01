import { useMemo, useState } from 'react'
import { Badge, Button, Field, Input, Radio, RadioGroup, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, useId } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { publishLimitVersion } from '../store/haccpSlice'
import type { LimitRule } from '../types'
import { fmtTime } from '../services/timeline'

type RuleKind = 'max' | 'min' | 'range' | 'manual'

export function ProcessControl() {
  const dispatch = useDispatch<AppDispatch>()
  const { processSteps, limitVersions, batches } = useSelector((root: RootState) => root.haccp)
  const [stepId, setStepId] = useState<string | null>(null)
  const step = processSteps.find((item) => item.id === stepId)
  const versions = useMemo(() => limitVersions.filter((item) => item.stepId === stepId).sort((a, b) => a.revision - b.revision), [limitVersions, stepId])
  const latest = versions[versions.length - 1]
  const staleCountByStep = useMemo(() => {
    const map: Record<string, number> = {}
    for (const batch of batches) for (const m of batch.monitoring) if (m.status === '失效待重判') map[m.stepId] = (map[m.stepId] ?? 0) + 1
    return map
  }, [batches])

  const fieldId = useId()
  const [label, setLabel] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [frequency, setFrequency] = useState('')
  const [correctiveAction, setCorrectiveAction] = useState('')
  const [kind, setKind] = useState<RuleKind>('min')
  const [num1, setNum1] = useState('')
  const [num2, setNum2] = useState('')
  const [unit, setUnit] = useState('')
  const [error, setError] = useState('')

  const openEditor = (id: string) => {
    const s = processSteps.find((item) => item.id === id)!
    const list = limitVersions.filter((item) => item.id === id || item.stepId === id).sort((a, b) => b.revision - a.revision)
    const cur = list[0]
    const r = cur?.rule
    setStepId(id)
    setLabel(cur?.label ?? s.limit)
    setFrequency(cur?.frequency ?? s.frequency)
    setCorrectiveAction(cur?.correctiveAction ?? s.correctiveAction)
    setKind(r?.min !== undefined ? 'min' : r?.max !== undefined ? 'max' : r?.rangeMin !== undefined ? 'range' : 'manual')
    setNum1(String(r?.min ?? r?.max ?? r?.rangeMin ?? ''))
    setNum2(String(r?.rangeMax ?? ''))
    setUnit(r?.unit ?? (id === 'P1' || id === 'P2' || id === 'P5' ? '℃' : id === 'P4' ? 'MPa' : 'mm'))
    // 默认生效时间：当前时刻（生产中途改版）
    const d = new Date(); d.setSeconds(0, 0)
    setEffectiveFrom(toLocalInput(d))
    setError('')
  }

  const save = () => {
    if (!step || !label.trim() || !correctiveAction.trim() || !effectiveFrom) { setError('限值、纠偏措施与生效时间均不能为空'); return }
    const a = Number(num1); const b = Number(num2)
    let rule: LimitRule | null = null
    if (kind === 'manual') rule = null
    else if (Number.isNaN(a) || (kind === 'range' && Number.isNaN(b))) { setError('限值数值无效'); return }
    else if (kind === 'max') rule = { max: a, unit }
    else if (kind === 'min') rule = { min: a, unit }
    else { if (b <= a) { setError('区间上限必须大于下限'); return }; rule = { rangeMin: a, rangeMax: b, unit } }
    const iso = new Date(effectiveFrom).toISOString()
    if (latest && iso <= latest.effectiveFrom) { setError(`新版本生效时间必须晚于现行 V${latest.revision} 的生效时间`); return }
    dispatch(publishLimitVersion({ stepId: step.id, label: label.trim(), frequency: frequency.trim() || '连续记录', correctiveAction: correctiveAction.trim(), rule, effectiveFrom: iso, operator: '质量主管' }))
    setStepId(null)
  }

  return (
    <section className="page">
      <header className="page-head"><div><p>危害分析 / 关键控制点 / 生效时间线</p><h1>HACCP控制矩阵</h1></div></header>
      <div className="rule-band warn"><strong>限值改版规则</strong><span>关键限值只能通过发布新版本生效；生效时点之前尚未重判的旧读数先失效，再按记录时点选版。已判定偏差保留原版本与结论，复判另存一版。</span></div>
      <div className="process-flow">{processSteps.map((item, index) => <div key={item.id}><b>{index + 1}</b><span>{item.name}</span><small>{item.equipment}</small></div>)}</div>
      <div className="table-panel">
        <Table size="small">
          <TableHeader><TableRow>
            <TableHeaderCell>步骤</TableHeaderCell><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>现行关键限值</TableHeaderCell>
            <TableHeaderCell>生效起</TableHeaderCell><TableHeaderCell>版本链</TableHeaderCell><TableHeaderCell>失效待重判</TableHeaderCell><TableHeaderCell />
          </TableRow></TableHeader>
          <TableBody>{processSteps.map((item) => {
            const list = limitVersions.filter((v) => v.stepId === item.id).sort((a, b) => b.revision - a.revision)
            const cur = list[0]
            const stale = staleCountByStep[item.id] ?? 0
            return <TableRow key={item.id}>
              <TableCell>{item.name}<div className="sub-text">{item.hazard}</div></TableCell>
              <TableCell>{item.controlPoint}</TableCell>
              <TableCell><strong>{cur?.label ?? item.limit}</strong></TableCell>
              <TableCell>{cur ? fmtTime(cur.effectiveFrom) : '—'}</TableCell>
              <TableCell><Badge appearance="tint" color="brand">{list.length} 版</Badge>{list.length > 1 && <div className="sub-text">当前 V{cur?.revision}，V1 已封闭</div>}</TableCell>
              <TableCell>{stale > 0 ? <Badge color="warning" appearance="tint">{stale} 条待重判</Badge> : <span className="sub-text">无</span>}</TableCell>
              <TableCell><Button size="small" appearance="primary" onClick={() => openEditor(item.id)}>发布新版本</Button></TableCell>
            </TableRow>
          })}</TableBody>
        </Table>
      </div>

      {step && <div className="edit-panel">
        <h3>{step.name} · 发布限值新版本 <small className="sub-text">现行：{latest?.label}（V{latest?.revision ?? 0}），新版本自动封闭旧版</small></h3>
        <div className="version-rail">
          {versions.map((v) => <div key={v.id} className={v.effectiveTo ? 'rail-item closed' : 'rail-item current'}>
            <b>V{v.revision}</b><span>{v.label}</span><small>{fmtTime(v.effectiveFrom)} 生效{v.effectiveTo ? ` · ${fmtTime(v.effectiveTo)} 封版` : ' · 现行'}</small>
          </div>)}
          <div className="rail-item new"><b>V{versions.length + 1}</b><span>{label || '待输入'}</span><small>{effectiveFrom ? fmtTime(new Date(effectiveFrom).toISOString()) : '待选生效时间'} 起生效</small></div>
        </div>
        <div className="edit-grid">
          <Field label="限值文本（审计展示）"><Input value={label} onChange={(_, d) => setLabel(d.value)} placeholder="如 ≥ 73 ℃ / 15 s" /></Field>
          <Field label="生效时间（生产中途可即时生效）"><Input id={fieldId} type="datetime-local" value={effectiveFrom} onChange={(_, d) => setEffectiveFrom(d.value)} /></Field>
          <Field label="监控频率"><Input value={frequency} onChange={(_, d) => setFrequency(d.value)} /></Field>
        </div>
        <div className="edit-grid">
          <Field label="结构化规则">
            <RadioGroup value={kind} onChange={(_, d) => setKind(d.value as RuleKind)} layout="horizontal">
              <Radio value="min" label="≥ 下限" /><Radio value="max" label="≤ 上限" /><Radio value="range" label="区间" /><Radio value="manual" label="仅人工判定" />
            </RadioGroup>
          </Field>
          {kind !== 'manual' && <Field label={kind === 'range' ? '下限' : '限值'}><Input type="number" value={num1} onChange={(_, d) => setNum1(d.value)} /></Field>}
          {kind === 'range' && <Field label="上限"><Input type="number" value={num2} onChange={(_, d) => setNum2(d.value)} /></Field>}
          {kind !== 'manual' && <Field label="单位"><Input value={unit} onChange={(_, d) => setUnit(d.value)} /></Field>}
        </div>
        <Field label="纠偏措施" style={{ marginTop: 10 }}><Input value={correctiveAction} onChange={(_, d) => setCorrectiveAction(d.value)} /></Field>
        {error && <p className="validation-text">{error}</p>}
        <p className="sub-text">发布后：{step.name}生效时点之前未重判的旧读数立即变为「失效待重判」；在批次监测段中按记录时点选 V{(latest?.revision ?? 0)} 或 V{versions.length + 1} 重判；已判定偏差仅挂「待复判」，不覆盖原结论。</p>
        <div className="record-actions"><Button onClick={() => setStepId(null)}>取消</Button><Button appearance="primary" onClick={save}>发布并写入时间线</Button></div>
      </div>}
    </section>
  )
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
