// 渲染冒烟：捕获组件层运行时错误（纯 node 环境下尽量渲染）
import React from 'react'
import { renderToString } from 'react-dom/server'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { configureStore } from '@reduxjs/toolkit'
import reducer from '../src/store/haccpSlice'
import { haccpApi } from '../src/services/api'
import { Overview } from '../src/views/Overview'
import { ProcessControl } from '../src/views/ProcessControl'
import { DeviationWorkbench } from '../src/views/DeviationWorkbench'
import { AuditTrail } from '../src/views/AuditTrail'
import { TimelineStatus } from '../src/components/TimelineStatus'

const map = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => map.set(k, v),
  removeItem: (k: string) => map.delete(k)
}

function render(el: React.ReactNode) {
  const store = configureStore({
    reducer: { haccp: reducer, [haccpApi.reducerPath]: haccpApi.reducer },
    middleware: (get) => get().concat(haccpApi.middleware)
  })
  return renderToString(
    <Provider store={store}>
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>{el}</MemoryRouter>
      </FluentProvider>
    </Provider>
  )
}

const checks = [
  ['TimelineStatus', <TimelineStatus key="t" />],
  ['Overview', <Overview key="o" />],
  ['ProcessControl', <ProcessControl key="p" />],
  ['DeviationWorkbench', <DeviationWorkbench key="d" />],
  ['AuditTrail', <AuditTrail key="a" />]
]

let ok = 0
for (const [name, el] of checks) {
  try {
    const html = render(el)
    if (html && html.length > 100) { console.log('✓ rendered', name, html.length, 'chars'); ok++ }
    else { console.log('✗ empty render', name); process.exit(1) }
  } catch (e) {
    console.log('✗ render failed', name, (e as Error).message)
    process.exit(1)
  }
}
console.log(`\n${ok}/${checks.length} views rendered`)
