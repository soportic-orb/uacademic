-- Hours somebody set themselves, which nothing else about the class may move.
--
-- Choosing a kind of class applies the length that kind usually lasts, and it
-- was doing so on classes a coordinator had already fitted to their real hours.
ALTER TABLE `sessions` ADD COLUMN `hours_pinned` BOOLEAN NOT NULL DEFAULT false;
