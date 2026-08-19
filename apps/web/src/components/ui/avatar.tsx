import { UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useImageData } from '../../hooks/use-image'
import { cn } from '../../lib/cn'

const SIZES = {
  xs: 'size-6',
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-24',
} as const

export type AvatarSize = keyof typeof SIZES

export function Avatar({
  name,
  url,
  size = 'sm',
  className,
}: {
  name: string
  url?: string | null
  size?: AvatarSize
  className?: string
}) {
  const { t } = useTranslation()
  const image = useImageData(url)

  const shape = cn(
    'shrink-0 overflow-hidden rounded-full border border-border bg-surface-muted',
    SIZES[size],
    className,
  )

  if (image.data) {
    return (
      <img
        src={image.data}
        alt={t('images.avatarOf', { name })}
        className={cn(shape, 'object-cover')}
      />
    )
  }

  return (
    <span className={cn(shape, 'grid place-items-center text-text-muted')}>
      <UserRound className="size-1/2" aria-hidden="true" />
    </span>
  )
}
