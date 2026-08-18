/**
 * Installing the app.
 *
 * Two different things happen depending on the browser, and pretending
 * otherwise is how install banners end up lying to people:
 *
 * - Chromium fires `beforeinstallprompt`, we keep it, and a button hands it
 *   back at a moment the person chose.
 * - **iOS has no such event.** Safari installs only through Share → Add to
 *   Home Screen, done by hand, so there the card gives the instructions with
 *   the actual menu names instead of a button that cannot work.
 *
 * On iOS this matters beyond convenience: web push only works once the app is
 * on the home screen (iOS 16.4+), so a teacher who never installs it will
 * never be told a class moved.
 *
 * The card is dismissible and stays dismissed: it is a suggestion, and one
 * that has already been declined is noise.
 */
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { isIos, isStandalone } from './environment'

const DISMISSED_KEY = 'uacademic:install-dismissed'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallPrompt() {
  const { t } = useTranslation()
  const [event, setEvent] = useState<InstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) !== null
    } catch {
      return false
    }
  })

  useEffect(() => {
    const onPrompt = (raw: Event) => {
      // Kept, not fired: the browser's own moment is rarely the person's.
      raw.preventDefault()
      setEvent(raw as InstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED_KEY, new Date().toISOString())
    } catch {
      /* nothing to remember it with; it will ask again */
    }
  }

  if (dismissed || isStandalone()) return null

  const ios = isIos()
  if (!ios && !event) return null

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title={t('install.title')}
        description={t('install.why')}
        action={
          <Button variant="ghost" size="icon" aria-label={t('common.close')} onClick={dismiss}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        }
      />

      <CardBody>
        {ios ? (
          <ol className="space-y-2 text-sm text-text">
            <li className="flex items-start gap-2">
              <Share className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              {t('install.ios.share')}
            </li>
            <li className="flex items-start gap-2">
              <SquarePlus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              {t('install.ios.add')}
            </li>
            <li className="text-text-muted">{t('install.ios.push')}</li>
          </ol>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                void event?.prompt().then(async () => {
                  const choice = await event.userChoice
                  if (choice.outcome === 'accepted') setEvent(null)
                })
              }}
            >
              <Download className="size-4" aria-hidden="true" />
              {t('install.action')}
            </Button>
            <p className="text-sm text-text-muted">{t('install.offline')}</p>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
