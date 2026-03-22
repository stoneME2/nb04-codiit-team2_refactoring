-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT IF EXISTS "refresh_tokens_userId_fkey";

-- DropTable
DROP TABLE IF EXISTS "refresh_tokens";
