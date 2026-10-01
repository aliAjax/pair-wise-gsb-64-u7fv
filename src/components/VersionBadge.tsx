import { Badge } from '@fluentui/react-components'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { fmtTime } from '../services/timeline'

/** 限值版本徽标：所有入口共用同一版本关系表述 */
export function VersionBadge({ versionId, expired, size = 'small' }: { versionId: string | null | undefined; expired?: boolean; size?: 'small' | 'medium' }) {
  const versions = useSelector((root: RootState) => root.haccp.limitVersions)
  const v = versions.find((item) => item.id === versionId)
  if (!v) return <Badge size={size} appearance="outline">版本未绑定</Badge>
  const isClosed = v.effectiveTo !== null || expired
  return (
    <Badge
      size={size}
      appearance="tint"
      color={isClosed ? 'brand' : 'success'}
      title={`生效 ${fmtTime(v.effectiveFrom)}${v.effectiveTo ? `；失效于 ${fmtTime(v.effectiveTo)}` : '；现行版本'}｜${v.label}`}
    >
      V{v.revision} · {v.label}{isClosed ? '（已封版）' : '（现行）'}
    </Badge>
  )
}

export function readingStatusColor(status: string): 'success' | 'danger' | 'warning' | 'informative' {
  switch (status) {
    case '合格': return 'success'
    case '超限': return 'danger'
    case '失效待重判': return 'warning'
    case '待核': return 'informative'
    default: return 'informative'
  }
}
