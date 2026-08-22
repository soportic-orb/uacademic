/**
 * Cady's answer, rendered.
 *
 * She writes markdown — the steps of a procedure are a numbered list, a
 * comparison is a table, the name of a button is bold — and showing that as
 * literal asterisks and pipes makes the useful shape of an answer harder to
 * read than no shape at all.
 *
 * Rendered rather than injected: `react-markdown` builds React elements, so
 * nothing here goes through `innerHTML` and no HTML in the model's output can
 * become markup. Raw HTML is not enabled, and links are given `rel` and a new
 * tab in case one ever points outward.
 */
import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export const Answer = memo(function Answer({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="ml-4 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="ml-4 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          h1: ({ children }) => <h3 className="text-sm font-semibold text-text">{children}</h3>,
          h2: ({ children }) => <h3 className="text-sm font-semibold text-text">{children}</h3>,
          h3: ({ children }) => <h4 className="text-sm font-semibold text-text">{children}</h4>,
          code: ({ children }) => (
            <code className="rounded-sm bg-surface-muted px-1 py-0.5 text-xs">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-control bg-surface-muted p-2 text-xs">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-2 italic text-text-muted">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border" />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          // A table in a narrow panel scrolls inside itself rather than
          // pushing the chat wider than the window.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-surface-muted">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1 align-top">{children}</td>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  )
})
