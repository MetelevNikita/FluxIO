CREATE TABLE "WorkspaceSession" (
    "id" UUID NOT NULL,
    "slot" TEXT NOT NULL DEFAULT 'last',
    "snapshot" JSONB NOT NULL,
    "checkpoint" JSONB,
    "encryptedSecrets" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSession_slot_key" ON "WorkspaceSession"("slot");
CREATE INDEX "WorkspaceSession_updatedAt_idx" ON "WorkspaceSession"("updatedAt");
