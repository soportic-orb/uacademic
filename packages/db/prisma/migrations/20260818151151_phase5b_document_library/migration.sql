-- AlterTable
ALTER TABLE `documents` ADD COLUMN `chunk_count` SMALLINT NULL,
    ADD COLUMN `error_detail` TEXT NULL,
    ADD COLUMN `error_key` VARCHAR(100) NULL,
    ADD COLUMN `extracted_with` VARCHAR(30) NULL,
    ADD COLUMN `page_count` SMALLINT NULL,
    ADD COLUMN `processed_at` DATETIME(3) NULL,
    ADD COLUMN `token_count` INTEGER NULL,
    MODIFY `visibility` ENUM('public', 'center', 'coordinators', 'admins', 'ai_only') NOT NULL DEFAULT 'center';
