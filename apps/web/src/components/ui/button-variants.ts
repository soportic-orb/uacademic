import { cva } from 'class-variance-authority'

/**
 * shadcn/ui button styles adapted to the corporate palette: radius 8 px on
 * controls, focus ring from the semantic tokens so it stays visible in both
 * themes (R8). Kept apart from the component so fast refresh only ever sees
 * component exports in `button.tsx`.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-contrast hover:bg-primary-hover',
        secondary: 'border border-border bg-surface text-text hover:bg-surface-muted',
        ghost: 'text-text-muted hover:bg-surface-muted hover:text-text',
        danger: 'bg-danger text-white hover:opacity-90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)
