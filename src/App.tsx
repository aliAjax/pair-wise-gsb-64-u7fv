import { NavLink, Navigate, Route, Routes, BrowserRouter } from 'react-router-dom'
import { Badge, Button } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from './store'
import { resetDemoData } from './store/haccpSlice'
import { TimelineStatus } from './components/TimelineStatus'
import { Overview } from './views/Overview'
import { ProcessControl } from './views/ProcessControl'
import { DeviationWorkbench } from './views/DeviationWorkbench'
import { AuditTrail } from './views/AuditTrail'

const navigation = [
  ['/', '生产批次'],
  ['/process', 'HACCP控制矩阵'],
  ['/deviations', '偏差调查'],
  ['/audit', '追溯审计']
]

function Shell() {
  const dispatch = useDispatch<AppDispatch>()
  const openDeviations = useSelector((state: RootState) => state.haccp.deviations.filter((item) => item.status !== '已关闭').length)
  const pendingCount = useSelector((state: RootState) => state.haccp.pendingReadings.length)
  const staleCount = useSelector((state: RootState) => state.haccp.batches.reduce((n, batch) => n + batch.monitoring.filter((m) => m.status === '失效待重判').length, 0))
  return (
    <div className="app-shell">
      <aside>
        <div className="brand"><b>H</b><div><strong>食品安全控制台</strong><small>HACCP限值时间线与偏差追溯</small></div></div>
        <nav>{navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>
          <span>{label}</span>
          {label === '偏差调查' && openDeviations > 0 && <Badge appearance="filled" color="danger">{openDeviations}</Badge>}
        </NavLink>)}</nav>
        <div className="aside-version">
          <strong>生效时间线待办</strong>
          <span><em>失效待重判</em><b>{staleCount}</b></span>
          <span><em>晚到待核</em><b>{pendingCount}</b></span>
          <span><em>未关闭偏差</em><b>{openDeviations}</b></span>
        </div>
        <div className="aside-note"><strong>生产日</strong><span>2026-09-29</span><small>数据源：检查点 + 待写队列</small></div>
      </aside>
      <main>
        <TimelineStatus />
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/process" element={<ProcessControl />} />
          <Route path="/deviations" element={<DeviationWorkbench />} />
          <Route path="/audit" element={<AuditTrail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Button className="reset-button" appearance="subtle" onClick={() => dispatch(resetDemoData())}>恢复演示基线</Button>
      </main>
    </div>
  )
}

export function App() {
  return <BrowserRouter><Shell /></BrowserRouter>
}
