import { SUPPORTED_LOCALES } from '@uacademic/shared'
import type { AppLocale } from '@uacademic/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRoles } from '../app/use-roles'
import { useAuthConfig } from '../auth/config'
import { Card, CardBody, CardHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { ExtractionCard } from '../features/settings/extraction-card'
import { ExtractionWizard } from '../features/settings/extraction-wizard'
import { MenuCard } from '../features/settings/menu-card'
import { ParametersCard } from '../features/settings/parameters-card'
import { VersionsCard } from '../features/settings/versions-card'
import { useToast } from '../hooks/use-toast'
import { changeLocale, currentLocale } from '../i18n'
import { type ThemePreference, useThemeStore } from '../stores/theme'

const THEMES: ThemePreference[] = ['light', 'dark', 'system']

export function SettingsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const roles = useRoles()
  const preference = useThemeStore((state) => state.preference)
  const setPreference = useThemeStore((state) => state.setPreference)
  const locale = currentLocale()
  const [runId, setRunId] = useState<string | null>(null)
  // Only what the installation offers. The catalogues always carry all three
  // (R1) — switching one off hides it from this picker, it does not remove
  // any translation — so nothing here can fall back to a raw key.
  const offered = useAuthConfig().data?.locales ?? SUPPORTED_LOCALES

  // Reading a regulation into the configuration is the administration's job:
  // it is their center's rules, and their signature on every parameter.
  const administers = roles.some((role) => ['SUPERADMIN', 'CENTER_ADMIN'].includes(role))

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
            {offered.map((option: AppLocale) => (
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

      {/* Everybody's, whatever they administer: it is their own menu. */}
      <MenuCard roles={roles} />

      {administers ? (
        <div className="space-y-6">
          {runId ? (
            <ExtractionWizard runId={runId} onFinished={() => setRunId(null)} />
          ) : (
            <ExtractionCard onOpenRun={setRunId} />
          )}

          <VersionsCard />

          <div>
            <h2 className="text-lg font-semibold text-text">{t('settings.provenanceTitle')}</h2>
            <p className="mt-1 text-sm text-text-muted">{t('settings.provenanceHint')}</p>
          </div>

          <ParametersCard />
        </div>
      ) : null}
    </div>
  )
}
