import { type SubjectDto, formatHours, formatNumber } from '@uacademic/shared'
import { useTranslation } from 'react-i18next'

import { EmptyState, ErrorState, TableSkeleton } from '../components/feedback/states'
import { Card, CardBody } from '../components/ui/card'
import { useSubjects } from '../hooks/use-api'
import { ColumnPicker } from '../components/ui/column-picker'
import { useColumnVisibility } from '../hooks/use-columns'
import { useToast } from '../hooks/use-toast'
import { currentLocale } from '../i18n'

/** Subject names are stored per language; the UI shows the active one (R1). */
function subjectName(subject: SubjectDto, locale: 'ca' | 'es' | 'en'): string {
  if (locale === 'es') return subject.nameEs
  if (locale === 'en') return subject.nameEn
  return subject.nameCa
}

export function SubjectsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const query = useSubjects()
  const locale = currentLocale()

  const columns = useColumnVisibility('subjects', [
    { key: 'ects', label: t('subjects.ects') },
    { key: 'term', label: t('subjects.term') },
    { key: 'groups', label: t('subjects.groups') },
    { key: 'assigned', label: t('load.assigned') },
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('subjects.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subjects.subtitle')}</p>
      </header>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex justify-end">
            <ColumnPicker columns={columns} />
          </div>

          {query.isPending ? (
            <TableSkeleton rows={6} columns={6} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : query.data.items.length === 0 ? (
            <EmptyState
              title={t('subjects.empty.title')}
              description={t('subjects.empty.description')}
              actionLabel={t('subjects.empty.action')}
              onAction={() => toast.info('toast.comingSoon')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('subjects.title')}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('subjects.code')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('subjects.name')}
                    </th>
                    {columns.shows('ects') ? (
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        {t('subjects.ects')}
                      </th>
                    ) : null}
                    {columns.shows('term') ? (
                      <th scope="col" className="py-2 pr-4 font-medium">
                        {t('subjects.term')}
                      </th>
                    ) : null}
                    {columns.shows('groups') ? (
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        {t('subjects.groups')}
                      </th>
                    ) : null}
                    {columns.shows('assigned') ? (
                      <th scope="col" className="py-2 text-right font-medium">
                        {t('load.assigned')}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((subject) => (
                    <tr key={subject.id} className="border-b border-border/60">
                      <td className="tabular py-3 pr-4 text-text-muted">{subject.code}</td>
                      <th scope="row" className="py-3 pr-4 text-left font-medium text-text">
                        {subjectName(subject, locale)}
                      </th>
                      {columns.shows('ects') ? (
                        <td className="tabular py-3 pr-4 text-right text-text">
                          {formatNumber(locale, subject.ects)}
                        </td>
                      ) : null}
                      {columns.shows('term') ? (
                        <td className="py-3 pr-4 text-text-muted">{t(`term.${subject.term}`)}</td>
                      ) : null}
                      {columns.shows('groups') ? (
                        <td className="tabular py-3 pr-4 text-right text-text">
                          {subject.groupCount}
                        </td>
                      ) : null}
                      {columns.shows('assigned') ? (
                        <td className="tabular py-3 text-right text-text">
                          {`${formatHours(locale, subject.assignedHours)} / ${formatHours(locale, subject.plannedHours)}`}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
