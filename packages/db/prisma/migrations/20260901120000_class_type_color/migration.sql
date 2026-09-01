-- The colour a center chose for a kind of class. Shown as a wash behind a day
-- rather than as ink on it: the subject's own colour is what marks the day.
ALTER TABLE `class_types` ADD COLUMN `color` CHAR(7) NULL;
