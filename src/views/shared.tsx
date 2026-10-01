import { Badge } from '@fluentui/react-components'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import type { JudgeStatus, LimitVersion } from '../types'
import { formatTime } from '../services/versioning'

export function useVersionMap() {
  const versions = useSelector((root: RootState) => root.haccp.limitVersions)
  return new Map(versions.map((item) => [item.id, item]))
}

export function useStepMap() {
  const steps = useSelector((root: RootState) => root.haccp.processSteps)
  return new Map(steps.map((item) => [item.id, item]))
}

export function VersionTag({ version, dim }: { version: LimitVersion | undefined; dim?: boolean }) {
  if (!version) return <Badge appearance="outline" color="informative">无依据版本</Badge>
  return (
    <span className={`version-tag ${dim ? 'dim' : ''} ${version.supersededAt ? 'old' : 'current'}`} title={`发布于${formatTime(version.publishedAt)} · ${version.changeNote}`}>
      <b>V{version.versionNo}</b>
      <small>{version.spec.text}</small>
      {version.supersededAt ? <i className="tag-flag">已失效</i> : <i className="tag-flag">现行</i>}
    </span>
  )
}

export const judgeColor: Record<JudgeStatus, 'success' | 'danger' | 'warning' | 'informative' | 'severe'> = {
  合格: 'success',
  超限: 'danger',
  待重判: 'severe',
  待核: 'warning',
  未判定: 'informative'
}

export function JudgeBadge({ status }: { status: JudgeStatus }) {
  return <Badge appearance="tint" color={judgeColor[status]}>{status}</Badge>
}
