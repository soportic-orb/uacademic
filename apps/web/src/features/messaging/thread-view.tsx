/**
 * One conversation: the messages, the read indicator, and a composer that only
 * appears for people allowed to write — an announcement channel says so in
 * words instead of showing a box that would be refused.
 *
 * Marking the thread read happens when it is opened, which is the only moment
 * a "read" tick can honestly claim anything.
 */
import { formatDate } from '@uacademic/shared'
import { CheckCheck, Paperclip, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CardSkeleton, ErrorState } from '../../components/feedback/states'
import { Button } from '../../components/ui/button'
import { useToast } from '../../hooks/use-toast'
import { currentLocale } from '../../i18n'
import { ApiRequestError, apiDownload, apiUpload } from '../../lib/api'
import { type MessageDto, useMarkRead, useSendMessage, useThread } from '../collaboration/queries'

type Attachment = MessageDto['attachments'][number]

export function ThreadView({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const locale = currentLocale()
  const query = useThread(conversationId)
  const send = useSendMessage(conversationId)
  const markRead = useMarkRead()

  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)

  const markedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!query.data || markedFor.current === conversationId) return
    markedFor.current = conversationId
    markRead.mutate(conversationId)
    // `markRead` is a stable mutation object; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, query.data])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [query.data?.items.length])

  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const thread = query.data

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const meta = await apiUpload<Attachment>(
        `/api/v1/conversations/${conversationId}/attachments`,
        form,
      )
      setAttachments((current) => [...current, meta])
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /**
   * Through `apiDownload`, not a plain link: the file is authorised by the
   * session and the active center, which only a real request carries.
   */
  const download = async (attachment: Attachment) => {
    try {
      const blob = await apiDownload(`/api/v1/attachments/${attachment.id}`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.fileName
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      if (error instanceof ApiRequestError)
        toast.raw({ variant: 'error', message: error.localizedMessage })
      else toast.error('errors.generic')
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!body.trim()) return

    send.mutate(
      { body: body.trim(), attachments },
      {
        onSuccess: () => {
          setBody('')
          setAttachments([])
          toast.success('messages.sent')
        },
        onError: (error) => {
          if (error instanceof ApiRequestError)
            toast.raw({ variant: 'error', message: error.localizedMessage })
          else toast.error('errors.generic')
        },
      },
    )
  }

  return (
    <div className="flex h-full min-h-[28rem] flex-col rounded-card border border-border bg-surface">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text">
          {thread.title ?? t(`messages.types.${thread.type}`)}
        </h2>
        <p className="text-xs text-text-muted">
          {`${t('messages.members')}: ${thread.members.length}`}
        </p>
      </header>

      <ul className="flex-1 space-y-3 overflow-y-auto p-4">
        {thread.items.map((message) => (
          <li key={message.id} className="rounded-control border border-border p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-text">{message.senderName}</span>
              <span className="tabular text-xs text-text-muted">
                {formatDate(locale, new Date(message.createdAt), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-text">{message.body}</p>

            {message.attachments.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {message.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <button
                      type="button"
                      onClick={() => void download(attachment)}
                      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                    >
                      <Paperclip className="size-3" aria-hidden="true" />
                      {attachment.fileName}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {message.readByAll ? (
              <p className="mt-2 flex items-center gap-1 text-xs text-text-muted">
                <CheckCheck className="size-3" aria-hidden="true" />
                {t('messages.readByAll')}
              </p>
            ) : null}
          </li>
        ))}
        <div ref={bottom} />
      </ul>

      {thread.canPost ? (
        <form onSubmit={submit} className="border-t border-border p-3">
          {attachments.length > 0 ? (
            <ul className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center gap-1 rounded-control border border-border px-2 py-1 text-xs text-text-muted"
                >
                  {attachment.fileName}
                  <button
                    type="button"
                    aria-label={t('common.remove')}
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.id !== attachment.id),
                      )
                    }
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-end gap-2">
            <label className="flex-1 text-sm">
              <span className="sr-only">{t('messages.placeholder')}</span>
              <textarea
                rows={2}
                value={body}
                placeholder={t('messages.placeholder')}
                onChange={(event) => setBody(event.target.value)}
                className="w-full rounded-control border border-border bg-surface px-3 py-2 text-text"
              />
            </label>

            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              aria-label={t('messages.attachments.add')}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
              }}
            />
            <Button
              variant="secondary"
              size="icon"
              aria-label={t('messages.attachments.add')}
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="submit"
              size="icon"
              aria-label={t('common.send')}
              disabled={send.isPending}
            >
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </form>
      ) : (
        <p className="border-t border-border p-3 text-sm text-text-muted">
          {t('messages.announcementReadOnly')}
        </p>
      )}
    </div>
  )
}
