-- CreateTable
CREATE TABLE `universities` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `logo_url` VARCHAR(500) NULL,
    `settings_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entra_tenants` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `display_name` VARCHAR(200) NOT NULL,
    `issuer` VARCHAR(300) NULL,
    `status` ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `entra_tenants_tenant_id_key`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `centers` (
    `id` CHAR(36) NOT NULL,
    `university_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `entra_tenant_id` CHAR(36) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid',
    `locale_default` ENUM('ca', 'es', 'en') NOT NULL DEFAULT 'ca',
    `settings_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `centers_entra_tenant_id_idx`(`entra_tenant_id`),
    UNIQUE INDEX `centers_university_id_code_key`(`university_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `academic_years` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `status` ENUM('draft', 'active', 'closed') NOT NULL DEFAULT 'draft',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `academic_years_center_id_status_idx`(`center_id`, `status`),
    UNIQUE INDEX `academic_years_center_id_name_key`(`center_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `entra_oid` CHAR(36) NULL,
    `email` VARCHAR(255) NOT NULL,
    `first_name` VARCHAR(100) NOT NULL,
    `last_name` VARCHAR(150) NOT NULL,
    `locale` ENUM('ca', 'es', 'en') NOT NULL DEFAULT 'ca',
    `theme` ENUM('light', 'dark', 'system') NOT NULL DEFAULT 'system',
    `avatar_url` VARCHAR(500) NULL,
    `status` ENUM('active', 'invited', 'suspended') NOT NULL DEFAULT 'invited',
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_entra_oid_key`(`entra_oid`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_center_roles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `role` ENUM('SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER') NOT NULL,
    `valid_from` DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `valid_to` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_center_roles_center_id_role_idx`(`center_id`, `role`),
    UNIQUE INDEX `user_center_roles_user_id_center_id_role_key`(`user_id`, `center_id`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `degrees` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name_ca` VARCHAR(200) NOT NULL,
    `name_es` VARCHAR(200) NOT NULL,
    `name_en` VARCHAR(200) NOT NULL,
    `level` ENUM('bachelor', 'master', 'doctorate', 'own_degree') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `degrees_center_id_code_key`(`center_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subjects` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `degree_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name_ca` VARCHAR(200) NOT NULL,
    `name_es` VARCHAR(200) NOT NULL,
    `name_en` VARCHAR(200) NOT NULL,
    `ects` DECIMAL(4, 1) NOT NULL,
    `year` SMALLINT NOT NULL,
    `term` ENUM('t1', 't2', 't3', 'annual') NOT NULL,
    `type` ENUM('basic', 'compulsory', 'elective', 'practicum', 'final_project') NOT NULL,
    `teaching_language` ENUM('ca', 'es', 'en', 'other') NOT NULL DEFAULT 'ca',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subjects_center_id_academic_year_id_idx`(`center_id`, `academic_year_id`),
    INDEX `subjects_degree_id_idx`(`degree_id`),
    UNIQUE INDEX `subjects_center_id_academic_year_id_code_key`(`center_id`, `academic_year_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subject_coordinators` (
    `subject_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `subject_coordinators_center_id_user_id_idx`(`center_id`, `user_id`),
    PRIMARY KEY (`subject_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `groups` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `type` ENUM('theory', 'seminar', 'lab', 'practicum', 'tutoring') NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `planned_hours` DECIMAL(6, 2) NOT NULL,
    `capacity` SMALLINT NULL,
    `required_space_type` ENUM('classroom', 'seminar_room', 'computer_lab', 'lab', 'auditorium', 'other') NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `groups_center_id_subject_id_idx`(`center_id`, `subject_id`),
    UNIQUE INDEX `groups_subject_id_code_key`(`subject_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_profiles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `category` ENUM('full_professor', 'associate_professor', 'assistant_professor', 'lecturer', 'adjunct', 'visiting', 'external') NOT NULL,
    `dedication` ENUM('full_time', 'part_time', 'hourly') NOT NULL,
    `contracted_hours` DECIMAL(6, 2) NOT NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `teacher_profiles_center_id_academic_year_id_idx`(`center_id`, `academic_year_id`),
    UNIQUE INDEX `teacher_profiles_user_id_center_id_academic_year_id_key`(`user_id`, `center_id`, `academic_year_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_reductions` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `teacher_profile_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `hours` DECIMAL(6, 2) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `teacher_reductions_center_id_teacher_profile_id_idx`(`center_id`, `teacher_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_skills` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `teacher_profile_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NULL,
    `knowledge_area` VARCHAR(150) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `teacher_skills_center_id_subject_id_idx`(`center_id`, `subject_id`),
    UNIQUE INDEX `teacher_skills_teacher_profile_id_subject_id_key`(`teacher_profile_id`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `availability` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `teacher_profile_id` CHAR(36) NOT NULL,
    `weekday` TINYINT NOT NULL,
    `start_time` CHAR(5) NOT NULL,
    `end_time` CHAR(5) NOT NULL,
    `level` ENUM('preferred', 'available', 'avoid', 'unavailable') NOT NULL DEFAULT 'available',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `availability_teacher_profile_id_weekday_start_time_idx`(`teacher_profile_id`, `weekday`, `start_time`),
    INDEX `availability_center_id_weekday_idx`(`center_id`, `weekday`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `availability_exceptions` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `teacher_profile_id` CHAR(36) NOT NULL,
    `date_from` DATE NOT NULL,
    `date_to` DATE NOT NULL,
    `reason` VARCHAR(255) NULL,
    `level` ENUM('preferred', 'available', 'avoid', 'unavailable') NOT NULL DEFAULT 'unavailable',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `availability_exceptions_teacher_profile_id_date_from_idx`(`teacher_profile_id`, `date_from`),
    INDEX `availability_exceptions_center_id_date_from_idx`(`center_id`, `date_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spaces` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `building` VARCHAR(100) NULL,
    `name` VARCHAR(100) NOT NULL,
    `capacity` SMALLINT NOT NULL,
    `type` ENUM('classroom', 'seminar_room', 'computer_lab', 'lab', 'auditorium', 'other') NOT NULL DEFAULT 'classroom',
    `equipment_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `spaces_center_id_type_idx`(`center_id`, `type`),
    UNIQUE INDEX `spaces_center_id_building_name_key`(`center_id`, `building`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedule_versions` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `status` ENUM('draft', 'in_review', 'published', 'archived') NOT NULL DEFAULT 'draft',
    `published_at` DATETIME(3) NULL,
    `published_by` CHAR(36) NULL,
    `parent_version_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `schedule_versions_center_id_academic_year_id_status_idx`(`center_id`, `academic_year_id`, `status`),
    INDEX `schedule_versions_parent_version_id_idx`(`parent_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `schedule_version_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NOT NULL,
    `teacher_profile_id` CHAR(36) NULL,
    `space_id` CHAR(36) NULL,
    `weekday` TINYINT NOT NULL,
    `start_time` CHAR(5) NOT NULL,
    `end_time` CHAR(5) NOT NULL,
    `date_from` DATE NOT NULL,
    `date_to` DATE NOT NULL,
    `recurrence` ENUM('weekly', 'biweekly', 'once') NOT NULL DEFAULT 'weekly',
    `is_exception` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sessions_schedule_version_id_weekday_idx`(`schedule_version_id`, `weekday`),
    INDEX `sessions_teacher_profile_id_weekday_start_time_idx`(`teacher_profile_id`, `weekday`, `start_time`),
    INDEX `sessions_space_id_weekday_start_time_idx`(`space_id`, `weekday`, `start_time`),
    INDEX `sessions_center_id_schedule_version_id_idx`(`center_id`, `schedule_version_id`),
    INDEX `sessions_group_id_idx`(`group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assignments` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NOT NULL,
    `teacher_profile_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `assigned_hours` DECIMAL(6, 2) NOT NULL,
    `concept` ENUM('lecture', 'tutoring', 'coordination', 'tfg', 'other') NOT NULL DEFAULT 'lecture',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assignments_center_id_academic_year_id_idx`(`center_id`, `academic_year_id`),
    INDEX `assignments_teacher_profile_id_idx`(`teacher_profile_id`),
    UNIQUE INDEX `assignments_group_id_teacher_profile_id_concept_key`(`group_id`, `teacher_profile_id`, `concept`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `change_requests` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `type` ENUM('session_swap', 'session_move', 'session_cancel', 'space_change', 'substitution', 'availability_change') NOT NULL,
    `requester_id` CHAR(36) NOT NULL,
    `target_user_id` CHAR(36) NULL,
    `session_id` CHAR(36) NULL,
    `proposed_json` JSON NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'withdrawn') NOT NULL DEFAULT 'pending',
    `resolved_by` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `change_requests_center_id_status_idx`(`center_id`, `status`),
    INDEX `change_requests_requester_id_idx`(`requester_id`),
    INDEX `change_requests_session_id_idx`(`session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `absences` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `teacher_profile_id` CHAR(36) NOT NULL,
    `date_from` DATE NOT NULL,
    `date_to` DATE NOT NULL,
    `type` ENUM('sick_leave', 'personal_leave', 'conference', 'training', 'other') NOT NULL,
    `substitute_profile_id` CHAR(36) NULL,
    `status` ENUM('requested', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'requested',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `absences_center_id_date_from_idx`(`center_id`, `date_from`),
    INDEX `absences_teacher_profile_id_date_from_idx`(`teacher_profile_id`, `date_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `type` ENUM('direct', 'group', 'subject', 'announcement') NOT NULL,
    `subject_id` CHAR(36) NULL,
    `title` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `conversations_center_id_type_idx`(`center_id`, `type`),
    INDEX `conversations_subject_id_idx`(`subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_members` (
    `conversation_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `last_read_at` DATETIME(3) NULL,
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `conversation_members_user_id_idx`(`user_id`),
    PRIMARY KEY (`conversation_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `sender_id` CHAR(36) NOT NULL,
    `body` TEXT NOT NULL,
    `attachments_json` JSON NULL,
    `edited_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `messages_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    INDEX `messages_center_id_created_at_idx`(`center_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `payload_json` JSON NOT NULL,
    `read_at` DATETIME(3) NULL,
    `channels_sent` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_idx`(`user_id`, `read_at`),
    INDEX `notifications_center_id_created_at_idx`(`center_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_prefs` (
    `user_id` CHAR(36) NOT NULL,
    `event_type` VARCHAR(100) NOT NULL,
    `in_app` BOOLEAN NOT NULL DEFAULT true,
    `push` BOOLEAN NOT NULL DEFAULT false,
    `email` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`user_id`, `event_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `endpoint` TEXT NOT NULL,
    `endpoint_hash` CHAR(64) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `user_agent` VARCHAR(400) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `push_subscriptions_endpoint_hash_key`(`endpoint_hash`),
    INDEX `push_subscriptions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_feed_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token` CHAR(64) NOT NULL,
    `filters_json` JSON NULL,
    `last_fetched_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `calendar_feed_tokens_token_key`(`token`),
    INDEX `calendar_feed_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_connections` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `provider` ENUM('microsoft', 'google') NOT NULL,
    `external_calendar_id` VARCHAR(255) NULL,
    `access_token_enc` TEXT NOT NULL,
    `refresh_token_enc` TEXT NULL,
    `expires_at` DATETIME(3) NULL,
    `scopes` VARCHAR(500) NULL,
    `sync_direction` ENUM('push', 'pull', 'both') NOT NULL DEFAULT 'push',
    `status` ENUM('active', 'expired', 'revoked', 'error') NOT NULL DEFAULT 'active',
    `last_sync_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `consent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `calendar_connections_user_id_provider_key`(`user_id`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_event_map` (
    `id` CHAR(36) NOT NULL,
    `connection_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `external_event_id` VARCHAR(255) NOT NULL,
    `etag` VARCHAR(255) NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `last_synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calendar_event_map_external_event_id_idx`(`external_event_id`),
    UNIQUE INDEX `calendar_event_map_connection_id_session_id_key`(`connection_id`, `session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_busy_slots` (
    `id` CHAR(36) NOT NULL,
    `teacher_profile_id` CHAR(36) NOT NULL,
    `connection_id` CHAR(36) NOT NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `source` ENUM('microsoft', 'google', 'manual') NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `external_busy_slots_teacher_profile_id_start_at_idx`(`teacher_profile_id`, `start_at`),
    INDEX `external_busy_slots_connection_id_idx`(`connection_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `scope` ENUM('university', 'center', 'degree', 'subject') NOT NULL,
    `scope_id` CHAR(36) NULL,
    `title` VARCHAR(300) NOT NULL,
    `type` ENUM('regulation', 'teaching_plan', 'agreement', 'guide', 'minutes', 'other') NOT NULL,
    `academic_year_id` CHAR(36) NULL,
    `language` ENUM('ca', 'es', 'en') NOT NULL DEFAULT 'ca',
    `valid_from` DATE NULL,
    `valid_to` DATE NULL,
    `visibility` ENUM('public', 'center', 'coordinators', 'admins') NOT NULL DEFAULT 'center',
    `file_path` VARCHAR(500) NOT NULL,
    `mime` VARCHAR(150) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `checksum` CHAR(64) NOT NULL,
    `status` ENUM('uploaded', 'processing', 'indexed', 'failed', 'archived') NOT NULL DEFAULT 'uploaded',
    `uploaded_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `documents_center_id_scope_scope_id_idx`(`center_id`, `scope`, `scope_id`),
    INDEX `documents_center_id_academic_year_id_idx`(`center_id`, `academic_year_id`),
    INDEX `documents_center_id_status_idx`(`center_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_chunks` (
    `id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `ordinal` INTEGER NOT NULL,
    `heading_path` VARCHAR(500) NULL,
    `page_from` SMALLINT NULL,
    `page_to` SMALLINT NULL,
    `content` TEXT NOT NULL,
    `token_count` INTEGER NOT NULL,
    `embedding` BLOB NULL,
    `embedding_model` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_chunks_center_id_idx`(`center_id`),
    UNIQUE INDEX `document_chunks_document_id_ordinal_key`(`document_id`, `ordinal`),
    FULLTEXT INDEX `document_chunks_content_idx`(`content`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `center_settings_versions` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NULL,
    `settings_json` JSON NOT NULL,
    `source` ENUM('manual', 'ai_extraction') NOT NULL DEFAULT 'manual',
    `source_document_id` CHAR(36) NULL,
    `approved_by` CHAR(36) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `center_settings_versions_center_id_academic_year_id_idx`(`center_id`, `academic_year_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `setting_extractions` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `block` VARCHAR(100) NOT NULL,
    `param_key` VARCHAR(150) NOT NULL,
    `proposed_value_json` JSON NOT NULL,
    `unit` VARCHAR(50) NULL,
    `current_value_json` JSON NULL,
    `confidence` DECIMAL(3, 2) NOT NULL,
    `citation_json` JSON NULL,
    `reasoning` TEXT NULL,
    `status` ENUM('pending', 'accepted', 'edited', 'rejected', 'not_found') NOT NULL DEFAULT 'pending',
    `resolved_value_json` JSON NULL,
    `resolved_by` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `setting_extractions_center_id_status_idx`(`center_id`, `status`),
    INDEX `setting_extractions_document_id_param_key_idx`(`document_id`, `param_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `setting_provenance` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `param_key` VARCHAR(150) NOT NULL,
    `settings_version_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NULL,
    `page` SMALLINT NULL,
    `section` VARCHAR(200) NULL,
    `quote` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `setting_provenance_center_id_param_key_idx`(`center_id`, `param_key`),
    UNIQUE INDEX `setting_provenance_settings_version_id_param_key_key`(`settings_version_id`, `param_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_interactions` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `prompt` TEXT NOT NULL,
    `response` TEXT NULL,
    `tools_used_json` JSON NULL,
    `documents_used_json` JSON NULL,
    `tokens_in` INTEGER NULL,
    `tokens_out` INTEGER NULL,
    `action_executed` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_interactions_center_id_created_at_idx`(`center_id`, `created_at`),
    INDEX `ai_interactions_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` CHAR(36) NOT NULL,
    `center_id` CHAR(36) NULL,
    `user_id` CHAR(36) NULL,
    `entity` VARCHAR(100) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `before_json` JSON NULL,
    `after_json` JSON NULL,
    `source` ENUM('user', 'ai', 'system') NOT NULL DEFAULT 'user',
    `ip` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_center_id_entity_entity_id_idx`(`center_id`, `entity`, `entity_id`),
    INDEX `audit_log_center_id_created_at_idx`(`center_id`, `created_at`),
    INDEX `audit_log_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_versions` (
    `id` CHAR(36) NOT NULL,
    `version` VARCHAR(50) NOT NULL,
    `released_at` DATETIME(3) NULL,
    `applied_at` DATETIME(3) NULL,
    `applied_by` CHAR(36) NULL,
    `status` ENUM('available', 'applying', 'applied', 'failed', 'rolled_back') NOT NULL DEFAULT 'available',
    `changelog` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `app_versions_version_key`(`version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` CHAR(36) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `payload_json` JSON NOT NULL,
    `run_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` SMALLINT NOT NULL DEFAULT 0,
    `max_attempts` SMALLINT NOT NULL DEFAULT 5,
    `status` ENUM('pending', 'running', 'succeeded', 'failed', 'dead') NOT NULL DEFAULT 'pending',
    `locked_at` DATETIME(3) NULL,
    `locked_by` VARCHAR(100) NULL,
    `last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `jobs_status_run_at_idx`(`status`, `run_at`),
    INDEX `jobs_type_status_idx`(`type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `centers` ADD CONSTRAINT `centers_university_id_fkey` FOREIGN KEY (`university_id`) REFERENCES `universities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `centers` ADD CONSTRAINT `centers_entra_tenant_id_fkey` FOREIGN KEY (`entra_tenant_id`) REFERENCES `entra_tenants`(`tenant_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_years` ADD CONSTRAINT `academic_years_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_center_roles` ADD CONSTRAINT `user_center_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_center_roles` ADD CONSTRAINT `user_center_roles_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `degrees` ADD CONSTRAINT `degrees_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subjects` ADD CONSTRAINT `subjects_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subjects` ADD CONSTRAINT `subjects_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subjects` ADD CONSTRAINT `subjects_degree_id_fkey` FOREIGN KEY (`degree_id`) REFERENCES `degrees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subject_coordinators` ADD CONSTRAINT `subject_coordinators_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subject_coordinators` ADD CONSTRAINT `subject_coordinators_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subject_coordinators` ADD CONSTRAINT `subject_coordinators_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `groups` ADD CONSTRAINT `groups_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `groups` ADD CONSTRAINT `groups_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_profiles` ADD CONSTRAINT `teacher_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_profiles` ADD CONSTRAINT `teacher_profiles_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_profiles` ADD CONSTRAINT `teacher_profiles_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_reductions` ADD CONSTRAINT `teacher_reductions_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_reductions` ADD CONSTRAINT `teacher_reductions_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_reductions` ADD CONSTRAINT `teacher_reductions_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_skills` ADD CONSTRAINT `teacher_skills_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_skills` ADD CONSTRAINT `teacher_skills_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_skills` ADD CONSTRAINT `teacher_skills_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `availability` ADD CONSTRAINT `availability_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `availability` ADD CONSTRAINT `availability_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `availability_exceptions` ADD CONSTRAINT `availability_exceptions_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `availability_exceptions` ADD CONSTRAINT `availability_exceptions_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `spaces` ADD CONSTRAINT `spaces_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_versions` ADD CONSTRAINT `schedule_versions_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_versions` ADD CONSTRAINT `schedule_versions_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_versions` ADD CONSTRAINT `schedule_versions_published_by_fkey` FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_versions` ADD CONSTRAINT `schedule_versions_parent_version_id_fkey` FOREIGN KEY (`parent_version_id`) REFERENCES `schedule_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_schedule_version_id_fkey` FOREIGN KEY (`schedule_version_id`) REFERENCES `schedule_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_space_id_fkey` FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_requester_id_fkey` FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_target_user_id_fkey` FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_resolved_by_fkey` FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absences` ADD CONSTRAINT `absences_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absences` ADD CONSTRAINT `absences_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absences` ADD CONSTRAINT `absences_substitute_profile_id_fkey` FOREIGN KEY (`substitute_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_members` ADD CONSTRAINT `conversation_members_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_members` ADD CONSTRAINT `conversation_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_prefs` ADD CONSTRAINT `notification_prefs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_feed_tokens` ADD CONSTRAINT `calendar_feed_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_connections` ADD CONSTRAINT `calendar_connections_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_event_map` ADD CONSTRAINT `calendar_event_map_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `calendar_connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_event_map` ADD CONSTRAINT `calendar_event_map_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_busy_slots` ADD CONSTRAINT `external_busy_slots_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_busy_slots` ADD CONSTRAINT `external_busy_slots_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `calendar_connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_chunks` ADD CONSTRAINT `document_chunks_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_chunks` ADD CONSTRAINT `document_chunks_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `center_settings_versions` ADD CONSTRAINT `center_settings_versions_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `center_settings_versions` ADD CONSTRAINT `center_settings_versions_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `center_settings_versions` ADD CONSTRAINT `center_settings_versions_source_document_id_fkey` FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `center_settings_versions` ADD CONSTRAINT `center_settings_versions_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setting_extractions` ADD CONSTRAINT `setting_extractions_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setting_extractions` ADD CONSTRAINT `setting_extractions_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setting_extractions` ADD CONSTRAINT `setting_extractions_resolved_by_fkey` FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setting_provenance` ADD CONSTRAINT `setting_provenance_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setting_provenance` ADD CONSTRAINT `setting_provenance_settings_version_id_fkey` FOREIGN KEY (`settings_version_id`) REFERENCES `center_settings_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `setting_provenance` ADD CONSTRAINT `setting_provenance_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_interactions` ADD CONSTRAINT `ai_interactions_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_interactions` ADD CONSTRAINT `ai_interactions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_center_id_fkey` FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_versions` ADD CONSTRAINT `app_versions_applied_by_fkey` FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
