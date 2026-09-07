-- Why an update failed, kept beside the attempt that failed. Until now the
-- reason lived only in a log file on the server, and the panel could say no
-- more than "it did not work".
ALTER TABLE `app_versions` ADD COLUMN `detail` TEXT NULL;
