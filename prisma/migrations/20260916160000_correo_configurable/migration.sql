-- Configuración de correo editable desde la consola del administrador.
--
-- Aditiva: una tabla nueva y un enum nuevo. No toca ninguna columna existente.
-- Mientras la fila no exista, el correo sigue resolviéndose por variables de
-- entorno y el sistema se comporta exactamente como antes.
--
-- La clave del buzón se guarda CIFRADA (AES-256-GCM); la llave de cifrado se
-- deriva de AUTH_SECRET y sigue viviendo en el entorno, así que esta tabla no
-- contiene por sí sola lo necesario para leerla.

CREATE TYPE "MailInboundProtocol" AS ENUM ('IMAP', 'POP3');

CREATE TABLE "MailSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPasswordEnc" TEXT,
    "mailFrom" TEXT,
    "credentialsMailTo" TEXT,
    "inboundProtocol" "MailInboundProtocol",
    "inboundHost" TEXT,
    "inboundPort" INTEGER,
    "inboundUser" TEXT,
    "inboundPasswordEnc" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestDetail" TEXT,
    "lastTestTo" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MailSettings" ADD CONSTRAINT "MailSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
