import { configureStore } from '@reduxjs/toolkit'
import haccpReducer, { buildStateFromStorage, hydrate, CHECKPOINT_KEY } from './haccpSlice'
import { haccpApi } from '../services/api'
import { loadOutbox } from '../services/timeline'

export const store = configureStore({
  reducer: {
    haccp: haccpReducer,
    [haccpApi.reducerPath]: haccpApi.reducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(haccpApi.middleware)
})

/**
 * 多窗口时间线一致：其他标签页推进检查点后，本窗口合并其完整时间线，
 * 保证「两个窗口同时提交同一控制点」的提交槽在两个入口看到的是同一份关系。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== CHECKPOINT_KEY && event.key !== 'gsb64:timeline-outbox') return
    const state = buildStateFromStorage(false)
    if (state) {
      const local = store.getState().haccp
      // 仅当外部时间线更新时合并；本地存在未落盘记录时以本地为准，避免覆盖待补写事件
      const externalNewer = state.timeline.seq >= local.timeline.seq && loadOutbox().length === 0
      if (externalNewer || (event.key === 'gsb64:timeline-outbox' && state.timeline.seq > local.timeline.seq)) {
        store.dispatch(hydrate(state))
      }
    }
  })
}

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
