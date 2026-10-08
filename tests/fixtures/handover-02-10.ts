import type { HandoverPrintProps } from '@/components/operational/handover-print';
import { fundStatuses, toMinor } from '@/domain/cash';

// Same 11 notices + operational alert, 3 guarantees and 4 elements as the
// approved cierre-02-10-compacto.pdf. Names anonymized; no production access.
const notices = [
  ['URGENTE', '1431', 'Reserva grupal — ID 7546567', 'Ingresada vía booking; Hab. 526 continúa su estadía, sería C/O-C/I mañana 03-10. Luego compartirá la reserva con la persona de la siguiente reserva (IN 03/10 al 05/10) manteniendo su habitación. Mañana harían ingreso el resto (texto truncado en origen).', ''],
  ['URGENTE', '1424', 'Habitaciones con cambio de estructura MAT a TWIN', '508, 511, 512, 513, 514 y 515 pasan de MATRIMONIAL a TWIN hasta el 05-10-26, como excepción por necesidad del hotel.', '05-10-26 11:00'],
  ['URGENTE', '1314', 'FIRMA DE TURNOS', 'Turnos autorizados por gerencia en el cajón N°2 para su firma. Firmar e informar a los asistentes de servicio. Plazo viernes 2-10-2026.', '02-10-26 07:30'],
  ['IMPORTANTE', '1435', 'Enviar cierre de turno completo con toda la documentación', 'Enviar cierre de turno completo con toda la documentación y el sobre de depósito corcheteado, amarrar con elástico y meter al cofre, siempre al finalizar cada turno. Instrucción de jefatura.', '02-12-27 19:38'],
  ['IMPORTANTE', '1432', 'Reserva grupal Hijos del Sol, Hab. 504 principal — ID 7545410', 'Se tomaron varias reservas; la principal (504) fue C/O-C/I, lo volverá a ser mañana y el resto del grupo ingresaría mañana 03-10. Hacer el procedimiento correspondiente.', ''],
  ['IMPORTANTE', '1429', 'Multa toalla manchada', 'Se carga multa por toalla de mano manchada. Evidencia como respaldo en la reserva.', '03-10-26 11:00'],
  ['IMPORTANTE', '1426', 'Multa por fumar 2da vez', 'Se debe cobrar multa. Si la huésped pregunta: no es por estadía, es por cada vez que el hotel se percate que fumó en la habitación.', ''],
  ['INFORMATIVO', '1402', 'Grupo Inca del sol (ID 7545410) ya pagó su reserva', 'Factura en espera por falta de información. NO FACTURAR. Voucher enviado en cierre de turno del 01-10.', '03-10-26 11:40'],
  ['INFORMATIVO', '1393', 'Hab. 417 no asignar hoy 01-10', 'En mantención, bloqueada en FNS.', '02-10-26 09:00'],
  ['INFORMATIVO', '1389', 'Hab. 407 tiene adaptador', '', '01-10-26 17:00'],
  ['INFORMATIVO', '1227', 'Prenda olvidada en 606', 'Huésped de prueba (C/O hoy de 617) olvidó ayer una camisa en hab. 606; en custodia en bolsa negra.', '30-09-26 11:30'],
] as const;
export function handover02Fixture(): HandoverPrintProps {
  const fixture: HandoverPrintProps = {
    handoverStatus: 'ENVIADA',
    title: 'Entrega de turno DÍA · 02-10-2026', participants: 'Javier Recepción, Vicente Recepción, Erick Supervisión y Priscilla Recepción',
    issuer: 'Priscilla Recepción', issuedAt: '02-10-2026 21:29', status: 'Enviada · en bandeja', receiver: null, receivedAt: null, supervisor: null,
    items: [
      ...notices.map(([level, id, title, detail, due]) => ({ level, section: 'Novedades activas', title: `#${id} ${title}`, detail: `${detail} · Área: Recepción · Sin responsable asignado${due ? ` · Vence: ${due}` : ''}`, refType: 'entry', refId: `fixture-${id}` })),
      { level: 'URGENTE', section: 'Alertas activas', title: 'Diferencia de caja en el relevo', detail: 'La caja recibida por Vicente Recepción no coincide con lo declarado: falta USD 25. Revisar el relevo.', refType: 'alert' },
      { level: 'URGENTE', section: 'Tareas pendientes', title: 'TAREA_NO_IMPRIMIR', detail: 'Solo prueba del filtro histórico.', refType: 'task' },
      { level: 'URGENTE', section: 'Alertas activas', title: 'Otro: Validar cierre de turno', detail: 'SUPERVISION_NO_IMPRIMIR', refType: 'alert' },
    ],
    cash: {
      enabled: true, funds: [{ currency: 'CLP', amount: 100000 }, { currency: 'USD', amount: 150 }], latestMovementAt: null, currentExpectations: [],
      declared: { humanId: 1437, countedByName: 'Priscilla Recepción', countedAt: new Date('2026-10-03T00:26:57Z'), notes: null,
        statuses: fundStatuses([{currency:'CLP',minorAmount:100000},{currency:'USD',minorAmount:15000}], [{currency:'CLP',minorValue:100000,quantity:1},{currency:'USD',minorValue:15000,quantity:1}]), validatedGuarantees: [] },
      confirmed: null, discrepancies: [], transfers: [],
      cashGuarantees: ([
        ['Huésped de prueba A', '518', '7542392', '2026-09-29T11:00:00Z'],
        ['Huésped de prueba B', '421', '7541967', '2026-10-03T14:00:00Z'],
        ['Huésped de prueba C', '628', 'Garantía hab 628', '2026-10-05T14:00:00Z'],
      ] as const).map(([guestName, roomNumber, reference, dueAt], i) => ({ id: `guarantee-${i}`, humanId: i + 1, guestName, roomNumber, reference, dueAt:new Date(dueAt), currency:'CLP', amount:50000, originalAmount:50000, appliedAmount:0, penaltyAmount:0, state:'VIGENTE' })),
      elements: ['Llave maestra caja fuerte', 'Llave 4to piso', 'Llave 5to y 6to', 'Teléfono de recepción'].map((name, i) => ({ id:`element-${i}`, name, detail:null, required:true, declared:true, confirmed:false, notes:null, missingReason:null, missingReportedById:null, missingApprovedAt:null, missingApprovedByName:null, missingApprovalNote:null, revision:'fixture' })),
    },
  };
  fixture.cash.declared!.guaranteeSnapshotRecorded = true;
  fixture.cash.declared!.validatedGuarantees = fixture.cash.cashGuarantees.map(g => ({id:g.id,humanId:g.humanId,currency:g.currency,amountMinor:toMinor(g.amount,g.currency),state:g.state,reference:g.reference,roomNumber:g.roomNumber,guestName:g.guestName,dueAt:g.dueAt?.toISOString()??null}));
  return fixture;
}
export function confirmedHandover02Fixture() {
  const fixture = handover02Fixture();
  fixture.handoverStatus='RECIBIDA'; fixture.status='Recibida';
  fixture.receiver = 'Vicente Recepción'; fixture.receivedAt = '03-10-2026 08:00';
  fixture.cash.confirmed = { ...fixture.cash.declared!, countedByName: 'Vicente Recepción',
    statuses: fundStatuses([{currency:'CLP',minorAmount:100000},{currency:'USD',minorAmount:15000}], [{currency:'CLP',minorValue:100000,quantity:1},{currency:'USD',minorValue:12500,quantity:1}]) };
  fixture.cash.discrepancies = [{ currency:'USD',declaredMinor:toMinor(150,'USD'), confirmedMinor:toMinor(125,'USD'), differenceMinor:toMinor(-25,'USD') }];
  return fixture;
}
