import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AssistantLauncher } from '../features/assistant/assistant-launcher'

import { CardSkeleton, EmptyState, ErrorState } from '../components/feedback/states'
import { CompareView } from '../features/planner/compare-view'
import { GeneratePanel } from '../features/planner/generate-panel'
import { PlannerGrid } from '../features/planner/planner-grid'
import { useVersion, useVersions } from '../features/planner/queries'
import { VersionBar } from '../features/planner/version-bar'

/**
 * The planning screen: a version toolbar, the week itself, the generator and
 * the comparator. Which version you are looking at is the only state this page
 * owns; everything else belongs to the server.
 */
export function PlanningPage() {
  const { t } = useTranslation()
  const versions = useVersions()
  const [selected, setSelected] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)

  const items = versions.data?.items ?? []
  const preferred = items.find((item) => item.editable) ?? items[0]
  const versionId = selected ?? preferred?.id ?? null
  const version = useVersion(versionId)

  if (versions.isPending) return <CardSkeleton />
  if (versions.isError) return <ErrorState onRetry={() => void versions.refetch()} />

  if (items.length === 0) {
    return (
      <EmptyState title={t('planning.empty.title')} description={t('planning.empty.description')} />
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{t('planning.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('planning.subtitle')}</p>
        </div>
        {/* The assistant, where the planning actually happens. */}
        <AssistantLauncher />
      </header>

      {version.isPending ? (
        <CardSkeleton />
      ) : version.isError ? (
        <ErrorState onRetry={() => void version.refetch()} />
      ) : (
        <>
          <VersionBar
            versions={items}
            version={version.data}
            onSelect={(id) => {
              setSelected(id)
              setComparing(false)
            }}
            onCompare={() => setComparing((current) => !current)}
          />

          {comparing ? (
            <CompareView
              versions={items}
              initialBaseId={version.data.parentVersionId ?? items[0]!.id}
              initialTargetId={version.data.id}
            />
          ) : null}

          <PlannerGrid version={version.data} context={version.data.context} />

          <GeneratePanel versionId={version.data.id} editable={version.data.editable} />
        </>
      )}
    </div>
  )
}
