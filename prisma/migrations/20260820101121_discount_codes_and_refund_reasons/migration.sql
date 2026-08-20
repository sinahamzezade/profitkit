-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discountCodes" TEXT[];

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "note" TEXT,
ADD COLUMN     "reason" TEXT;
