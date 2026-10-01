import { useMemo, useState } from 'react'
import { Badge, Button, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { fmtTime } from '../services/timeline'
import { VersionBadge } from '../components/VersionBadge'

export function AuditTrail() {
  const { audit, limitVersions, batches, deviations, pendingReadings, outbox, timeline } = useSelector((root: RootState) => root.haccp)
  const [keyword, setKeyword] = useState('')
  const rows = useMemo(() =>
    [...audit].sort((a, b) => b.timelineSeq - a.timelineSeq)
      .filter((item) => `${item.entity} ${item.action} ${item.operator} ${item.detail}`.includes(keyword)),
  [audit, keyword])

  const exportAudit = () => {
    const pack = {
      package: 'HACCP生效时间线追溯包',
      exportedAt: new Date().toISOString(),
      timeline: {
        lastCheckpointAt: timeline.checkpointAt,
        seq: timeline.seq,
        recoveredOnBoot: timeline.lastRecovered,
        pendingWrites: outbox
      },
      limitVersionTimeline: limitVersions
        .sort((a, b) => a.stepId.localeCompare(b.stepId) || a.revision - b.revision)
        .map((v) => ({ stepId: v.stepId, revision: v.revision, label: v.label, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, publishedAt: v.publishedAt, operator: v.operator, supersedes: v.supersedes })),
      batchMonitoring: batches.map((b) => ({
        batchId: b.id, status: b.status, version: b.version,
        readings: b.monitoring.map((m) => ({
          id: m.id, stepId: m.stepId, value: m.value, unit: m.unit,
          recordedAt: m.recordedAt, submittedAt: m.submittedAt, status: m.status,
          basisVersionId: m.basisVersionId, judgedAt: m.judgedAt, rejudged: !!m.rejudged,
          prior: m.prior, rebased: !!m.rebased
        }))
      })),
      pendingReviewQueue: pendingReadings,
      deviations: deviations.map((d) => ({ id: d.id, batchId: d.batchId, stepId: d.stepId, status: d.status, basisVersionId: d.basisVersionId, basisStale: !!d.basisStale, revisions: d.revisions })),
      events: [...audit].sort((a, b) => a.timelineSeq - b.timelineSeq)
    }
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'HACCP生效时间线追溯包.json'; anchor.click(); URL.revokeObjectURL(url)
  }

  return <section className="page">
    <header className="page-head"><div><p>批次 / 控制点 / 偏差 / 签字 · 按生效时间线排序</p><h1>完整追溯审计</h1></div><Button appearance="primary" onClick={exportAudit}>导出追溯包</Button></header>
    <div className="toolbar">
      <Input value={keyword} onChange={(_, data) => setKeyword(data.value)} placeholder="搜索实体、动作、操作人、限值" />
      <span>共 {rows.length} 条事件 · 检查点 {timeline.checkpointAt ? fmtTime(timeline.checkpointAt) : '演示基线'} · {outbox.length > 0 ? <Badge color="danger" appearance="tint">{outbox.length} 条待补写</Badge> : '全部已落盘'}</span>
    </div>
    <div className="table-panel"><Table size="small">
      <TableHeader><TableRow><TableHeaderCell style={{ width: 56 }}>序号</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>实体</TableHeaderCell><TableHeaderCell>动作</TableHeaderCell><TableHeaderCell>依据版本</TableHeaderCell><TableHeaderCell>操作人</TableHeaderCell><TableHeaderCell>说明</TableHeaderCell></TableRow></TableHeader>
      <TableBody>{rows.map((item) => <TableRow key={item.id}>
        <TableCell>#{item.timelineSeq}{item.recovered && <div><Badge size="small" color="warning" appearance="outline">恢复补写</Badge></div>}</TableCell>
        <TableCell>{fmtTime(item.createdAt)}</TableCell>
        <TableCell>{item.entity}</TableCell>
        <TableCell>{item.action}</TableCell>
        <TableCell>{item.versionId ? <VersionBadge versionId={item.versionId} /> : <span className="sub-text">—</span>}</TableCell>
        <TableCell>{item.operator}</TableCell>
        <TableCell>{item.detail}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div>
  </section>
}
