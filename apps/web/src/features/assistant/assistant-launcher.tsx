/**
 * The button that opens the assistant, wherever the work is happening.
 *
 * It carries the screen's context — the subject being planned, the year being
 * looked at — so the panel starts already knowing what "this" refers to. Only
 * coordination sees it, and only when the assistant can actually answer.
 */
import { Bot } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRoles } from '../../app/use-roles'
import { Button } from '../../components/ui/button'
import { AssistantPanel } from './assistant-panel'
import { useAssistantStatus } from './queries'

export interface AssistantLauncherProps {
  subjectId?: string | null
  subjectCode?: string | null
}

export function AssistantLauncher({ subjectId, subjectCode }: AssistantLauncherProps) {
  const { t } = useTranslation()
  const roles = useRoles()

  // R5/product: a coordination tool. Nobody else is offered it — and nobody
  // else asks after it either. The check used to happen after the query had
  // already gone out, so a lecturer opening a screen this sits on got a 403
  // and, through the global handler, a "you do not have permission" toast for
  // something they had not done.
  const coordinates = roles.includes('COORDINATOR') || roles.includes('CENTER_ADMIN')
  const status = useAssistantStatus(coordinates)
  const [open, setOpen] = useState(false)

  if (!coordinates) return null
  if (status.data && !status.data.available) return null

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Bot className="size-4" aria-hidden="true" />
        {t('assistant.open')}
      </Button>

      <AssistantPanel
        open={open}
        onClose={() => setOpen(false)}
        subjectId={subjectId ?? null}
        subjectCode={subjectCode ?? null}
      />
    </>
  )
}
