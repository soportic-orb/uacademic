/**
 * The chat itself.
 *
 * A window rather than a full-height drawer: support is read beside the screen
 * somebody is stuck on, and a panel that covers it makes them close the help
 * to look at the thing the help is about.
 *
 * Every conversation is kept, and reopening one replays it — so somebody who
 * asked in September does not have to ask again in February, and so the
 * platform can be improved from what people actually needed.
 */
import {
  Loader2,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  Send,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

import { Button } from '../../components/ui/button'
import { useToast } from '../../hooks/use-toast'
import { ApiRequestError } from '../../lib/api'
import { cn } from '../../lib/cn'
import { Answer } from './answer'
import {
  askCady,
  useSupportConversation,
  useSupportConversations,
  useSupportFeedback,
} from './queries'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  messageId?: string
  helpful?: boolean | null
  /** False when Cady had to say the help does not cover it. */
  covered?: boolean
}

export function SupportPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  /*
    Where the person is standing. Support questions are almost always about
    what is in front of them and are phrased as if that were obvious — "why is
    this empty", "where do I put the hours" — so the screen goes with the
    question rather than being asked for in a first reply.
  */
  const location = useLocation()
  const conversations = useSupportConversations(open)
  const feedback = useSupportFeedback()

  const [conversationId, setConversationId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  /**
   * Bigger, for an answer with a table in it.
   *
   * The small window is deliberately small — support is read beside the screen
   * somebody is stuck on, and a panel that covers it makes them close the help
   * to look at the thing the help is about. But a comparison of four teaching
   * categories does not fit in it, so the panel opens out on request.
   */
  const [expanded, setExpanded] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const history = useSupportConversation(conversationId)
  /** Conversations this panel streamed itself: their turns are already here. */
  const streamed = useRef(new Set<string>())

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [turns, busy])

  useEffect(() => {
    const conversation = history.data
    if (!conversation || conversation.id !== conversationId) return
    if (streamed.current.has(conversation.id)) return

    setTurns(
      conversation.messages.map((message) => ({
        role: message.role,
        text: message.content,
        messageId: message.id,
        helpful: message.helpful,
      })),
    )
  }, [conversationId, history.data])

  const send = useCallback(async () => {
    const text = question.trim()
    if (text.length < 2 || busy) return

    setQuestion('')
    setShowHistory(false)
    setTurns((current) => [...current, { role: 'user', text }, { role: 'assistant', text: '' }])
    setBusy(true)

    try {
      await askCady({
        question: text,
        conversationId: conversationId ?? undefined,
        path: location.pathname,
        onEvent: (event) => {
          if (event.type === 'text') {
            setTurns((current) => {
              const next = [...current]
              const last = next.at(-1)
              if (last?.role === 'assistant') last.text += event.text
              return next
            })
          }

          if (event.type === 'done') {
            streamed.current.add(event.conversationId)
            setConversationId(event.conversationId)
            setTurns((current) => {
              const next = [...current]
              const last = next.at(-1)
              if (last?.role === 'assistant') {
                last.messageId = event.messageId
                last.covered = event.covered
              }
              return next
            })
          }

          if (event.type === 'error') toast.error(event.messageKey)
        },
      })
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('support.errors.failed')
    } finally {
      setBusy(false)
      await conversations.refetch()
    }
  }, [busy, conversationId, conversations, location.pathname, question, toast])

  const rate = (turn: Turn, helpful: boolean) => {
    if (!turn.messageId) return
    const messageId = turn.messageId

    setTurns((current) =>
      current.map((entry) => (entry.messageId === messageId ? { ...entry, helpful } : entry)),
    )
    feedback.mutate({ messageId, helpful }, { onSuccess: () => toast.success('support.thanks') })
  }

  if (!open) return null

  return (
    <aside
      aria-label={t('support.title')}
      className={cn(
        'fixed z-40 flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-lg',
        expanded
          ? 'inset-x-2 bottom-36 top-4 md:inset-x-auto md:bottom-24 md:right-6 md:top-6 md:w-[44rem]'
          : 'inset-x-2 bottom-36 max-h-[70vh] md:inset-x-auto md:bottom-24 md:right-6 md:w-96',
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
            <MessageCircleQuestion className="size-4" aria-hidden="true" />
            {t('support.title')}
          </h2>
          <p className="mt-0.5 truncate text-xs text-text-muted">{t('support.subtitle')}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={expanded ? t('support.shrink') : t('support.expand')}
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <Minimize2 className="size-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-4" aria-hidden="true" />
            )}
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('support.close')} onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      {showHistory ? (
        <div className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {(conversations.data?.items ?? []).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="w-full truncate rounded-control border border-border px-2 py-1.5 text-left text-xs text-text hover:bg-surface-muted"
                  onClick={() => {
                    setConversationId(item.id)
                    setShowHistory(false)
                  }}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {turns.length === 0 ? (
            <div className="rounded-card border border-dashed border-border-strong p-4 text-center">
              <p className="text-sm font-medium text-text">{t('support.emptyTitle')}</p>
              <p className="mt-1 text-xs text-text-muted">{t('support.emptyHint')}</p>
            </div>
          ) : null}

          {turns.map((turn, index) => (
            <div key={turn.messageId ?? index} className={turn.role === 'user' ? 'text-right' : ''}>
              <div
                className={cn(
                  'inline-block max-w-full rounded-card px-3 py-2 text-left text-sm',
                  turn.role === 'user'
                    ? 'bg-primary text-primary-contrast'
                    : 'border border-border bg-surface text-text',
                )}
              >
                {turn.role === 'assistant' ? (
                  <Answer text={turn.text} />
                ) : (
                  // What somebody typed is shown as they typed it: their own
                  // asterisks are not formatting, they are their words.
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                )}
              </div>

              {turn.role === 'assistant' && turn.covered === false ? (
                // Said plainly rather than dressed up: the question was
                // recorded, and somebody will write the answer.
                <p className="mt-1 text-xs italic text-text-muted">{t('support.uncovered')}</p>
              ) : null}

              {turn.role === 'assistant' && turn.messageId && !busy ? (
                <div className="mt-1 flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('support.helpful')}
                    aria-pressed={turn.helpful === true}
                    onClick={() => rate(turn, true)}
                  >
                    <ThumbsUp
                      className={`size-3.5 ${turn.helpful === true ? 'text-success' : ''}`}
                      aria-hidden="true"
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('support.notHelpful')}
                    aria-pressed={turn.helpful === false}
                    onClick={() => rate(turn, false)}
                  >
                    <ThumbsDown
                      className={`size-3.5 ${turn.helpful === false ? 'text-danger' : ''}`}
                      aria-hidden="true"
                    />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}

          {busy ? (
            <p className="flex items-center gap-2 text-xs text-text-muted" role="status">
              <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
              {t('support.thinking')}
            </p>
          ) : null}

          <div ref={bottom} />
        </div>
      )}

      <form
        className="border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <label className="block text-sm">
          <span className="sr-only">{t('support.placeholder')}</span>
          <textarea
            rows={2}
            value={question}
            placeholder={t('support.placeholder')}
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
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => setShowHistory((current) => !current)}
            >
              {t('support.history')}
            </button>
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setConversationId(null)
                setTurns([])
                setShowHistory(false)
              }}
            >
              {t('support.newConversation')}
            </button>
          </div>

          <Button type="submit" size="sm" disabled={busy || question.trim().length < 2}>
            <Send className="size-4" aria-hidden="true" />
            {t('support.send')}
          </Button>
        </div>
      </form>
    </aside>
  )
}
