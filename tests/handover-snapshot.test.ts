import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EntryType,
  GuaranteeStatus,
  HandoverLevel,
  Priority,
  ReservationStatus,
  Severity,
  ShiftType,
} from '@prisma/client';
import {
  ROLE_KEYS,
  createShift,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
  openShiftAs,
} from './helpers';
import { buildHandoverSnapshot,receptionSummaryKey,visibleSnapshotItems,visibleHandover } from '@/server/services/handover-snapshot';
import { runAlertEngine } from '@/server/services/alert-engine';
import { createEntry,updateEntry,changeEntryStatus,softDeleteEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import {
  confirmHandoverReviewStep,
  prepareHandover,
  receiveHandover,
  sendHandover,
} from '@/server/services/shifts';
import type { CurrentUser } from '@/server/auth/current-user';

async function confirmReview(user: CurrentUser, handoverId: string) {
  await confirmHandoverReviewStep(user, { handoverId, step: 'PENDINGS' });
  await confirmHandoverReviewStep(user, { handoverId, step: 'FINAL' });
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);

describe('resumen automático de la entrega', () => {
  let user: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });

  for(const simpleMode of [false,true])it(`excluye novedades retiradas de una fotografía conservada, modo ${simpleMode}`,async()=>{
    const shift=await openShiftAs(user);await receiveHandover(user,{shiftId:shift.id});
    await prisma.systemSetting.create({data:{key:'book.simpleNovelties',value:simpleMode,category:'pruebas'}});
    const row=await createEntry(user,{type:'NOVEDAD',title:'Retirada después de preparar',description:'No entregar como pendiente vigente',priority:'MEDIA',tags:[],requiresFollowUp:false});
    const draft=await prepareHandover(user,shift.id);const photograph=await prisma.shiftHandover.findUniqueOrThrow({where:{id:draft.id},include:{items:true}});
    expect(photograph.items.some(item=>item.refId===row.id)).toBe(true);
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});await softDeleteEntry(admin,{id:row.id,reason:'Retiro sintético autorizado'});
    const current=await prisma.shiftHandover.findUniqueOrThrow({where:{id:draft.id},include:{items:true}});
    expect(current.receptionSummaryRevision).toBe(photograph.receptionSummaryRevision+(simpleMode?1:0));
    expect((await visibleSnapshotItems(user,current.items,true)).some(item=>item.refId===row.id)).toBe(false);
    expect((await visibleHandover(user,{...current,snapshot:{items:photograph.items.map(item=>({level:item.level,section:item.section,title:item.title,detail:item.detail,refType:item.refType,refId:item.refId}))}})).items.some(item=>item.refId===row.id)).toBe(false);
    expect(await prisma.handoverItem.count({where:{handoverId:draft.id,refId:row.id}})).toBe(1);
    if(!simpleMode){await confirmReview(user,draft.id);const sent=await sendHandover(user,{shiftId:shift.id});expect(JSON.stringify(sent.snapshot)).not.toContain(row.id);expect(await prisma.handoverItem.count({where:{handoverId:draft.id,refId:row.id}})).toBe(1);}
  });

  for(const simpleMode of [true,false])it(`fotografía todas las novedades simples sin truncar y conserva límites legados: ${simpleMode}`,async()=>{
    const shift=await createShift({userId:user.id,type:'DIA'});await prisma.systemSetting.create({data:{key:'book.simpleNovelties',value:simpleMode,category:'pruebas'}});
    await prisma.operationalEntry.createMany({data:[...Array.from({length:201},(_,index)=>({type:'NOVEDAD' as const,title:`Abierta completa ${index}`,description:'Todas disponibles para revisión',createdById:user.id,status:'ABIERTO' as const})),...Array.from({length:151},(_,index)=>({type:'NOVEDAD' as const,title:`Resuelta completa ${index}`,description:'Todas disponibles para revisión',createdById:user.id,status:'RESUELTO' as const,shiftId:shift.id,closedAt:new Date()}))]});
    const snapshot=await buildHandoverSnapshot(user,new Date(),{shiftId:shift.id});const rows=snapshot.filter(row=>row.refType==='entry');expect(rows.filter(row=>row.title.includes('Abierta completa'))).toHaveLength(simpleMode?201:200);expect(rows.filter(row=>row.title.includes('Resuelta completa'))).toHaveLength(simpleMode?151:150);
  });
  it('fotografía Seguimiento, Reserva, HAB y autor antes de confirmar, también resuelta',async()=>{
    const shift=await openShiftAs(user);await prisma.systemSetting.create({data:{key:'book.simpleNovelties',value:true,category:'pruebas'}});const room=await prisma.room.findFirstOrThrow();const row=await createEntry(user,{type:'NOVEDAD',title:'Campos operativos fotografiados',description:'Antecedente de la planilla',roomId:room.id,reservationReference:'7484708',workNextAction:'Cobrar antes de salir',priority:'MEDIA',tags:[],requiresFollowUp:false});const before=await buildHandoverSnapshot(user,new Date(),{shiftId:shift.id});const detail=before.find(item=>item.refId===row.id)!.detail!;for(const value of ['7484708',`HAB: ${room.number}`,user.name,'Cobrar antes de salir','Recepción','Estado: Abierto'])expect(detail).toContain(value);
    await updateEntry(user,{id:row.id,workNextAction:'Confirmar cobro registrado'});const after=await buildHandoverSnapshot(user,new Date(),{shiftId:shift.id});expect(receptionSummaryKey(after)).not.toBe(receptionSummaryKey(before));expect(after.find(item=>item.refId===row.id)!.detail).toContain('Confirmar cobro registrado');await changeEntryStatus(user,{id:row.id,status:'RESUELTO'});const resolved=(await buildHandoverSnapshot(user,new Date(),{shiftId:shift.id})).find(item=>item.refId===row.id)!;for(const value of ['7484708',`HAB: ${room.number}`,'Confirmar cobro registrado','Antecedente de la planilla'])expect(resolved.detail).toContain(value);
  });
  it('agrupa cada asunto en su sección y lo clasifica por urgencia', async () => {
    await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Tarjeta rechazada en la 215',
      description: 'Pre-autorización rechazada; cargos bloqueados.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      tags: [],
      requiresFollowUp: false,
    });
    await createEntry(user, {
      type: EntryType.MANTENIMIENTO,
      title: 'Filtración en el baño de la 107',
      description: 'Paños absorbentes colocados.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });
    await createEntry(user, {
      type: EntryType.HUESPED,
      title: 'Aniversario de bodas en la 402',
      description: 'Coordinar decoración y espumante.',
      priority: Priority.ALTA,
      tags: [],
      requiresFollowUp: false,
    });
    await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Ocupación proyectada del 78%',
      description: 'Catorce llegadas y nueve salidas.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
    });
    await createTask(user, {
      title: 'Confirmar traslado al aeropuerto',
      priority: Priority.ALTA,
      tags: [],
      checklist: [],
      dueAt: hoursAgo(2),
    });

    const snapshot = await buildHandoverSnapshot(user);
    const sections = new Set(snapshot.map((item) => item.section));

    expect(sections).toContain('Incidencias abiertas');
    expect(sections).toContain('Novedades activas');
    expect(sections).not.toContain('Tareas pendientes');
    expect(sections).not.toContain('Mantenimiento');
    expect(sections).not.toContain('Solicitudes de huéspedes');

    // La incidencia crítica y la tarea vencida son urgentes.
    const urgentes = snapshot.filter((item) => item.level === HandoverLevel.URGENTE);
    expect(urgentes.map((i) => i.title).join(' ')).toContain('Tarjeta rechazada');
    expect(urgentes.map((i) => i.title).join(' ')).not.toContain('Confirmar traslado');

    // La novedad informativa no se marca como urgente.
    const ocupacion = snapshot.find((item) => item.title.includes('Ocupación'));
    expect(ocupacion?.level).toBe(HandoverLevel.INFORMATIVO);
  });

  it('no convierte datos PMS en puntos de entrega', async () => {
    const guest = await prisma.guestReference.create({
      data: { fullName: 'Andrés Bustamante', roomNumber: '215' },
    });
    await prisma.reservationReference.create({
      data: {
        code: 'RES-70001',
        guestId: guest.id,
        status: ReservationStatus.EN_CASA,
        guaranteeStatus: GuaranteeStatus.RECHAZADA,
        balanceDue: 184500,
        requiresAction: true,
        actionNote: 'Dato legado que no debe entrar a la entrega.',
      },
    });

    const snapshot = await buildHandoverSnapshot(user);
    const sections = snapshot.map((item) => item.section);

    expect(sections).not.toContain('Cobros pendientes');
    expect(sections).not.toContain('Garantías (resumen de reserva)');
    expect(sections).not.toContain('Reservas que requieren acción');
    expect(snapshot).toHaveLength(0);
  });

  it('no repite un asunto que ya aparece en otra sección', async () => {
    const task = await createTask(user, {
      title: 'Revisar comprobantes de caja',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
      dueAt: hoursAgo(4),
    });
    const incident = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Corte de energía en el ala sur',
      description: 'Generador en funcionamiento.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      tags: [],
      requiresFollowUp: false,
    });
    await runAlertEngine();

    const snapshot = await buildHandoverSnapshot(user);
    const alertItems = snapshot.filter((item) => item.section === 'Alertas activas');

    expect(alertItems.some((item) => item.title.includes('Revisar comprobantes'))).toBe(false);
    expect(alertItems.some((item) => item.title.includes('Corte de energía'))).toBe(false);
    expect(snapshot.filter((item) => item.refId === task.id)).toHaveLength(0);
    expect(snapshot.filter((item) => item.refId === incident.id)).toHaveLength(1);
  });

  it('conserva las alertas que aportan información propia', async () => {
    await prisma.alert.create({
      data: {
        type: 'SALIDA_ANTICIPADA',
        level: 'ATENCION',
        title: 'Salida anticipada del grupo a las 06:00',
        message: 'Cuentas cerradas la noche anterior.',
        auto: false,
      },
    });

    const snapshot = await buildHandoverSnapshot(user);
    const alertItems = snapshot.filter((item) => item.section === 'Alertas activas');
    expect(alertItems.some((item) => item.title.includes('Salida anticipada'))).toBe(true);
  });

  it('incluye los seguimientos próximos y los vencidos', async () => {
    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Registro con dos seguimientos',
      description: 'Uno vencido y otro próximo.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });
    await createFollowUp(user, {
      entryId: entry.id,
      action: 'Seguimiento vencido',
      scheduledAt: hoursAgo(6),
    });
    await createFollowUp(user, {
      entryId: entry.id,
      action: 'Seguimiento de mañana',
      scheduledAt: new Date(Date.now() + 6 * 3600_000),
    });
    await runAlertEngine();

    const snapshot = await buildHandoverSnapshot(user);
    const seguimientos = snapshot.filter((item) => item.section === 'Seguimientos próximos');

    expect(seguimientos).toHaveLength(2);
    const vencido = seguimientos.find((item) => item.title === 'Seguimiento vencido');
    expect(vencido?.level).toBe(HandoverLevel.URGENTE);
    expect(vencido?.detail).toContain('VENCIDO');
  });

  it('sanea al enviar un borrador histórico sin borrar evidencia ni controles',async()=>{
    const shift=await openShiftAs(user);
    await receiveHandover(user,{shiftId:shift.id});
    const follow=await prisma.followUp.create({data:{action:'SECRETO_NO_COMPARTIR',visibility:'PRIVADO',createdById:user.id,ownerId:user.id}});
    const handover=await prepareHandover(user,shift.id);
    const original=await prisma.handoverItem.create({data:{handoverId:handover.id,title:'SECRETO_NO_COMPARTIR',detail:'Detalle privado histórico',refType:'followup',refId:follow.id,section:'Seguimientos próximos',level:'INFORMATIVO'}});
    await confirmReview(user,handover.id);
    const sent=await sendHandover(user,{shiftId:shift.id});
    expect(JSON.stringify(sent.snapshot)).not.toContain('SECRETO_NO_COMPARTIR');
    expect(JSON.stringify(sent.snapshot)).not.toContain('Detalle privado histórico');
    expect(JSON.stringify(sent.snapshot)).toContain('Asunto reservado');
    expect(await prisma.handoverItem.findUniqueOrThrow({where:{id:original.id}})).toMatchObject({title:'SECRETO_NO_COMPARTIR',detail:'Detalle privado histórico',refId:follow.id});
    expect(await prisma.operationalMailOutbox.findFirst({where:{eventKey:`handover-sent:${sent.id}`}})).toMatchObject({text:expect.not.stringContaining('SECRETO_NO_COMPARTIR')});
    expect(sent.pendingsReviewedAt).not.toBeNull();expect(sent.finalReviewAt).not.toBeNull();
  });

  it('la entrega enviada guarda una fotografía inmutable de lo entregado', async () => {
    const shiftA = await createShift({ userId: user.id, type: ShiftType.DIA });
    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Registro presente al momento de la entrega',
      description: 'Debe quedar en el snapshot aunque después cambie.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });

    await openShiftAs(user, shiftA);
    await receiveHandover(user, { shiftId: shiftA.id });
    const handover = await prepareHandover(user, shiftA.id);
    await confirmReview(user, handover.id);
    const sent = await sendHandover(user, { shiftId: shiftA.id });

    const snapshot = sent.snapshot as {
      items: Array<{ title: string; refId: string | null }>;
      counts: Record<string, number>;
    };
    expect(snapshot.items.some((item) => item.refId === entry.id)).toBe(true);
    expect(Object.keys(snapshot.counts)).toEqual(['urgente', 'importante', 'informativo']);

    await prisma.operationalEntry.update({
      where: { id: entry.id },
      data: { title: 'Título cambiado después de la entrega' },
    });

    const stored = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: sent.id } });
    const storedSnapshot = stored.snapshot as { items: Array<{ title: string }> };
    expect(
      storedSnapshot.items.some((item) =>
        item.title.includes('Registro presente al momento de la entrega'),
      ),
    ).toBe(true);
  });

  it('el resumen queda vacío cuando no hay nada pendiente', async () => {
    const snapshot = await buildHandoverSnapshot(user);
    expect(snapshot).toHaveLength(0);
  });
});
