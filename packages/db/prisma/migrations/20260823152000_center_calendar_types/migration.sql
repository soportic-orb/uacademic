-- A center may add its own kinds of day, so the column stops being a database
-- enum and becomes a key. The seven the platform ships with keep their values.
ALTER TABLE `academic_calendar` MODIFY `type` VARCHAR(50) NOT NULL;

-- CreateTable
CREATE TABLE `calendar_types` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `key` VARCHAR(50) NOT NULL,
    `name_ca` VARCHAR(60) NOT NULL,
    `name_es` VARCHAR(60) NOT NULL,
    `name_en` VARCHAR(60) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `calendar_types_center_id_key_key`(`center_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `calendar_types` ADD CONSTRAINT `calendar_types_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
