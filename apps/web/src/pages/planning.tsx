import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AssistantLauncher } from '../features/assistant/assistant-launcher'

import { CardSkeleton, ErrorState } from '../components/feedback/states'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { ApiRequestError } from '../lib/api'
import { CompareView } from '../features/planner/compare-view'
import { PlannerGrid } from '../features/planner/planner-grid'
import { ScheduleExport } from '../features/capacity/schedule-export'
import { useCreateVersion, useVersion, useVersions } from '../features/planner/queries'
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
    // The empty state said what was missing and offered no way to make it: the
    // button that creates a version lives on the version bar, which is not
    // rendered until there is a version for it to be about.
    return <FirstVersion />
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

          {/* Sending happens after publishing, so it sits at the foot of the
              screen where the work ends rather than competing with the grid. */}
          <ScheduleExport
            canSendToEveryone
            published={items.some((item) => item.status === 'published')}
          />
        </>
      )}
    </div>
  )
}

/**
 * The first draft of a year's timetable.
 *
 * Nothing is planned in the open: a version is a draft of the whole week that
 * is worked on and then published, so the very first thing a coordinator does
 * is make one. Later ones are branched from an existing version, which is why
 * the control for those lives on the version bar.
 */
function FirstVersion() {
  const { t } = useTranslation()
  const toast = useToast()
  const create = useCreateVersion()
  const [name, setName] = useState('')

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader title={t('planning.empty.title')} description={t('planning.empty.description')} />
      <CardBody>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate(
              { name },
              {
                onError: (error) => {
                  if (error instanceof ApiRequestError)
                    toast.raw({ variant: 'error', message: error.localizedMessage })
                  else toast.error('errors.generic')
                },
              },
            )
          }}
        >
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('planner.version.name')}</span>
            <input
              type="text"
              required
              minLength={3}
              value={name}
              placeholder={t('planner.version.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              className="h-10 w-full rounded-control border border-border bg-surface px-3 text-text"
            />
          </label>

          <Button type="submit" disabled={create.isPending}>
            <Plus className="size-4" aria-hidden="true" />
            {create.isPending ? t('common.saving') : t('planner.version.createFirst')}
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
