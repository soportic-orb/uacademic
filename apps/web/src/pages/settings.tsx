import { SUPPORTED_LOCALES } from '@uacademic/shared'
import type { AppLocale } from '@uacademic/shared'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../components/feedback/states'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { useCenterSettings } from '../hooks/use-api'
import { useToast } from '../hooks/use-toast'
import { changeLocale, currentLocale } from '../i18n'
import { type ThemePreference, useThemeStore } from '../stores/theme'

const THEMES: ThemePreference[] = ['light', 'dark', 'system']

export function SettingsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const preference = useThemeStore((state) => state.preference)
  const setPreference = useThemeStore((state) => state.setPreference)
  const settings = useCenterSettings()
  const locale = currentLocale()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('settings.subtitle')}</p>
      </header>

      <Card className="max-w-2xl">
        <CardHeader title={t('settings.appearance')} />
        <CardBody>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('theme.label')}>
            {THEMES.map((theme) => (
              <Button
                key={theme}
                variant={preference === theme ? 'primary' : 'secondary'}
                aria-pressed={preference === theme}
                onClick={() => {
                  setPreference(theme)
                  toast.success('toast.themeChanged')
                }}
              >
                {t(`theme.${theme}`)}
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader title={t('settings.languageSection')} />
        <CardBody>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('language.label')}>
            {SUPPORTED_LOCALES.map((option: AppLocale) => (
              <Button
                key={option}
                variant={locale === option ? 'primary' : 'secondary'}
                aria-pressed={locale === option}
                onClick={() => {
                  void changeLocale(option).then(() => toast.success('toast.languageChanged'))
                }}
              >
                {t(`language.${option}`)}
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader
          title={t('settings.provenanceTitle')}
          description={t('settings.provenanceHint')}
        />
        <CardBody>
          {settings.isPending ? (
            <CardSkeleton />
          ) : settings.isError ? (
            <ErrorState onRetry={() => void settings.refetch()} />
          ) : (
            <dl className="divide-y divide-border">
              {settings.data.provenance.map((record) => (
                <div key={record.paramKey} className="py-3">
                  <dt className="font-mono text-sm text-text">{record.paramKey}</dt>
                  <dd className="mt-1 text-sm text-text-muted">
                    {record.quote ? <q>{record.quote}</q> : null}
                    {record.documentTitle ? (
                      <span className="mt-1 block text-xs">
                        {[
                          record.documentTitle,
                          record.section,
                          record.page ? `p. ${record.page}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
