-- CreateTable
CREATE TABLE `ai_conversations` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NULL,
    `title` VARCHAR(200) NULL,
    `last_message_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_conversations_user_id_last_message_at_idx`(`user_id`, `last_message_at`),
    INDEX `ai_conversations_center_id_subject_id_idx`(`center_id`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_messages` (
    `id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `role` ENUM('user', 'assistant') NOT NULL,
    `content` TEXT NOT NULL,
    `blocks_json` JSON NULL,
    `tokens_in` INTEGER NULL,
    `tokens_out` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_messages_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_proposals` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `tool` VARCHAR(100) NOT NULL,
    `input_json` JSON NOT NULL,
    `preview_json` JSON NOT NULL,
    `status` ENUM('pending', 'confirmed', 'rejected', 'expired', 'failed') NOT NULL DEFAULT 'pending',
    `resolved_by` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `error` TEXT NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_proposals_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    INDEX `ai_proposals_center_id_status_idx`(`center_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_resolved_by_fkey` FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
