/**
 * The personal panel: hours by subject and by concept.
 *
 * The chart is a table with bars drawn behind the figures rather than a canvas:
 * it reads the same to a screen reader as it does to an eye, it prints, and it
 * costs no chart library on a PWA that has to load over a campus network.
 */
import type { TeacherWorkloadDto } from '@uacademic/shared'
import { formatHours, formatPercent } from '@uacademic/shared'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '../../components/feedback/states'
import { Card, CardBody, CardHeader } from '../../components/ui/card'
import { currentLocale } from '../../i18n'

export function WorkloadBreakdown({ workload }: { workload: TeacherWorkloadDto }) {
  const { t } = useTranslation()
  const locale = currentLocale()

  if (workload.assignedHours <= 0) {
    return (
      <Card>
        <CardHeader title={t('teachers.workload.title')} />
        <CardBody>
          <EmptyState title={t('teachers.workload.empty')} />
        </CardBody>
      </Card>
    )
  }

  const concepts = workload.conceptTotals.filter((total) => total.hours > 0)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={t('teachers.workload.byConcept')}
          description={t('teachers.workload.subtitle')}
        />
        <CardBody>
          <table className="w-full text-sm">
            <caption className="sr-only">{t('teachers.workload.chartLabel')}</caption>
            <thead>
              <tr className="border-b border-border text-left text-text-muted">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t('teachers.workload.byConcept')}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('teachers.workload.hours')}
                </th>
                <th scope="col" className="w-1/2 py-2 font-medium">
                  {t('teachers.workload.share')}
                </th>
              </tr>
            </thead>
            <tbody>
              {concepts.map((total) => (
                <tr key={total.concept} className="border-b border-border/60">
                  <th scope="row" className="py-3 pr-4 text-left font-medium text-text">
                    {t(`assignmentConcept.${total.concept}`)}
                  </th>
                  <td className="tabular py-3 pr-4 text-right text-text">
                    {formatHours(locale, total.hours)}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="h-2 min-w-0.5 rounded-full bg-primary"
                        style={{ width: `${Math.max(total.percent, 1)}%` }}
                      />
                      <span className="tabular text-text-muted">
                        {formatPercent(locale, total.percent)}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('teachers.workload.bySubject')} />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('teachers.workload.bySubject')}</caption>
              <thead>
                <tr className="border-b border-border text-left text-text-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('teachers.workload.subject')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('teachers.workload.groups')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('teachers.workload.byConcept')}
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    {t('teachers.workload.hours')}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('teachers.workload.share')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {workload.bySubject.map((subject) => (
                  <tr key={subject.subjectId} className="border-b border-border/60">
                    <th scope="row" className="py-3 pr-4 text-left font-medium text-text">
                      <span className="tabular text-text-muted">{subject.subjectCode}</span>
                      <span className="ml-2">{subject.subjectName}</span>
                    </th>
                    <td className="py-3 pr-4 text-text-muted">
                      {subject.groups
                        .map((group) => group.groupCode ?? t('common.none'))
                        .join(', ')}
                    </td>
                    <td className="py-3 pr-4 text-text-muted">
                      {subject.byConcept
                        .map(
                          (entry) =>
                            `${t(`assignmentConcept.${entry.concept}`)} ${formatHours(
                              locale,
                              entry.hours,
                            )} ${t('common.hoursShort')}`,
                        )
                        .join(' · ')}
                    </td>
                    <td className="tabular py-3 pr-4 text-right text-text">
                      {formatHours(locale, subject.hours)}
                    </td>
                    <td className="tabular py-3 text-right text-text-muted">
                      {formatPercent(locale, subject.percent)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium text-text">
                  <td className="py-3 pr-4" colSpan={3}>
                    {t('common.total')}
                  </td>
                  <td className="tabular py-3 pr-4 text-right">
                    {formatHours(locale, workload.assignedHours)}
                  </td>
                  <td className="tabular py-3 text-right">{formatPercent(locale, 100)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
