-- CreateTable
CREATE TABLE `session_teachers` (
    `session_id` CHAR(36) NOT NULL,
    `teacher_profile_id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_teachers_teacher_profile_id_idx`(`teacher_profile_id`),
    INDEX `session_teachers_center_id_session_id_idx`(`center_id`, `session_id`),
    PRIMARY KEY (`session_id`, `teacher_profile_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `session_teachers` ADD CONSTRAINT `session_teachers_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session_teachers` ADD CONSTRAINT `session_teachers_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session_teachers` ADD CONSTRAINT `session_teachers_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
