-- AlterTable
ALTER TABLE `groups` ADD COLUMN `required_equipment_json` JSON NULL;

-- AlterTable
ALTER TABLE `schedule_versions` ADD COLUMN `snapshot_json` JSON NULL;
