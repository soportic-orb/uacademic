/*
  Warnings:

  - You are about to alter the column `confidence` on the `setting_extractions` table. The data in that column could be lost. The data in that column will be cast from `Decimal(3,2)` to `Enum(EnumId(37))`.
  - Added the required column `run_id` to the `setting_extractions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `centers` ADD COLUMN `settings_version_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `setting_extractions` ADD COLUMN `exception_note` TEXT NULL,
    ADD COLUMN `manual_override` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `run_id` CHAR(36) NOT NULL,
    MODIFY `proposed_value_json` JSON NULL,
    MODIFY `confidence` ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'low';

-- CreateTable
CREATE TABLE `setting_extraction_runs` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `requested_by` CHAR(36) NULL,
    `blocks_json` JSON NOT NULL,
    `applied_at` DATETIME(3) NULL,
    `applied_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `setting_extraction_runs_center_id_created_at_idx`(`center_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `setting_extractions_run_id_block_idx` ON `setting_extractions`(`run_id`, `block`);

-- AddForeignKey
ALTER TABLE `setting_extractions` ADD CONSTRAINT `setting_extractions_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `setting_extraction_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setting_extraction_runs` ADD CONSTRAINT `setting_extraction_runs_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setting_extraction_runs` ADD CONSTRAINT `setting_extraction_runs_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setting_extraction_runs` ADD CONSTRAINT `setting_extraction_runs_requested_by_fkey` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
