-- AlterTable
ALTER TABLE "User" ADD COLUMN     "age" INTEGER,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "language" TEXT DEFAULT 'en',
ADD COLUMN     "lastName" TEXT;
