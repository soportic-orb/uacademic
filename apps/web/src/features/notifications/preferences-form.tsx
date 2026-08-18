/**
 * Events × channels, one row per event (phase 4 spec).
 *
 * A channel a center considers essential cannot be switched off — a teacher
 * has to be able to find out that their timetable moved — so those checkboxes
 * are checked and disabled, with the reason spelled out rather than implied.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { useToast } from '../../hooks/use-toast'
import { type PreferenceDto, useSavePreferences } from '../collaboration/queries'

const CHANNELS = ['inApp', 'push', 'email'] as const

export function PreferencesForm({ items }: { items: PreferenceDto[] }) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSavePreferences()
  const [draft, setDraft] = useState<PreferenceDto[]>(items)

  const update = (event: string, patch: Partial<PreferenceDto>) => {
    setDraft((current) =>
      current.map((item) => (item.event === event ? { ...item, ...patch } : item)),
    )
  }

  return (
    <Card>
      <CardHeader
        title={t('notifications.preferences')}
        description={t('notifications.preferencesHint')}
        action={
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(draft, {
                onSuccess: () => toast.success('notifications.saved'),
                onError: () => toast.error('errors.generic'),
              })
            }
          >
            {t('common.save')}
          </Button>
        }
      />
      <CardBody className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <caption className="sr-only">{t('notifications.preferences')}</caption>
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('notifications.event')}
              </th>
              {CHANNELS.map((channel) => (
                <th key={channel} scope="col" className="px-3 py-2 font-medium">
                  {t(`notifications.channels.${channel}`)}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium">
                {t('notifications.digest')}
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.map((item) => (
              <tr key={item.event} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-3 pr-4 text-left font-normal">
                  <span className="block font-medium text-text">
                    {t(`notify.${item.event}.title`)}
                  </span>
                  <span className="text-xs text-text-muted">
                    {t(`notifications.priority.${item.priority}`)}
                  </span>
                </th>
                {CHANNELS.map((channel) => {
                  const mandatory = item.mandatory.includes(channel)
                  return (
                    <td key={channel} className="px-3 py-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={mandatory || item[channel]}
                          disabled={mandatory}
                          onChange={(event) =>
                            update(item.event, { [channel]: event.target.checked })
                          }
                        />
                        <span className="sr-only">
                          {`${t(`notify.${item.event}.title`)} · ${t(
                            `notifications.channels.${channel}`,
                          )}`}
                        </span>
                        {mandatory ? (
                          <span className="text-xs text-text-muted">
                            {t('notifications.mandatory')}
                          </span>
                        ) : null}
                      </label>
                    </td>
                  )
                })}
                <td className="px-3 py-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={item.digest}
                      onChange={(event) => update(item.event, { digest: event.target.checked })}
                    />
                    <span className="sr-only">
                      {`${t(`notify.${item.event}.title`)} · ${t('notifications.digest')}`}
                    </span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-xs text-text-muted">{t('notifications.digestHint')}</p>
      </CardBody>
    </Card>
  )
}
