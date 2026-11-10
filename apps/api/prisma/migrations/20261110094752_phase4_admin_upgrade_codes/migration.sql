-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UpgradeCodeStatus" AS ENUM ('UNUSED', 'REDEEMED', 'REVOKED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "upgrade_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "plan_code" "PlanCode" NOT NULL DEFAULT 'PROFESSIONAL',
    "months" INTEGER NOT NULL,
    "status" "UpgradeCodeStatus" NOT NULL DEFAULT 'UNUSED',
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_by_id" UUID,
    "redeemed_at" TIMESTAMP(3),
    "payment_id" UUID,

    CONSTRAINT "upgrade_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upgrade_codes_code_key" ON "upgrade_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "upgrade_codes_payment_id_key" ON "upgrade_codes"("payment_id");

-- CreateIndex
CREATE INDEX "upgrade_codes_status_created_at_idx" ON "upgrade_codes"("status", "created_at");

-- AddForeignKey
ALTER TABLE "upgrade_codes" ADD CONSTRAINT "upgrade_codes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upgrade_codes" ADD CONSTRAINT "upgrade_codes_redeemed_by_id_fkey" FOREIGN KEY ("redeemed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upgrade_codes" ADD CONSTRAINT "upgrade_codes_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
