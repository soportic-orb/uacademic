import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Class merger used by every UI primitive, shadcn/ui style. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
