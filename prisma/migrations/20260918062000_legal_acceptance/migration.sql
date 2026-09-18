CREATE TABLE "LegalAcceptance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "document" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT,
  "userAgent" TEXT,

  CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalAcceptance_userId_document_version_key"
  ON "LegalAcceptance"("userId", "document", "version");

CREATE INDEX "LegalAcceptance_document_version_idx"
  ON "LegalAcceptance"("document", "version");

CREATE INDEX "LegalAcceptance_acceptedAt_idx"
  ON "LegalAcceptance"("acceptedAt");

ALTER TABLE "LegalAcceptance"
  ADD CONSTRAINT "LegalAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
