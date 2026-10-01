import { useMemo, useState } from 'react'
import { Badge, Button, Dropdown, Input, Option, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import type { AuditEntry } from '../types'
import { digest, formatTime } from '../services/versioning'

const categories: Array<AuditEntry['category'] | '全部'> = ['全部', '限值版本', '监测判定', '偏差处置', '批次流转', '写入恢复']
const categoryColor: Record<AuditEntry['category'], 'brand' | 'success' | 'danger' | 'warning' | 'informative'> = {
  限值版本: 'brand', 监测判定: 'informative', 偏差处置: 'danger', 批次流转: 'warning', 写入恢复: 'success'
}

export function AuditTrail() {
  const state = useSelector((root: RootState) => root.haccp)
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<(typeof categories)[number]>('全部')
  const versionMap = useMemo(() => new Map(state.limitVersions.map((v) => [v.id, v])), [state.limitVersions])

  const rows = state.audit.filter((item) => {
    const hitKeyword = `${item.entity} ${item.action} ${item.operator} ${item.detail}`.includes(keyword)
    return hitKeyword && (category === '全部' || item.category === category)
  })

  // 校验检查点哈希链：任一环节摘要不匹配即说明最后完整时间线不可信
  const chainCheck = useMemo(() => {
    let previousDigest = 'GENESIS'
    for (const checkpoint of state.checkpoints) {
      const expected = digest(previousDigest, checkpoint.readingIds.slice().sort().join(','), checkpoint.writeBatchIds.slice().sort().join(','), checkpoint.label, checkpoint.createdAt)
      if (expected !== checkpoint.digest) return { ok: false, brokenAt: checkpoint.id }
      previousDigest = checkpoint.digest
    }
    return { ok: true, brokenAt: '' }
  }, [state.checkpoints])

  const exportAudit = () => {
    const pack = {
      exportedAt: new Date().toISOString(),
      limitVersions: state.limitVersions, batches: state.batches, deviations: state.deviations,
      writeBatches: state.writeBatches, checkpoints: state.checkpoints, entryConflicts: state.entryConflicts, audit: state.audit
    }
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'HACCP追溯包-时间线版本.json'; anchor.click(); URL.revokeObjectURL(url)
  }

  return <section className="page">
    <header className="page-head"><div><p>批次 / 控制点 / 偏差 / 签字 / 写入恢复</p><h1>完整追溯审计（生效时间线）</h1></div><Button appearance="primary" onClick={exportAudit}>导出完整追溯包</Button></header>
    <div className="checkpoint-bar">
      <div><strong>时间线检查点 {state.checkpoints.length} 个</strong><small>每次完整写入、限值发布、复判、待核核选均生成检查点；写入失败不产生检查点</small></div>
      <Badge appearance="tint" color={chainCheck.ok ? 'success' : 'danger'}>{chainCheck.ok ? `哈希链校验通过（末点 ${state.checkpoints[state.checkpoints.length - 1]?.id}）` : `检查点 ${chainCheck.brokenAt} 校验失败，时间线不完整`}</Badge>
    </div>
    <div className="toolbar">
      <Input value={keyword} onChange={(_, data) => setKeyword(data.value)} placeholder="搜索实体、动作、操作人、依据版本" />
      <Dropdown value={category} selectedOptions={[category]} onOptionSelect={(_, data) => setCategory((data.optionValue as typeof category) ?? '全部')}>{categories.map((item) => <Option key={item} value={item}>{item}</Option>)}</Dropdown>
      <span>共{rows.length}条可追溯事件，按时间倒序，限值发布与复判均带版本引用</span>
    </div>
    <div className="table-panel"><Table size="small">
      <TableHeader><TableRow><TableHeaderCell style={{ minWidth: 132 }}>时间</TableHeaderCell><TableHeaderCell>类别</TableHeaderCell><TableHeaderCell>实体</TableHeaderCell><TableHeaderCell>动作</TableHeaderCell><TableHeaderCell>依据版本</TableHeaderCell><TableHeaderCell>操作人</TableHeaderCell><TableHeaderCell>说明</TableHeaderCell></TableRow></TableHeader>
      <TableBody>{rows.map((item) => {
        const version = item.versionRef ? versionMap.get(item.versionRef) : undefined
        return <TableRow key={item.id}>
          <TableCell>{formatTime(item.createdAt)}</TableCell>
          <TableCell><Badge appearance="tint" color={categoryColor[item.category]}>{item.category}</Badge></TableCell>
          <TableCell>{item.entity}</TableCell>
          <TableCell>{item.action}</TableCell>
          <TableCell>{version ? <span className={version.supersededAt ? 'version-old-text' : 'version-current-text'}>V{version.versionNo} · {version.spec.text}{version.supersededAt ? '（已失效）' : '（现行）'}</span> : <span className="muted">—</span>}</TableCell>
          <TableCell>{item.operator}</TableCell>
          <TableCell>{item.detail}</TableCell>
        </TableRow>
      })}</TableBody>
    </Table></div>

    <div className="checkpoint-list">
      <h3>最后完整时间线检查点</h3>
      {[...state.checkpoints].reverse().map((cp, index) => (
        <div key={cp.id} className="checkpoint-row">
          <b>{state.checkpoints.length - index}</b>
          <div><strong>{cp.label}</strong><small>{formatTime(cp.createdAt)} · {cp.readingIds.length}条读数 · {cp.writeBatchIds.length}个写入批次</small></div>
          <code>{cp.digest}</code>
        </div>
      ))}
      <p className="muted small">写入失败后从最后完整检查点恢复：已完成记录按客户端幂等号跳过，仅补未完成记录；恢复完成再追加新检查点，保证各入口看到同一版本关系。</p>
    </div>
  </section>
}
