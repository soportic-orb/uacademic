-- A group normally meets in the same room, and it was typed in again on every
-- session. This is the default a session starts from.
ALTER TABLE `groups` ADD COLUMN `space_id` CHAR(36) NULL;

CREATE INDEX `groups_space_id_idx` ON `groups`(`space_id`);

ALTER TABLE `groups` ADD CONSTRAINT `groups_space_id_fkey` FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
