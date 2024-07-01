/*
  Warnings:

  - Added the required column `category` to the `Items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `condition` to the `Items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `description` to the `Items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `electric_user_id` to the `Items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `price` to the `Items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `timestamp` to the `Items` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE public."Items" ADD COLUMN     "category" TEXT NOT NULL,
ADD COLUMN     "condition" TEXT NOT NULL,
ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "electric_user_id" TEXT NOT NULL,
ADD COLUMN     "price" INTEGER NOT NULL,
ADD COLUMN     "timestamp" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "Items_timestamp_idx" ON public."Items" ("timestamp");
