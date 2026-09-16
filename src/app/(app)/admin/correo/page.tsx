import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Info, XCircle } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { getMailConfigView } from '@/server/services/mail-settings';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MailForm, MailTestForm } from '@/components/admin/mail-form';
import { formatDateTime } from '@/lib/format';
import type { InboundProtocolValue } from '@/domain/mail-config';

export const metadata = { title: 'Correo' };
export const dynamic = 'force-dynamic';

const SOURCE_LABELS = {
  base: 'Configurado desde esta consola',
  entorno: 'Configurado por variables de entorno',
  'sin-configurar': 'Sin configurar',
} as const;

export default async function MailConfigPage() {
  await requirePagePermission('system.configure');
  const config = await getMailConfigView();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Correo del hotel</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Servidor de salida, casilla y credenciales. Se puede cambiar sin desplegar: la clave se
          guarda cifrada y la llave de cifrado sigue viviendo en el servidor, nunca en la base.
        </p>
      </header>

      <Card>
        <CardHeader title="Estado" />
        <div className="space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {config.canSend ? (
              <Badge tone="resuelto">El envío está operativo</Badge>
            ) : (
              <Badge tone="pendiente">No se puede enviar</Badge>
            )}
            <span className="text-sm text-slate-600">{SOURCE_LABELS[config.source]}</span>
          </div>

          {!config.canSend ? (
            <p className="text-sm text-slate-600">
              Mientras falte, al crear un usuario la clave temporal se muestra en pantalla en vez de
              enviarse por correo, y el sistema lo dice en lugar de callarse.
            </p>
          ) : null}

          {/*
            Si el entorno también tiene SMTP, hay que decir cuál gana. Callarlo
            es cómo alguien cambia el servidor, ve «guardado» y no entiende por
            qué los correos siguen saliendo por otro lado.
          */}
          {config.envIsShadowed ? (
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                También hay variables <code>SMTP_*</code> en el servidor, pero{' '}
                <strong>manda lo de esta pantalla</strong>. Si quieres volver al entorno, vacía el
                servidor de salida de acá.
              </span>
            </p>
          ) : null}

          {config.source === 'entorno' ? (
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Lo que se está usando viene de las variables del servidor. Si escribes la
                configuración acá, pasa a mandar esta pantalla.
              </span>
            </p>
          ) : null}

          {config.lastTestAt ? (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="flex items-start gap-2 text-sm">
                {config.lastTestOk ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                )}
                <span className="text-petrol-900">
                  <strong>
                    Última prueba{config.lastTestOk ? ' correcta' : ' fallida'}
                  </strong>{' '}
                  · {formatDateTime(config.lastTestAt)}
                  {config.lastTestTo ? ` · a ${config.lastTestTo}` : ''}
                </span>
              </p>
              {config.lastTestDetail ? (
                <p className="mt-1 break-words text-xs text-slate-600">{config.lastTestDetail}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Todavía no se ha enviado ninguna prueba desde esta pantalla.
            </p>
          )}

          {config.updatedAt ? (
            <p className="text-xs text-slate-500">
              Última modificación: {formatDateTime(config.updatedAt)}
              {config.updatedByName ? ` · ${config.updatedByName}` : ''}
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Configuración" />
        <div className="px-4 py-4">
          <MailForm
            values={{
              smtpHost: config.smtpHost,
              smtpPort: config.smtpPort,
              smtpUser: config.smtpUser,
              mailFrom: config.mailFrom,
              credentialsMailTo: config.credentialsMailTo,
              inboundProtocol: config.inboundProtocol as InboundProtocolValue | null,
              inboundHost: config.inboundHost,
              inboundPort: config.inboundPort,
              inboundUser: config.inboundUser,
              hasSmtpPassword: config.hasSmtpPassword,
              hasInboundPassword: config.hasInboundPassword,
              smtpPasswordUnreadable: config.smtpPasswordUnreadable,
              inboundPasswordUnreadable: config.inboundPasswordUnreadable,
            }}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Probar el envío" />
        <div className="space-y-3 px-4 py-4">
          <p className="text-sm text-slate-600">
            Configurar el correo a ciegas es cómo se llega a un sistema que no avisa de nada. El
            error del servidor se muestra tal cual: es lo único que dice qué corregir.
          </p>
          <MailTestForm defaultTo={config.credentialsMailTo} />
        </div>
      </Card>
    </div>
  );
}
