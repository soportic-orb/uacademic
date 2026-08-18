/**
 * The assistant, as a panel that knows where it is standing.
 *
 * It is opened from planning and from the load screens and is handed the
 * subject being worked on, so "this subject" and "why can I not put this class
 * here?" mean something without anybody restating them. History is per
 * subject, for the same reason.
 *
 * When the assistant is not configured, or the center switched it off, or the
 * month's budget is spent, the panel says so and stops. Nothing else on the
 * screen changes: the platform is fully usable by hand, always.
 */
import type { Citation } from '@uacademic/shared'
import { Bot, Loader2, Send, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui/button'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { ProposalCard } from './proposal-card'
import { SourceChips } from './source-chips'
import {
  type AiProposal,
  type DocumentSource,
  askAssistant,
  useAssistantStatus,
  useConversation,
  useConversations,
} from './queries'

export interface AssistantPanelProps {
  open: boolean
  onClose: () => void
  /** What the coordinator is working on, so the panel does not have to ask. */
  subjectId?: string | null
  subjectCode?: string | null
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
  /** Documents the answer was given, and the places in them it cited. */
  documents?: DocumentSource[]
  citations?: Citation[]
  proposals?: {
    id: string
    proposal: AiProposal
    status: 'pending' | 'confirmed' | 'rejected' | 'expired' | 'failed'
  }[]
}

export function AssistantPanel({ open, onClose, subjectId, subjectCode }: AssistantPanelProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const status = useAssistantStatus()
  const conversations = useConversations(subjectId)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const history = useConversation(conversationId)

  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  /**
   * Conversations this panel streamed into itself. Their turns are already on
   * screen — with the proposal cards the stream produced — and replaying the
   * stored transcript over them would quietly throw those cards away.
   */
  const streamed = useRef(new Set<string>())

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [turns, busy])

  // Opening an older conversation replays it. Stored proposals come back with
  // whatever became of them, so one already confirmed does not offer to be
  // confirmed again.
  useEffect(() => {
    const conversation = history.data
    // Only a payload that is actually the conversation we asked for may
    // replace what is on screen: anything else and a live transcript, with the
    // proposals in it, would be wiped by a stale or unexpected response.
    if (!conversation || conversation.id !== conversationId) return
    if (streamed.current.has(conversation.id)) return

    const replayed: Turn[] = (conversation.messages ?? []).map((message) => ({
      role: message.role,
      text: message.content,
      citations: message.citations ?? [],
    }))

    const proposals = (conversation.proposals ?? []).map((proposal) => ({
      id: proposal.id,
      proposal: proposal.preview,
      status: proposal.status,
    }))

    const last = [...replayed].reverse().find((turn) => turn.role === 'assistant')
    if (last && proposals.length > 0) last.proposals = proposals

    setTurns(replayed)
  }, [conversationId, history.data])

  const send = useCallback(async () => {
    const text = question.trim()
    if (!text || busy) return

    setQuestion('')
    setTurns((current) => [...current, { role: 'user', text }, { role: 'assistant', text: '' }])
    setBusy(true)

    try {
      await askAssistant({
        question: text,
        conversationId: conversationId ?? undefined,
        subjectId: subjectId ?? null,
        onEvent: (event) => {
          if (event.type === 'text') {
            setTurns((current) => {
              const next = [...current]
              const last = next.at(-1)
              if (last?.role === 'assistant') last.text += event.text
              return next
            })
          }

          if (event.type === 'tool') setActiveTool(event.name)

          if (event.type === 'documents' || event.type === 'citations') {
            const { type } = event
            setTurns((current) => {
              const next = [...current]
              const last = next.at(-1)
              if (last?.role === 'assistant') {
                if (type === 'documents') last.documents = event.items
                else last.citations = event.items
              }
              return next
            })
          }

          if (event.type === 'proposal') {
            setTurns((current) => {
              const next = [...current]
              const last = next.at(-1)
              if (last?.role === 'assistant') {
                last.proposals = [
                  ...(last.proposals ?? []),
                  { id: event.proposalId, proposal: event.proposal, status: 'pending' },
                ]
              }
              return next
            })
          }

          if (event.type === 'done') {
            streamed.current.add(event.conversationId)
            setConversationId(event.conversationId)
          }
          if (event.type === 'error') toast.error(event.messageKey)
        },
      })
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('assistant.errors.failed')
    } finally {
      setBusy(false)
      setActiveTool(null)
      await conversations.refetch()
    }
  }, [busy, conversationId, conversations, question, subjectId, toast])

  if (!open) return null

  const budget = status.data?.budget
  const unavailable = status.isError || (status.data && !status.data.available)

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-lg"
      aria-label={t('assistant.title')}
    >
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
            <Bot className="size-4" aria-hidden="true" />
            {t('assistant.title')}
          </h2>
          <p className="mt-0.5 truncate text-xs text-text-muted">
            {subjectCode
              ? t('assistant.context', { subject: subjectCode })
              : t('assistant.subtitle')}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label={t('assistant.close')} onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>

      {unavailable ? (
        <div className="p-4">
          <p className="rounded-control border border-border bg-surface-muted p-3 text-sm text-text-muted">
            {status.data && !status.data.configured
              ? t('assistant.errors.unavailable')
              : status.data && !status.data.enabled
                ? t('assistant.errors.disabled')
                : t('assistant.errors.failed')}
          </p>
        </div>
      ) : (
        <>
          {budget && budget.level !== 'ok' ? (
            <p
              role="status"
              className={`px-4 py-2 text-xs ${
                budget.level === 'exceeded' ? 'text-danger' : 'text-warning'
              }`}
            >
              {t(`assistant.budget.${budget.level === 'exceeded' ? 'exceeded' : 'warning'}`, {
                percent: budget.percent,
              })}
            </p>
          ) : null}

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {turns.length === 0 ? (
              <div className="rounded-card border border-dashed border-border-strong p-4 text-center">
                <Sparkles className="mx-auto size-5 text-text-muted" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-text">{t('assistant.emptyTitle')}</p>
                <p className="mt-1 text-xs text-text-muted">{t('assistant.emptyHint')}</p>
                <ul className="mt-3 space-y-1 text-left">
                  {(
                    [
                      ['rebalance', {}],
                      ['schedule', {}],
                      ['why', {}],
                    ] as const
                  ).map(([key, params]) => (
                    <li key={key}>
                      <button
                        type="button"
                        className="w-full rounded-control border border-border px-2 py-1.5 text-left text-xs text-text hover:bg-surface-muted"
                        onClick={() => setQuestion(t(`assistant.suggestions.${key}`, params))}
                      >
                        {t(`assistant.suggestions.${key}`, params)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {turns.map((turn, index) => (
              <div key={index} className={turn.role === 'user' ? 'text-right' : ''}>
                <div
                  className={`inline-block max-w-full rounded-card px-3 py-2 text-left text-sm ${
                    turn.role === 'user'
                      ? 'bg-primary text-primary-contrast'
                      : 'border border-border bg-surface text-text'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                </div>

                {turn.role === 'assistant' ? (
                  <SourceChips documents={turn.documents ?? []} citations={turn.citations ?? []} />
                ) : null}

                {turn.proposals?.map((entry) => (
                  <div key={entry.id} className="mt-2">
                    <ProposalCard
                      proposalId={entry.id}
                      proposal={entry.proposal}
                      status={entry.status}
                    />
                  </div>
                ))}
              </div>
            ))}

            {busy ? (
              <p className="flex items-center gap-2 text-xs text-text-muted" role="status">
                <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
                {activeTool
                  ? t(`assistant.tools.${activeTool}`, { defaultValue: t('assistant.thinking') })
                  : t('assistant.thinking')}
              </p>
            ) : null}

            <div ref={bottom} />
          </div>

          <form
            className="border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <label className="block text-sm">
              <span className="sr-only">{t('assistant.placeholder')}</span>
              <textarea
                rows={2}
                value={question}
                placeholder={t('assistant.placeholder')}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-text"
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className="text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => {
                  setConversationId(null)
                  setTurns([])
                }}
              >
                {t('assistant.newConversation')}
              </button>
              <Button type="submit" size="sm" disabled={busy || question.trim().length < 2}>
                <Send className="size-4" aria-hidden="true" />
                {t('assistant.send')}
              </Button>
            </div>
          </form>
        </>
      )}
    </aside>
  )
}
