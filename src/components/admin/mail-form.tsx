'use client';

import { useState } from 'react';
import { ShieldAlert, TriangleAlert } from 'lucide-react';
import { ActionForm, Checkbox, Field, Input, Select } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { saveMailConfigAction, sendMailTestAction } from '@/server/actions/mail';
import {
  INBOUND_PORT_HINTS,
  INBOUND_PROTOCOL_LABELS,
  SMTP_PORT_HINTS,
  mailConfigWarnings,
  smtpIsImplicitTls,
  type InboundProtocolValue,
} from '@/domain/mail-config';

export type MailFormValues = {
  smtpHost: string;
  smtpPort: number | null;
  smtpUser: string;
  mailFrom: string;
  credentialsMailTo: string;
  inboundProtocol: InboundProtocolValue | null;
  inboundHost: string;
  inboundPort: number | null;
  inboundUser: string;
  hasSmtpPassword: boolean;
  hasInboundPassword: boolean;
  smtpPasswordUnreadable: boolean;
  inboundPasswordUnreadable: boolean;
};

/**
 * Formulario de correo.
 *
 * Dos decisiones de interfaz que no son cosméticas:
 *
 * 1. **La clave guardada no se muestra ni se devuelve.** El campo va vacío y
 *    al lado dice si hay una guardada. Dejarlo vacío conserva la que está;
 *    para quitarla hay una casilla explícita. Un formulario que rellena el
 *    campo con el secreto lo deja en el código de la página y en el historial
 *    del navegador.
 * 2. **Los avisos se calculan mientras se escribe**, con la misma función del
 *    dominio que usa el servidor. No bloquean —el hotel puede tener el correo
 *    donde quiera— pero el que importa aparece antes de guardar: el par
 *    «IMAP + 995» no funciona y el error del servidor no lo explica.
 */
export function MailForm({ values }: { values: MailFormValues }) {
  const [smtpPort, setSmtpPort] = useState(values.smtpPort ? String(values.smtpPort) : '');
  const [inboundPort, setInboundPort] = useState(
    values.inboundPort ? String(values.inboundPort) : '',
  );
  const [inboundProtocol, setInboundProtocol] = useState<string>(values.inboundProtocol ?? '');
  const [replaceSmtpPassword, setReplaceSmtpPassword] = useState(!values.hasSmtpPassword);
  const [replaceInboundPassword, setReplaceInboundPassword] = useState(
    !values.hasInboundPassword,
  );

  const smtpPortNumber = Number(smtpPort);
  const inboundPortNumber = Number(inboundPort);

  // La misma función que valida en el servidor, para que no puedan discrepar.
  const warnings = mailConfigWarnings({
    smtpPort: Number.isFinite(smtpPortNumber) && smtpPort ? smtpPortNumber : null,
    inboundPort: Number.isFinite(inboundPortNumber) && inboundPort ? inboundPortNumber : null,
    inboundProtocol: (inboundProtocol || null) as InboundProtocolValue | null,
  });

  const smtpHint = smtpPort ? SMTP_PORT_HINTS[smtpPortNumber] : undefined;
  const inboundHint = inboundPort ? INBOUND_PORT_HINTS[inboundPortNumber] : undefined;

  return (
    <ActionForm action={saveMailConfigAction} className="space-y-6" refreshOnSuccess>
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-petrol-900">Salida (SMTP)</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Es lo único que el sistema usa hoy: enviar las credenciales de un usuario nuevo a la
            casilla de recepción.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="Servidor de salida" name="smtpHost">
            <Input
              name="smtpHost"
              defaultValue={values.smtpHost}
              maxLength={200}
              placeholder="mail.hoteleshw.com"
              autoComplete="off"
            />
          </Field>
          <Field
            label="Puerto"
            name="smtpPort"
            hint={smtpHint ?? 'Lo habitual es 465 (TLS directo) o 587 (STARTTLS).'}
          >
            <Input
              name="smtpPort"
              type="number"
              min={1}
              max={65535}
              value={smtpPort}
              onChange={(event) => setSmtpPort(event.target.value)}
              className="tabular"
            />
          </Field>
        </div>

        {smtpPort && Number.isFinite(smtpPortNumber) ? (
          <p className="text-xs text-slate-500">
            Cifrado:{' '}
            <strong className="text-petrol-800">
              {smtpIsImplicitTls(smtpPortNumber)
                ? 'TLS directo desde el primer byte'
                : 'STARTTLS (la conexión empieza en claro y se cifra después)'}
            </strong>
            . Lo decide el puerto, no una casilla aparte.
          </p>
        ) : null}

        <Field label="Usuario del buzón" name="smtpUser" hint="Vacío si el servidor no pide autenticación.">
          <Input
            name="smtpUser"
            defaultValue={values.smtpUser}
            maxLength={200}
            placeholder="recepcion@hoteleshw.com"
            autoComplete="off"
          />
        </Field>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          {values.hasSmtpPassword ? (
            values.smtpPasswordUnreadable ? (
              <p className="flex items-start gap-2 text-sm text-red-700">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Hay una clave guardada pero <strong>ya no se puede descifrar</strong>: cambió la
                  llave del servidor (<code>AUTH_SECRET</code>). Escríbela de nuevo.
                </span>
              </p>
            ) : (
              <p className="text-sm text-slate-700">
                Hay una clave guardada y cifrada. No se muestra ni se puede recuperar desde acá.
              </p>
            )
          ) : (
            <p className="text-sm text-slate-700">No hay clave guardada.</p>
          )}

          {values.hasSmtpPassword ? (
            <div className="mt-2 space-y-2">
              <Checkbox
                label="Reemplazar la clave"
                checked={replaceSmtpPassword}
                onChange={(event) => setReplaceSmtpPassword(event.target.checked)}
              />
              <Checkbox
                name="clearSmtpPassword"
                value="true"
                label="Quitar la clave (el servidor pasará a conectarse sin autenticación)"
              />
            </div>
          ) : null}

          {replaceSmtpPassword ? (
            <div className="mt-3">
              <Field
                label="Clave del buzón de salida"
                name="smtpPassword"
                hint="Se guarda cifrada. Déjala vacía para conservar la actual."
              >
                <Input
                  name="smtpPassword"
                  type="password"
                  maxLength={200}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          ) : null}
        </div>

        <Field
          label="Remitente"
          name="mailFrom"
          hint="Con nombre o sin él: Libro Operativo <recepcion@hoteleshw.com>."
        >
          <Input
            name="mailFrom"
            defaultValue={values.mailFrom}
            maxLength={200}
            placeholder="Libro Operativo <recepcion@hoteleshw.com>"
            autoComplete="off"
          />
        </Field>

        <Field
          label="Casilla que recibe las credenciales"
          name="credentialsMailTo"
          hint="A donde llega la clave temporal de cada usuario nuevo."
        >
          <Input
            name="credentialsMailTo"
            type="email"
            defaultValue={values.credentialsMailTo}
            maxLength={200}
            autoComplete="off"
          />
        </Field>
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-5">
        <div>
          <h2 className="text-base font-semibold text-petrol-900">Entrada (IMAP o POP3)</h2>
          {/*
            Honestidad por delante: hoy no hay nada que lea la casilla. Dejar
            que parezca que sí sería peor que no ofrecer el formulario.
          */}
          <p className="mt-0.5 text-sm text-slate-600">
            <strong>El sistema todavía no lee la casilla</strong>: sólo envía. Lo que escribas acá
            queda guardado y cifrado para cuando exista la lectura, y de paso el sistema revisa que
            el protocolo y el puerto se correspondan.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Protocolo" name="inboundProtocol">
            <Select
              name="inboundProtocol"
              value={inboundProtocol}
              onChange={(event) => setInboundProtocol(event.target.value)}
              placeholder="Sin configurar"
              options={Object.entries(INBOUND_PROTOCOL_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Field>
          <Field label="Puerto" name="inboundPort" hint={inboundHint}>
            <Input
              name="inboundPort"
              type="number"
              min={1}
              max={65535}
              value={inboundPort}
              onChange={(event) => setInboundPort(event.target.value)}
              className="tabular"
            />
          </Field>
        </div>

        <Field label="Servidor de entrada" name="inboundHost">
          <Input
            name="inboundHost"
            defaultValue={values.inboundHost}
            maxLength={200}
            placeholder="mail.hoteleshw.com"
            autoComplete="off"
          />
        </Field>

        <Field label="Usuario del buzón" name="inboundUser">
          <Input
            name="inboundUser"
            defaultValue={values.inboundUser}
            maxLength={200}
            autoComplete="off"
          />
        </Field>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          {values.hasInboundPassword ? (
            <p className="text-sm text-slate-700">
              {values.inboundPasswordUnreadable
                ? 'Hay una clave guardada que ya no se puede descifrar. Escríbela de nuevo.'
                : 'Hay una clave guardada y cifrada.'}
            </p>
          ) : (
            <p className="text-sm text-slate-700">No hay clave guardada.</p>
          )}

          {values.hasInboundPassword ? (
            <div className="mt-2 space-y-2">
              <Checkbox
                label="Reemplazar la clave"
                checked={replaceInboundPassword}
                onChange={(event) => setReplaceInboundPassword(event.target.checked)}
              />
              <Checkbox
                name="clearInboundPassword"
                value="true"
                label="Quitar la clave de entrada"
              />
            </div>
          ) : null}

          {replaceInboundPassword ? (
            <div className="mt-3">
              <Field
                label="Clave del buzón de entrada"
                name="inboundPassword"
                hint="Se guarda cifrada. Déjala vacía para conservar la actual."
              >
                <Input
                  name="inboundPassword"
                  type="password"
                  maxLength={200}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          ) : null}
        </div>
      </section>

      {warnings.length > 0 ? (
        <ul className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          {warnings.map((warning) => (
            <li key={warning.field} className="flex items-start gap-2 text-sm text-amber-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <SubmitButton pendingLabel="Guardando…">Guardar la configuración</SubmitButton>
    </ActionForm>
  );
}

/**
 * Envío de prueba.
 *
 * Va en su propio formulario: guardar y probar son dos gestos y se hacen en ese
 * orden. Probar sin haber guardado usaría la configuración anterior y diría que
 * funciona lo que no se ha escrito todavía.
 */
export function MailTestForm({ defaultTo }: { defaultTo: string }) {
  return (
    <ActionForm action={sendMailTestAction} refreshOnSuccess>
      <Field
        label="Enviar una prueba a"
        name="to"
        required
        hint="Guarda primero: la prueba usa la configuración que está guardada."
      >
        <Input name="to" type="email" required defaultValue={defaultTo} maxLength={200} />
      </Field>
      <SubmitButton variant="secondary" pendingLabel="Enviando…">
        Enviar correo de prueba
      </SubmitButton>
    </ActionForm>
  );
}
