/*
  Warnings:

  - You are about to alter the column `title` on the `group` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(150)`.
  - The primary key for the `user` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `userId` on the `user` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(36)`.
  - You are about to alter the column `name` on the `user` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(150)`.
  - The primary key for the `usergroup` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `userId` on the `usergroup` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(36)`.
  - You are about to alter the column `groupId` on the `usergroup` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(36)`.
  - The primary key for the `usergroupinvitation` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `userId` on the `usergroupinvitation` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(36)`.
  - You are about to alter the column `groupId` on the `usergroupinvitation` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(36)`.

*/
-- AlterTable
ALTER TABLE `group` MODIFY `title` VARCHAR(150) NOT NULL,
    MODIFY `iconUrl` TEXT NULL;

-- AlterTable
ALTER TABLE `user` DROP PRIMARY KEY,
    MODIFY `userId` VARCHAR(36) NOT NULL,
    MODIFY `iconUrl` TEXT NULL,
    MODIFY `name` VARCHAR(150) NOT NULL,
    ADD PRIMARY KEY (`userId`);

-- AlterTable
ALTER TABLE `usergroup` DROP PRIMARY KEY,
    MODIFY `userId` VARCHAR(36) NOT NULL,
    MODIFY `groupId` VARCHAR(36) NOT NULL,
    ADD PRIMARY KEY (`userId`, `groupId`);

-- AlterTable
ALTER TABLE `usergroupinvitation` DROP PRIMARY KEY,
    MODIFY `userId` VARCHAR(36) NOT NULL,
    MODIFY `groupId` VARCHAR(36) NOT NULL,
    ADD PRIMARY KEY (`userId`, `groupId`);
