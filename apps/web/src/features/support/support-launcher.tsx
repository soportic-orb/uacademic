/**
 * The round button in the corner, on every screen.
 *
 * Deliberately always in the same place: somebody who is lost is not going to
 * hunt for the help, and the one thing they can be told once — "bottom right"
 * — has to still be true on the screen they got lost on.
 *
 * It is not drawn at all when the assistant is switched off or the
 * installation has no key. A button that opens onto "not available" is worse
 * than no button.
 */
import { MessageCircleQuestion, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SupportPanel } from './support-panel'
import { useSupportStatus } from './queries'

export function SupportLauncher() {
  const { t } = useTranslation()
  const status = useSupportStatus()
  const [open, setOpen] = useState(false)

  if (!status.data?.available) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        /*
          One name in both states, with `aria-expanded` carrying which one it
          is in — the disclosure pattern. Renaming the button on open gave it
          the same name as the panel's own close control, so a screen reader
          offered two identical "close the help" buttons.
        */
        aria-label={t('support.open')}
        aria-expanded={open}
        className={[
          // Above the bottom navigation on a phone, in the corner elsewhere.
          'fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-full md:bottom-6 md:right-6',
          'bg-primary text-primary-contrast shadow-lg',
          'hover:bg-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'motion-safe:transition-colors',
        ].join(' ')}
      >
        {open ? (
          <X className="size-6" aria-hidden="true" />
        ) : (
          <MessageCircleQuestion className="size-6" aria-hidden="true" />
        )}
      </button>

      <SupportPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}
