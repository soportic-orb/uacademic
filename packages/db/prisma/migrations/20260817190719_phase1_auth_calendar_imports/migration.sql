-- AlterTable
ALTER TABLE `users` MODIFY `status` ENUM('active', 'invited', 'pending_activation', 'suspended') NOT NULL DEFAULT 'invited';

-- CreateTable
CREATE TABLE `local_credentials` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `totp_secret_enc` TEXT NULL,
    `totp_confirmed_at` DATETIME(3) NULL,
    `failed_attempts` SMALLINT NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `password_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `local_credentials_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `method` ENUM('entra', 'local') NOT NULL,
    `entra_tid` CHAR(36) NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    `user_agent` VARCHAR(400) NULL,
    `ip` VARCHAR(45) NULL,

    INDEX `auth_sessions_user_id_expires_at_idx`(`user_id`, `expires_at`),
    INDEX `auth_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `academic_calendar` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `type` ENUM('holiday', 'non_teaching', 'exam_period', 'term_start', 'term_end', 'event') NOT NULL,
    `date_from` DATE NOT NULL,
    `date_to` DATE NOT NULL,
    `name_ca` VARCHAR(200) NOT NULL,
    `name_es` VARCHAR(200) NOT NULL,
    `name_en` VARCHAR(200) NOT NULL,
    `is_teaching_day` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `academic_calendar_center_id_academic_year_id_date_from_idx`(`center_id`, `academic_year_id`, `date_from`),
    INDEX `academic_calendar_center_id_type_idx`(`center_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_batches` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NULL,
    `type` ENUM('teachers', 'subjects') NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(150) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `status` ENUM('uploaded', 'mapped', 'validated', 'applied', 'failed', 'cancelled') NOT NULL DEFAULT 'uploaded',
    `headers_json` JSON NULL,
    `mapping_json` JSON NULL,
    `summary_json` JSON NULL,
    `created_by` CHAR(36) NULL,
    `applied_by` CHAR(36) NULL,
    `applied_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `import_batches_center_id_status_idx`(`center_id`, `status`),
    INDEX `import_batches_center_id_type_created_at_idx`(`center_id`, `type`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_rows` (
    `id` CHAR(36) NOT NULL,
    `import_batch_id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `row_number` INTEGER NOT NULL,
    `raw_json` JSON NOT NULL,
    `normalized_json` JSON NULL,
    `status` ENUM('pending', 'valid', 'invalid', 'applied', 'skipped') NOT NULL DEFAULT 'pending',
    `errors_json` JSON NULL,
    `entity_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `import_rows_import_batch_id_status_idx`(`import_batch_id`, `status`),
    INDEX `import_rows_center_id_idx`(`center_id`),
    UNIQUE INDEX `import_rows_import_batch_id_row_number_key`(`import_batch_id`, `row_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `local_credentials` ADD CONSTRAINT `local_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_calendar` ADD CONSTRAINT `academic_calendar_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_calendar` ADD CONSTRAINT `academic_calendar_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_applied_by_fkey` FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_import_batch_id_fkey` FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
