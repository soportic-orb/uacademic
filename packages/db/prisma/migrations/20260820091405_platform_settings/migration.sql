-- CreateTable
CREATE TABLE `platform_settings` (
    `key` VARCHAR(64) NOT NULL,
    `value_json` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(36) NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
