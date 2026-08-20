-- AlterTable
ALTER TABLE `academic_calendar` MODIFY `type` ENUM('holiday', 'vacation', 'non_teaching', 'exam_period', 'term_start', 'term_end', 'event') NOT NULL;
