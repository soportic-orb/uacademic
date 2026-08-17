/**
 * The version toolbar: which version you are editing, and the one-way street
 * from draft to published.
 *
 * Publishing is the only action that reaches anybody, so it is the only one
 * that asks for confirmation and reports how many teachers were told.
 */
import { GitBranch, Plus, Send, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError } from '../../lib/api'
import { formatDate } from '@uacademic/shared'
import {
  type VersionDetailDto,
  type VersionListItem,
  useCreateVersion,
  useVersionStatus,
} from './queries'

export function VersionBar({
  versions,
  version,
  onSelect,
  onCompare,
}: {
  versions: VersionListItem[]
  version: VersionDetailDto
  onSelect: (versionId: string) => void
  onCompare: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()

  const create = useCreateVersion()
  const status = useVersionStatus(version.id)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError)
      toast.raw({ variant: 'error', message: error.localizedMessage })
    else toast.error('errors.generic')
  }

  const transition = (next: VersionDetailDto['status']) => {
    if (next === 'published' && !window.confirm(t('planner.version.publishConfirm'))) return

    status.mutate(next, {
      onSuccess: (result) => {
        if (next === 'published') {
          toast.success('planner.version.publishedToast', {
            params: { teachers: result.notified ?? 0 },
          })
        } else {
          toast.info('planner.version.draftToast')
        }
      },
      onError,
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-text-muted">{t('planner.version.title')}</span>
            <select
              value={version.id}
              onChange={(event) => onSelect(event.target.value)}
              className="h-10 min-w-64 rounded-control border border-border bg-surface px-2 text-sm text-text"
            >
              {versions.map((item) => (
                <option key={item.id} value={item.id}>
                  {`${item.name} · ${t(`planner.version.status.${item.status}`)}`}
                </option>
              ))}
            </select>
          </label>

          <p className="pb-2 text-xs text-text-muted">
            {t(`planner.version.statusHint.${version.status}`)}
            {version.publishedAt ? ` · ${formatDate(locale, new Date(version.publishedAt))}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onCompare}>
            <GitBranch className="size-4" aria-hidden="true" />
            {t('planner.compare.title')}
          </Button>

          <Button
            variant="secondary"
            onClick={() => {
              setName(version.name)
              setNaming((current) => !current)
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('planner.version.create')}
          </Button>

          {version.status === 'draft' ? (
            <Button variant="secondary" onClick={() => transition('in_review')}>
              <Send className="size-4" aria-hidden="true" />
              {t('planner.version.sendToReview')}
            </Button>
          ) : null}

          {version.status === 'in_review' ? (
            <Button variant="ghost" onClick={() => transition('draft')}>
              {t('planner.version.backToDraft')}
            </Button>
          ) : null}

          {version.editable ? (
            <Button onClick={() => transition('published')} disabled={status.isPending}>
              <Upload className="size-4" aria-hidden="true" />
              {t('planner.version.publish')}
            </Button>
          ) : null}
        </div>

        {naming ? (
          <form
            className="flex w-full flex-wrap items-end gap-2 border-t border-border pt-3"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate(
                { name, fromVersionId: version.id },
                {
                  onSuccess: (created) => {
                    setNaming(false)
                    onSelect(created.id)
                  },
                  onError,
                },
              )
            }}
          >
            <label className="flex-1 text-sm">
              <span className="mb-1 block text-xs text-text-muted">
                {t('planner.version.name')}
              </span>
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
              {t('planner.version.createFrom')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setNaming(false)}>
              {t('common.cancel')}
            </Button>
          </form>
        ) : null}
      </CardBody>
    </Card>
  )
}
