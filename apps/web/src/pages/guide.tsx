import type { Role } from '@uacademic/shared'
import { ROLES, guideFor } from '@uacademic/shared'
import { ArrowRight, Check, Circle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useRoles } from '../app/use-roles'
import { Button } from '../components/ui/button'
import { Card, CardBody, CardHeader } from '../components/ui/card'

const STORAGE_KEY = 'uacademic.guide.done'

/**
 * Which steps somebody has ticked off.
 *
 * Kept in the browser rather than on the server on purpose: it is a reading
 * aid, not a record of anything. A center whose year was created by somebody
 * else should not have that step un-tick itself for everyone, and nothing in
 * the product should behave differently because a box here is checked.
 */
function useDoneSteps() {
  const [done, setDone] = useState<Set<string>>(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      return new Set(stored ? (JSON.parse(stored) as string[]) : [])
    } catch {
      return new Set()
    }
  })

  const persist = (next: Set<string>) => {
    setDone(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
    } catch {
      // A browser refusing storage is not a reason to break the page.
    }
  }

  return {
    done,
    toggle: (key: string) => {
      const next = new Set(done)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      persist(next)
    },
    reset: () => persist(new Set()),
  }
}

/**
 * The step-by-step guide for whichever role you are reading as.
 *
 * The order is the product's own: most of what looks like a broken screen to
 * somebody new is a step from further up that has not happened yet — a center
 * with no academic year has no load to summarise, a coordinator with no groups
 * has nothing to place.
 */
export function GuidePage() {
  const { t } = useTranslation()
  const roles = useRoles()
  const { done, toggle, reset } = useDoneSteps()

  // The role the interface is currently drawn for; a person with two roles is
  // reading the guide for the one they are working as.
  const [reading, setReading] = useState<Role>(roles[0] ?? 'TEACHER')
  const steps = guideFor(reading)
  const doneCount = steps.filter((step) => done.has(step.key)).length

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('guide.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('guide.subtitle')}</p>
      </header>

      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm text-text">{t('guide.intro')}</p>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-text-muted">{t('guide.otherRoles')}</span>
              <select
                value={reading}
                onChange={(event) => setReading(event.target.value as Role)}
                className="h-10 rounded-control border border-border bg-surface px-2 text-sm text-text"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`roles.${role}`)}
                  </option>
                ))}
              </select>
            </label>

            <div className="text-right">
              <p className="tabular text-sm text-text">
                {t('guide.progress', { done: doneCount, total: steps.length })}
              </p>
              {doneCount > 0 ? (
                <Button variant="link" onClick={reset}>
                  {t('guide.resetProgress')}
                </Button>
              ) : null}
            </div>
          </div>

          <p className="text-xs text-text-muted">{t('guide.progressHint')}</p>
        </CardBody>
      </Card>

      <ol className="space-y-4">
        {steps.map((step, index) => {
          const isDone = done.has(step.key)

          return (
            <li key={step.key}>
              <Card>
                <CardHeader
                  title={t(`guide.steps.${step.key}.title`)}
                  description={t('guide.stepOf', { index: index + 1, total: steps.length })}
                  icon={
                    <button
                      type="button"
                      onClick={() => toggle(step.key)}
                      aria-pressed={isDone}
                      aria-label={t(isDone ? 'guide.done' : 'guide.markDone')}
                      className="flex size-8 items-center justify-center rounded-full border border-border text-text-muted hover:text-primary"
                    >
                      {isDone ? (
                        <Check className="size-4 text-primary" aria-hidden="true" />
                      ) : (
                        <Circle className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  }
                />
                <CardBody className="space-y-3">
                  <p className="text-sm text-text">{t(`guide.steps.${step.key}.body`)}</p>

                  {step.to ? (
                    <Link
                      to={step.to}
                      className="inline-flex items-center gap-2 text-sm text-primary underline-offset-2 hover:underline"
                    >
                      {t('guide.openScreen')}
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
