import { formatHours, formatPersonName } from '@uacademic/shared'
import { useTranslation } from 'react-i18next'

import { LoadBadge } from '../components/data/load-badge'
import { EmptyState, ErrorState, TableSkeleton } from '../components/feedback/states'
import { Card, CardBody } from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { useTeacherLoad } from '../hooks/use-api'
import { currentLocale } from '../i18n'

export function TeachersPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const query = useTeacherLoad()
  const locale = currentLocale()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('teachers.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('teachers.subtitle')}</p>
      </header>

      <Card>
        <CardBody>
          {query.isPending ? (
            <TableSkeleton rows={6} columns={5} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : query.data.teachers.length === 0 ? (
            <EmptyState
              title={t('teachers.empty.title')}
              description={t('teachers.empty.description')}
              actionLabel={t('teachers.empty.action')}
              onAction={() => toast.info('toast.comingSoon')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('teachers.title')}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('teachers.name')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('teachers.category')}
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      {t('teachers.contracted')}
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      {t('teachers.assigned')}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {t('teachers.status')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.teachers.map((teacher) => (
                    <tr key={teacher.teacherProfileId} className="border-b border-border/60">
                      <th scope="row" className="py-3 pr-4 text-left font-medium text-text">
                        {formatPersonName(teacher.firstName, teacher.lastName)}
                      </th>
                      <td className="py-3 pr-4 text-text-muted">
                        {t(`teacherCategory.${teacher.category}`)}
                      </td>
                      <td className="tabular py-3 pr-4 text-right text-text">
                        {formatHours(locale, teacher.capacityHours)}
                      </td>
                      <td className="tabular py-3 pr-4 text-right text-text">
                        {formatHours(locale, teacher.assignedHours)}
                      </td>
                      <td className="py-3">
                        <LoadBadge status={teacher.status} ratioPercent={teacher.ratioPercent} />
                      </td>
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
