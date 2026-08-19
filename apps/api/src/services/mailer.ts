/**
 * Email delivery.
 *
 * One MJML layout, filled from the i18n catalogs in the recipient's stored
 * locale (R1) — three template files would be three chances for the Catalan
 * one to drift. Without an SMTP host configured the mailer logs what it would
 * have sent, so the whole notification path is exercisable on a laptop.
 */
import { type AppLocale, translate } from '@uacademic/shared'
import mjml2html from 'mjml'
import nodemailer, { type Transporter } from 'nodemailer'

import { env } from '../config/env.js'

export interface MailBlock {
  title: string
  body: string
  /** Optional bullet list, used by the digest. */
  items?: string[]
}

export interface MailInput {
  to: string
  locale: AppLocale
  subject: string
  blocks: MailBlock[]
  /** Label and URL of the single call to action. */
  action?: { label: string; url: string }
}

let transporter: Transporter | null = null

function mailer(): Transporter | null {
  const configuration = env()
  if (!configuration.SMTP_HOST) return null

  transporter ??= nodemailer.createTransport({
    host: configuration.SMTP_HOST,
    port: configuration.SMTP_PORT,
    secure: configuration.SMTP_SECURE,
    ...(configuration.SMTP_USER
      ? { auth: { user: configuration.SMTP_USER, pass: configuration.SMTP_PASSWORD ?? '' } }
      : {}),
  })

  return transporter
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The corporate layout of CLAUDE.md §4, in the one place that emails use it.
 *
 * Async because MJML 5 compiles asynchronously and the 4.x runtime returns the
 * result directly: awaiting covers both without pinning us to either.
 */
export async function renderMail(input: MailInput): Promise<{ html: string; text: string }> {
  const footer = translate(input.locale, 'email.signature')
  const preferences = translate(input.locale, 'email.preferencesHint')

  const sections = input.blocks
    .map(
      (block) => `
        <mj-text font-size="16px" font-weight="600" color="#0F172A">${escapeHtml(block.title)}</mj-text>
        <mj-text font-size="14px" color="#475569">${escapeHtml(block.body)}</mj-text>
        ${
          block.items && block.items.length > 0
            ? `<mj-text font-size="14px" color="#475569"><ul>${block.items
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join('')}</ul></mj-text>`
            : ''
        }`,
    )
    .join('\n')

  const action = input.action
    ? `<mj-button background-color="#0072CE" color="#FFFFFF" border-radius="8px" href="${escapeHtml(
        input.action.url,
      )}">${escapeHtml(input.action.label)}</mj-button>`
    : ''

  const template = `
    <mjml>
      <mj-head>
        <mj-title>${escapeHtml(input.subject)}</mj-title>
        <mj-attributes>
          <mj-all font-family="Inter, Helvetica, Arial, sans-serif" />
        </mj-attributes>
      </mj-head>
      <mj-body background-color="#F8FAFC">
        <mj-section background-color="#0072CE" padding="16px">
          <mj-column>
            <mj-text color="#FFFFFF" font-size="18px" font-weight="700">UAcademic</mj-text>
          </mj-column>
        </mj-section>
        <mj-section background-color="#FFFFFF" padding="24px">
          <mj-column>
            ${sections}
            ${action}
          </mj-column>
        </mj-section>
        <mj-section padding="8px 24px 24px">
          <mj-column>
            <mj-text font-size="12px" color="#94A3B8">${escapeHtml(footer)}</mj-text>
            <mj-text font-size="12px" color="#94A3B8">${escapeHtml(preferences)}</mj-text>
          </mj-column>
        </mj-section>
      </mj-body>
    </mjml>`

  const { html } = await mjml2html(template, { validationLevel: 'soft' })

  const text = [
    ...input.blocks.flatMap((block) => [block.title, block.body, ...(block.items ?? [])]),
    input.action ? `${input.action.label}: ${input.action.url}` : '',
    footer,
  ]
    .filter((line) => line.length > 0)
    .join('\n\n')

  return { html, text }
}

export interface MailResult {
  delivered: boolean
  /** True when there is no SMTP host and the email was only logged. */
  simulated: boolean
}

/**
 * Whether this installation can send email at all.
 *
 * Asked before promising somebody an invitation: with no host the mailer
 * writes the message to the log and reports success, which is the right
 * behaviour for a developer and a lie to an administrator.
 */
export function mailConfigured(): boolean {
  return Boolean(env().SMTP_HOST)
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  const { html, text } = await renderMail(input)
  const transport = mailer()

  if (!transport) return { delivered: false, simulated: true }

  await transport.sendMail({
    from: env().SMTP_FROM,
    to: input.to,
    subject: input.subject,
    html,
    text,
  })

  return { delivered: true, simulated: false }
}

/** Lets the tests and the worker share one transport without leaking it. */
export function resetMailer(): void {
  transporter = null
}
