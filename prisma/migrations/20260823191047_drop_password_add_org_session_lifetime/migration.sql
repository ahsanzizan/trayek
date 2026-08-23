/*
  Warnings:

  - You are about to drop the column `password` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "sessionIdleTimeoutSeconds" INTEGER,
ADD COLUMN     "sessionMaxAgeSeconds" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "password";
