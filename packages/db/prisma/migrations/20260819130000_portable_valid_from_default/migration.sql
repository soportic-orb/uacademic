-- `DEFAULT CURRENT_TIMESTAMP` on a DATE column is refused outright by MySQL 8
-- and quietly accepted by MariaDB, so the very first migration could never run
-- on the engine the deployment manual names — and an installation created on
-- MariaDB before this carries a definition that no MySQL would restore.
--
-- `(CURRENT_DATE)` is the expression form both engines accept: MySQL since
-- 8.0.13, MariaDB since 10.2. MODIFY rather than ALTER … SET DEFAULT because
-- it rewrites the whole definition, so the column ends up identical to the one
-- a fresh install gets.
ALTER TABLE `user_center_roles`
  MODIFY COLUMN `valid_from` DATE NOT NULL DEFAULT (CURRENT_DATE);
