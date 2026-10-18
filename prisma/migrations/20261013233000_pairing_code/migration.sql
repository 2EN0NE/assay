-- ADR-0035：一次性配对码（网页的第二扇门）。
--
-- 只是新增一张表、不动任何已有行：没有回填，也没有收紧既有约束。
-- （`scripts/verify-migration-upgrade.ts` 只在**动老数据**时才需要补检查，见 AGENTS.md。）
--
-- 只存哈希（`codeHash`）：明文只在签发那一刻打印给持有凭据的一方。库泄漏时
-- 读不出可用的码；码本身 10 分钟过期且一次有效，因此也不需要第二个秘密。
CREATE TABLE "PairingCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "PairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PairingCode_codeHash_key" ON "PairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "PairingCode_userId_idx" ON "PairingCode"("userId");

-- AddForeignKey
ALTER TABLE "PairingCode" ADD CONSTRAINT "PairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
