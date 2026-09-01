-- The kinds of class a center gives, and the kind each class is.
--
-- A kind of class belongs to the class, not to the group: one group has
-- lectures, practicals and laboratory sessions, of different lengths and in
-- different rooms. So the group loses the three columns that said otherwise.
CREATE TABLE `class_types` (
  `id` CHAR(36) NOT NULL,
  `center_id` CHAR(36) NOT NULL,
  `name_ca` VARCHAR(60) NOT NULL,
  `name_es` VARCHAR(60) NOT NULL,
  `name_en` VARCHAR(60) NOT NULL,
  `default_minutes` SMALLINT NOT NULL DEFAULT 60,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `class_types_center_id_name_ca_key`(`center_id`, `name_ca`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `class_types` ADD CONSTRAINT `class_types_center_id_fkey`
  FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sessions` ADD COLUMN `class_type_id` CHAR(36) NULL;

ALTER TABLE `sessions` ADD CONSTRAINT `sessions_class_type_id_fkey`
  FOREIGN KEY (`class_type_id`) REFERENCES `class_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `groups` DROP COLUMN `type`;
ALTER TABLE `groups` DROP COLUMN `session_minutes`;
ALTER TABLE `groups` DROP COLUMN `required_space_type`;
