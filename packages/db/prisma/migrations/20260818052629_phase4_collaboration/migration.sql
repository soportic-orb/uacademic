/*
  Warnings:

  - You are about to alter the column `status` on the `change_requests` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(33))` to `Enum(EnumId(23))`.

*/
-- AlterTable
ALTER TABLE `absences` ADD COLUMN `reason` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `change_requests` ADD COLUMN `applied_at` DATETIME(3) NULL,
    ADD COLUMN `expires_at` DATETIME(3) NULL,
    MODIFY `status` ENUM('draft', 'requested', 'accepted_by_teacher', 'approved_by_coordinator', 'applied', 'rejected', 'cancelled', 'expired') NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE `notification_prefs` ADD COLUMN `digest` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `digest_sent_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `change_requests_status_expires_at_idx` ON `change_requests`(`status`, `expires_at`);

-- CreateIndex
CREATE FULLTEXT INDEX `messages_body_idx` ON `messages`(`body`);
