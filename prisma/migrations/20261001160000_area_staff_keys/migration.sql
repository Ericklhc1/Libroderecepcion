-- AlterEnum
ALTER TYPE "KeyStatus" ADD VALUE 'ENTREGADA_PERSONAL';

-- AlterTable
ALTER TABLE "RoomKey" ADD COLUMN     "areaId" TEXT;

-- AlterTable
ALTER TABLE "KeyInventoryCount" ADD COLUMN     "areasSnapshot" JSONB,
ADD COLUMN     "staffCustodySnapshot" JSONB;

-- CreateTable
CREATE TABLE "KeyArea" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorKey" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "notes" TEXT,
    "status" "KeyStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupervisorKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorKeyMovement" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisorKeyMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyStaffLoan" (
    "id" TEXT NOT NULL,
    "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass),
    "requestKey" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "departmentName" TEXT NOT NULL,
    "collaboratorId" TEXT,
    "collaboratorName" TEXT,
    "authorizedById" TEXT NOT NULL,
    "authorizedByName" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyStaffLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyStaffLoanItem" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "roomKeyId" TEXT,
    "supervisorKeyId" TEXT,
    "keyCode" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "destinationKind" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "returnedById" TEXT,
    "returnNote" TEXT,

    CONSTRAINT "KeyStaffLoanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KeyArea_name_key" ON "KeyArea"("name");

-- CreateIndex
CREATE INDEX "SupervisorKey_ownerId_status_idx" ON "SupervisorKey"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisorKey_ownerId_code_key" ON "SupervisorKey"("ownerId", "code");

-- CreateIndex
CREATE INDEX "SupervisorKeyMovement_keyId_at_idx" ON "SupervisorKeyMovement"("keyId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "KeyStaffLoan_humanId_key" ON "KeyStaffLoan"("humanId");

-- CreateIndex
CREATE UNIQUE INDEX "KeyStaffLoan_requestKey_key" ON "KeyStaffLoan"("requestKey");

-- CreateIndex
CREATE INDEX "KeyStaffLoan_createdAt_idx" ON "KeyStaffLoan"("createdAt");

-- CreateIndex
CREATE INDEX "KeyStaffLoanItem_loanId_idx" ON "KeyStaffLoanItem"("loanId");

-- CreateIndex
CREATE INDEX "KeyStaffLoanItem_destinationId_returnedAt_idx" ON "KeyStaffLoanItem"("destinationId", "returnedAt");

-- AddForeignKey
ALTER TABLE "RoomKey" ADD CONSTRAINT "RoomKey_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "KeyArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorKeyMovement" ADD CONSTRAINT "SupervisorKeyMovement_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "SupervisorKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyStaffLoanItem" ADD CONSTRAINT "KeyStaffLoanItem_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "KeyStaffLoan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyStaffLoanItem" ADD CONSTRAINT "KeyStaffLoanItem_roomKeyId_fkey" FOREIGN KEY ("roomKeyId") REFERENCES "RoomKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyStaffLoanItem" ADD CONSTRAINT "KeyStaffLoanItem_supervisorKeyId_fkey" FOREIGN KEY ("supervisorKeyId") REFERENCES "SupervisorKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Una llave física solo puede tener una custodia abierta, incluso con concurrencia.
CREATE UNIQUE INDEX "KeyStaffLoanItem_active_public" ON "KeyStaffLoanItem" ("roomKeyId") WHERE "returnedAt" IS NULL;
CREATE UNIQUE INDEX "KeyStaffLoanItem_active_private" ON "KeyStaffLoanItem" ("supervisorKeyId") WHERE "returnedAt" IS NULL;
ALTER TABLE "KeyStaffLoanItem" ADD CONSTRAINT "KeyStaffLoanItem_one_source" CHECK (("roomKeyId" IS NOT NULL)::int + ("supervisorKeyId" IS NOT NULL)::int = 1);
ALTER TABLE "KeyStaffLoanItem" ADD CONSTRAINT "KeyStaffLoanItem_destination_kind" CHECK ("destinationKind" IN ('ROOM', 'AREA'));
ALTER TABLE "RoomKey" ADD CONSTRAINT "RoomKey_one_destination" CHECK ("roomId" IS NULL OR "areaId" IS NULL);

CREATE UNIQUE INDEX "KeyArea_name_insensitive" ON "KeyArea" (lower("name"));
