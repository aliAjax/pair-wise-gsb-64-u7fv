import { useState } from 'react'
import { Badge, Button } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { retryFlush } from '../store/haccpSlice'
import { armWriteFailure, fmtTime } from '../services/timeline'

/**
 * 生效时间线状态栏：四个入口统一显示
 * 最后完整检查点、待补写记录数、本次启动恢复条数，以及写入失败/重试。
 */
export function TimelineStatus() {
  const dispatch = useDispatch<AppDispatch>()
  const { timeline, outbox } = useSelector((root: RootState) => root.haccp)
  const [hint, setHint] = useState('')
  const pending = outbox.length

  const retry = () => {
    const result = dispatch(retryFlush())
    setHint(result.ok ? '检查点已推进，待补写记录全部完成' : '写入仍失败，请稍后重试')
    setTimeout(() => setHint(''), 3000)
  }
  const arm = () => {
    armWriteFailure()
    setHint('已注入：下一次提交的检查点推进会失败，事件进入待写队列，刷新页面可验证恢复')
    setTimeout(() => setHint(''), 5000)
  }

  return (
    <div className="timeline-band">
      <div className="timeline-items">
        <span><strong>最后完整时间线</strong><em>{timeline.checkpointAt ? fmtTime(timeline.checkpointAt) : '演示基线（未写入）'}</em></span>
        <span><strong>待补写记录</strong>
          {pending > 0 ? <Badge color="danger" appearance="tint">{pending} 条未完成</Badge> : <Badge color="success" appearance="tint">0 条</Badge>}
        </span>
        <span><strong>本次启动恢复</strong>
          {timeline.lastRecovered > 0 ? <Badge color="warning" appearance="tint">已补 {timeline.lastRecovered} 条</Badge> : <Badge appearance="outline">未触发</Badge>}
        </span>
        {hint && <small className="timeline-hint">{hint}</small>}
      </div>
      <div className="timeline-actions">
        <Button size="small" appearance="subtle" onClick={arm}>模拟下次写入失败</Button>
        <Button size="small" appearance={pending > 0 ? 'primary' : 'outline'} disabled={pending === 0} onClick={retry}>重试落盘</Button>
      </div>
    </div>
  )
}
