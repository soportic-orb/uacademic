-- AlterTable
ALTER TABLE `calendar_connections` ADD COLUMN `busy_sync_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `calendar_name` VARCHAR(255) NULL,
    ADD COLUMN `consent_version` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `last_busy_sync_at` DATETIME(3) NULL,
    ADD COLUMN `sync_token` TEXT NULL;

-- CreateTable
CREATE TABLE `calendar_tombstones` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `payload_json` JSON NOT NULL,
    `reason` VARCHAR(100) NULL,
    `cancelled_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `calendar_tombstones_user_id_expires_at_idx`(`user_id`, `expires_at`),
    INDEX `calendar_tombstones_center_id_idx`(`center_id`),
    UNIQUE INDEX `calendar_tombstones_user_id_session_id_key`(`user_id`, `session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consent_records` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `scope` VARCHAR(100) NOT NULL,
    `version` INTEGER NOT NULL,
    `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    `ip` VARCHAR(64) NULL,
    `details_json` JSON NULL,

    INDEX `consent_records_user_id_scope_idx`(`user_id`, `scope`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `calendar_tombstones` ADD CONSTRAINT `calendar_tombstones_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_tombstones` ADD CONSTRAINT `calendar_tombstones_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
