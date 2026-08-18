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
  const status = useAssistantStatus()
  const [open, setOpen] = useState(false)

  // R5/product: a coordination tool. Nobody else is offered it.
  if (!roles.includes('COORDINATOR') && !roles.includes('CENTER_ADMIN')) return null
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
