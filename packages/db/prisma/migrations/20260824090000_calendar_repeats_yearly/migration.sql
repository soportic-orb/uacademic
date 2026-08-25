-- A day that comes round every year, carried into each new academic calendar.
ALTER TABLE `academic_calendar` ADD COLUMN `repeats_yearly` BOOLEAN NOT NULL DEFAULT false;
