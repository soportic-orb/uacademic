import type { SessionUser } from '@uacademic/shared'
import { Check } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useImageData } from '../../hooks/use-image'
import { Button } from '../ui/button'

export interface UniversityOption {
  id: string
  name: string
  logoUrl: string | null
  /** The center to land on when this university is chosen. */
  firstCenterId: string
}

/**
 * Whose platform this is, in the top left.
 *
 * A logo rather than a name, because that is what somebody recognises without
 * reading — and because a person who works for two institutions needs to know
 * at a glance which one's rules are in force before they change anything.
 */
export function UniversityMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const image = useImageData(logoUrl)

  if (logoUrl && image.data) {
    // `alt` is empty on purpose: the name is next to it, and a screen reader
    // announcing "Universitat de Vic Universitat de Vic" helps nobody.
    return <img src={image.data} alt="" className="h-8 max-w-32 object-contain" />
  }

  return <span className="truncate text-sm font-semibold text-text">{name}</span>
}

/**
 * The list of universities somebody belongs to.
 *
 * Only ever rendered when there are two or more: with one, the mark is not a
 * button at all, because a control that cannot change anything is a control
 * that wastes somebody's click.
 */
export function UniversityDialog({
  universities,
  activeId,
  onPick,
  onClose,
}: {
  universities: UniversityOption[]
  activeId: string | undefined
  onPick: (university: UniversityOption) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-16">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 size-full cursor-default bg-black/40"
      />

      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('layout.universitySelector')}
        className="relative w-full max-w-md rounded-card border border-border bg-surface-raised shadow-overlay"
      >
        <div className="border-b border-border p-5">
          <h2 className="text-lg font-semibold text-text">{t('layout.universitySelector')}</h2>
          <p className="mt-1 text-sm text-text-muted">{t('layout.universityHint')}</p>
        </div>

        <ul className="p-2">
          {universities.map((university) => (
            <li key={university.id}>
              <button
                type="button"
                onClick={() => onPick(university)}
                aria-current={university.id === activeId ? 'true' : undefined}
                className="flex w-full items-center gap-3 rounded-control px-3 py-3 text-left hover:bg-surface-muted"
              >
                <UniversityMark name={university.name} logoUrl={university.logoUrl} />
                <span className="min-w-0 flex-1 truncate text-sm text-text">{university.name}</span>
                {university.id === activeId ? (
                  <Check className="size-4 text-primary" aria-hidden="true" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        <div className="border-t border-border p-3 text-right">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Every university this person holds a role in, each with a center to open.
 *
 * It lives beside the components that use it because it is the same idea — the
 * shape of the switcher — and moving it one file away to satisfy fast refresh
 * would only make it harder to find.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function universitiesOf(user: SessionUser | undefined): UniversityOption[] {
  const universities = new Map<string, UniversityOption>()

  for (const membership of user?.memberships ?? []) {
    if (universities.has(membership.universityId)) continue
    universities.set(membership.universityId, {
      id: membership.universityId,
      name: membership.universityName,
      logoUrl: membership.universityLogoUrl,
      firstCenterId: membership.centerId,
    })
  }

  return [...universities.values()]
}
