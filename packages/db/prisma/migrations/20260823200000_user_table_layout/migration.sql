-- Which columns each person has hidden, per listing.
ALTER TABLE `users` ADD COLUMN `table_layout_json` JSON NULL;
