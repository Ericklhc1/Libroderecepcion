import {HandoverStatus} from '@prisma/client';
import type { HandoverCashState } from '@/server/services/cash';
import { fromMinor } from '@/domain/cash';
import { formatDateTime } from '@/lib/format';
import { handoverPrintRows, handoverPrintCounts } from '@/domain/handover-print';
import type { PrintItem } from '@/domain/handover-print';

export type HandoverPrintProps = {
  handoverStatus: HandoverStatus;
  title: string; participants: string; issuer: string; issuedAt: string;
  status: string; receiver: string | null; receivedAt: string | null;
  supervisor: string | null; items: PrintItem[]; cash: HandoverCashState;
  notes?: string | null; receiverObservations?: string | null;
};
const money = (minor: number | undefined, currency: string) => minor === undefined ? '—' : fromMinor(minor, currency).toLocaleString('es-CL');

function ItemTable({ title, rows }: { title: string; rows: ReturnType<typeof handoverPrintRows> }) {
  return <section className="handover-print-section">
    <h2>{title}</h2>
    <table className="handover-items-table"><thead><tr><th>Prio.</th><th>#</th><th>Título / detalle</th><th>Vence</th></tr></thead>
      <tbody>{rows.length ? rows.map((row, index) => <tr key={index}>
        <td>{row.priority}</td><td>{row.ref || '—'}</td>
        <td><strong>{row.title}</strong>{row.count > 1 ? ` (×${row.count})` : ''}{row.detail ? ` · ${row.detail}` : ''}</td>
        <td>{row.due || '—'}</td>
      </tr>) : <tr><td colSpan={4}>Sin pendientes.</td></tr>}</tbody>
    </table>
  </section>;
}

/** Print presentation of the same handover/custody records; no operational writes. */
export function HandoverPrint(props: HandoverPrintProps) {
  if(props.handoverStatus===HandoverStatus.BORRADOR)return null;
  const rows = handoverPrintRows(props.items);
  const counts = handoverPrintCounts(rows);
  const received=props.handoverStatus===HandoverStatus.RECIBIDA;
  const cash = {...props.cash,confirmed:received?props.cash.confirmed:null,discrepancies:received?props.cash.discrepancies:[]};
  const receiver=received?props.receiver:null;
  const guaranteeCount = props.handoverStatus===HandoverStatus.RECIBIDA ? cash.confirmed ?? cash.declared : cash.declared ?? cash.confirmed;
  const guaranteesUnavailable=!guaranteeCount?.guaranteeSnapshotRecorded;
  const guarantees = guaranteeCount?.guaranteeSnapshotRecorded ? guaranteeCount.validatedGuarantees.map(g => ({
    ...g, humanId:g.humanId, amount:fromMinor(g.amountMinor,g.currency), dueAt:g.dueAt ? new Date(g.dueAt) : null,
  })) : [];
  const currencies = [...new Set(['CLP', 'USD', ...(cash.declared?.statuses ?? []).map(s => s.currency), ...(cash.confirmed?.statuses ?? []).map(s => s.currency)])];
  return <article className="handover-print" aria-label="Entrega de turno para imprimir">
    <header className="handover-print-header">
      <strong>{props.title}</strong>
      <span>Entregan: {props.participants} · Emitida por {props.issuer}, {props.issuedAt}</span>
      <span>{props.status} · {receiver ? `Receptor confirmado: ${receiver}, ${props.receivedAt ?? ''}` : 'Sin receptor confirmado'}</span>
      <span className="handover-print-counts">Urgente {counts.urgente} · Importante {counts.importante} · Informativo {counts.informativo}</span>
    </header>
    <div className="handover-print-grid">
      <section><h2>Caja del turno · entrega vs recibe</h2>
        {cash.declared ? <p>Entrega #{cash.declared.humanId} · {cash.declared.countedByName} · {formatDateTime(cash.declared.countedAt)}</p> : null}
        <table><thead><tr><th></th><th colSpan={3}>Entrega (declarado)</th><th colSpan={2}>Recibe (confirmado)</th></tr>
          <tr><th></th><th>Contado</th><th>Esperado</th><th>Dif.</th><th>Contado</th><th>Dif.</th></tr></thead>
          <tbody>{currencies.map(currency => {
            const declared = cash.declared?.statuses.find(s => s.currency === currency);
            const confirmed = cash.confirmed?.statuses.find(s => s.currency === currency);
            return <tr key={currency}><th>{currency}</th><td>{money(declared?.countedMinor, currency)}</td><td>{money(declared?.expectedMinor, currency)}</td><td>{declared?.balanced ? 'Cuadra' : money(declared?.differenceMinor, currency)}</td><td>{confirmed ? money(confirmed.countedMinor, currency) : 'Sin confirmar'}</td><td>{confirmed?.balanced ? 'Cuadra' : money(confirmed?.differenceMinor, currency)}</td></tr>;
          })}</tbody></table>
        {([['Entrega',cash.declared], ['Recibe',cash.confirmed]] as const).flatMap(([label,count]) => (count?.statuses??[]).filter(s=>!s.balanced).map(s=><p key={`${label}-${s.currency}`}>{label}: diferencia contado − esperado {s.currency} {money(s.differenceMinor,s.currency)}.</p>))}
        {cash.discrepancies.filter(d => d.differenceMinor !== 0).map(d => <p key={d.currency}>Diferencia recibe − entrega: {d.currency} {money(d.differenceMinor, d.currency)}.</p>)}
        {cash.declared?.notes ? <p>Entrega: {cash.declared.notes}</p> : null}
        {cash.confirmed?.notes ? <p>Recibe: {cash.confirmed.notes}</p> : null}
      </section>
      <section><h2>Garantías en efectivo bajo custodia</h2>
        <table><thead><tr><th>Huésped</th><th>Hab.</th><th>ID</th><th>Objetivo</th><th>Monto</th></tr></thead>
          <tbody>{guarantees.length ? guarantees.map(g => <tr key={g.id}><td>{g.guestName ?? '—'}</td><td>{g.roomNumber ?? '—'}</td><td>{g.reference ?? (g.humanId ? `#${g.humanId}` : g.id)}</td><td>{g.dueAt ? formatDateTime(g.dueAt) : '—'}</td><td>{g.currency} {g.amount.toLocaleString('es-CL')}</td></tr>) : <tr><td colSpan={5}>{guaranteesUnavailable?'Fotografía histórica de garantías no disponible.':'Sin garantías en efectivo.'}</td></tr>}</tbody>
        </table>
      </section>
      <section><h2>Elementos físicos</h2>
        <table><thead><tr><th>Elemento</th><th>Declarado</th><th>Confirmado</th></tr></thead>
          <tbody>{cash.elements.map(e => <tr key={e.id}><td>{e.name}{received&&e.notes ? ` · ${e.notes}` : ''}{received&&e.missingReason ? ` · ${e.missingReason}` : ''}</td><td>{e.declared ? 'Sí' : 'No'}</td><td>{received&&e.confirmed ? 'Sí' : 'Sin confirmar'}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
    <ItemTable title="Novedades activas" rows={rows.filter(r => r.refType !== 'alert')} />
    <ItemTable title="Alertas operativas" rows={rows.filter(r => r.refType === 'alert')} />
    {props.notes ? <p>Nota de entrega: {props.notes}</p> : null}
    {received&&props.receiverObservations ? <p>Observaciones de recepción: {props.receiverObservations}</p> : null}
    <div className="handover-print-signatures">{[
      ['Entrega', props.issuer], ['Recibe', receiver], ['Supervisión', props.supervisor],
    ].map(([label, name]) => <section key={label}><strong>{label}</strong><p>Nombre: {name ?? '________________________'}</p><p>Firma: ______________________________</p><p>Fecha / hora: ________________________</p></section>)}</div>
  </article>;
}
