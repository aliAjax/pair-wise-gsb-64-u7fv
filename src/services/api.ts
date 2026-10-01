import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import { seedBatches } from '../data/seed'
import type { Batch } from '../types'

export const haccpApi = createApi({
  reducerPath: 'haccpApi',
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    loadBatchSnapshot: builder.query<Batch[], void>({
      queryFn: async () => ({ data: structuredClone(seedBatches) })
    }),
    /** 放行就绪：未关闭偏差或待核晚到读数均阻止放行，两个入口口径一致 */
    checkReleaseReadiness: builder.query<{ ready: boolean; reasons: string[] }, { batchId: string; openDeviations: number; pendingReadings: number }>({
      queryFn: async ({ batchId, openDeviations, pendingReadings }) => {
        const reasons: string[] = []
        if (openDeviations > 0) reasons.push(`${batchId}仍有${openDeviations}项未关闭偏差（初判/复判版本链未闭环）`)
        if (pendingReadings > 0) reasons.push(`${batchId}有${pendingReadings}条晚到记录在待核队列，依据版本未经质量核选`)
        return { data: { ready: reasons.length === 0, reasons } }
      }
    })
  })
})

export const { useLoadBatchSnapshotQuery, useCheckReleaseReadinessQuery } = haccpApi
