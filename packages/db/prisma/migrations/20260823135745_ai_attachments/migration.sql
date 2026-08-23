
-- CreateTable
CREATE TABLE `ai_attachments` (
    `id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(120) NOT NULL,
    `text` MEDIUMTEXT NOT NULL,
    `page_count` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_attachments_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_attachments` ADD CONSTRAINT `ai_attachments_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
