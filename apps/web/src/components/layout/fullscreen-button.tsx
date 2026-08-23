/**
 * Fill the screen, or give it back.
 *
 * Beside the bell, because it belongs with the other things that act on the
 * whole window rather than on what is being looked at. Drawn only where the
 * browser allows it: an iPhone does not, and a control that does nothing is
 * worse than one that is not there.
 */
import { Maximize2, Minimize2 } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import {
  fullscreenSupported,
  isFullscreen,
  toggleFullscreen,
  useFullscreenStore,
} from '../../stores/fullscreen'

export function FullscreenButton() {
  const { t } = useTranslation()
  const active = useFullscreenStore((state) => state.active)
  const sync = useFullscreenStore((state) => state.sync)

  useEffect(() => {
    // The browser hands fullscreen back on its own — Escape, a tab switch, a
    // refused permission — so the icon follows the document, not the click.
    const onChange = () => sync(isFullscreen())
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [sync])

  if (!fullscreenSupported()) return null

  return (
    <button
      type="button"
      onClick={() => void toggleFullscreen()}
      aria-label={active ? t('layout.exitFullscreen') : t('layout.enterFullscreen')}
      aria-pressed={active}
      title={active ? t('layout.exitFullscreen') : t('layout.enterFullscreen')}
      className="flex size-9 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {active ? (
        <Minimize2 className="size-5" aria-hidden="true" />
      ) : (
        <Maximize2 className="size-5" aria-hidden="true" />
      )}
    </button>
  )
}
