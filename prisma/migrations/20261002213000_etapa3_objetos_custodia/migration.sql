-- Etapa 3 / Bloque 2: objetos olvidados y custodia. Migración aditiva.
CREATE TABLE "LostFoundItem" (
  "id" TEXT NOT NULL,
  "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass),
  "requestKey" TEXT NOT NULL,
  "item" TEXT NOT NULL,
  "foundLocation" TEXT NOT NULL,
  "foundAt" TIMESTAMP(3) NOT NULL,
  "custodyLocation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'EN_CUSTODIA',
  "registeredById" TEXT NOT NULL,
  "custodianId" TEXT,
  "finalAction" TEXT,
  "evidenceNote" TEXT,
  "closedById" TEXT,
  "closedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LostFoundItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LostFoundEvent" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LostFoundEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LostFoundItem_humanId_key" ON "LostFoundItem"("humanId");
CREATE UNIQUE INDEX "LostFoundItem_requestKey_key" ON "LostFoundItem"("requestKey");
CREATE INDEX "LostFoundItem_status_foundAt_idx" ON "LostFoundItem"("status","foundAt");
CREATE INDEX "LostFoundItem_custodianId_status_idx" ON "LostFoundItem"("custodianId","status");
CREATE INDEX "LostFoundEvent_itemId_createdAt_idx" ON "LostFoundEvent"("itemId","createdAt");
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LostFoundEvent" ADD CONSTRAINT "LostFoundEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LostFoundItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LostFoundEvent" ADD CONSTRAINT "LostFoundEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id","key","name","group","createdAt") VALUES
 ('perm-custody-view','custody.view','Consultar objetos olvidados y su custodia','Objetos olvidados',CURRENT_TIMESTAMP),
 ('perm-custody-manage','custody.manage','Registrar y actualizar objetos olvidados y su custodia','Objetos olvidados',CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "name"=EXCLUDED."name","group"=EXCLUDED."group";
INSERT INTO "RolePermission" ("roleId","permissionId","grantedAt")
SELECT r."id",p."id",CURRENT_TIMESTAMP FROM "Role" r CROSS JOIN "Permission" p
WHERE p."key" IN ('custody.view','custody.manage') AND r."key" IN ('ADMINISTRADOR_SISTEMA','SUPERVISOR','RECEPCIONISTA','AUDITOR_NOCTURNO')
ON CONFLICT ("roleId","permissionId") DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId","grantedAt")
SELECT r."id",p."id",CURRENT_TIMESTAMP FROM "Role" r CROSS JOIN "Permission" p
WHERE p."key"='custody.view' AND r."key"='GERENCIA'
ON CONFLICT ("roleId","permissionId") DO NOTHING;
