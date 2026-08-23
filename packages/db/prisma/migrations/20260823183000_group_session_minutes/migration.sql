-- How long a class of this group lasts. Null keeps the center's own default.
ALTER TABLE `groups` ADD COLUMN `session_minutes` SMALLINT NULL;
