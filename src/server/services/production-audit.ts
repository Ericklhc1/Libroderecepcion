import 'server-only';
import { AlertLevel, AlertStatus, HandoverStatus, KeyStatus, RoomStayStage, RoomStayStatus, ShiftStatus, TaskStatus, FollowUpStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { sendMail } from '@/server/mail';

const RECIPIENTS = 'recepcion@hoteleshw.com, eherrera@hoteleshw.com';
const SETTING_KEY = 'audit.production.email.state';

type Finding = { severity: 'CRITICA' | 'ATENCION'; problem: string; impact: string; evidence: string; solution: string };

function fingerprint(findings: Finding[]) {
  return createHash('sha256').update(JSON.stringify(findings.map(f => [f.severity,f.problem,f.evidence]).sort())).digest('hex');
}

export async function auditProduction(now = new Date()): Promise<Finding[]> {
  const findings: Finding[] = [];

  const activeStays = await prisma.roomStay.findMany({
    where: { deletedAt: null, status: RoomStayStatus.IN_HOUSE, stage: { not: RoomStayStage.FINALIZADO } },
    select: { id:true, reservationId:true, reservationRefId:true, roomId:true, stage:true, room:{select:{number:true}} },
  });

  const byRoom = new Map<string, typeof activeStays>();
  for (const s of activeStays) if (s.roomId) byRoom.set(s.roomId, [...(byRoom.get(s.roomId) ?? []), s]);
  for (const stays of byRoom.values()) if (stays.length > 1) findings.push({
    severity:'CRITICA', problem:`Habitación ${stays[0].room?.number ?? '?'} con ocupación activa duplicada`,
    impact:'Dos estadías compiten por la misma habitación.',
    evidence: stays.map(s=>`${s.reservationId}/${s.stage}`).join(', '),
    solution:'Contrastar con PMS y finalizar o corregir la estadía que no corresponda.',
  });

  const orphanStays = activeStays.filter(s => !s.roomId || !s.reservationRefId);
  for (const s of orphanStays) findings.push({
    severity:'ATENCION', problem:`Estadía activa sin ${!s.roomId ? 'habitación' : 'reserva interna'}: ${s.reservationId}`,
    impact:'La trazabilidad entre PMS, habitación y reserva queda incompleta.',
    evidence:`stayId=${s.id}; room=${s.room?.number ?? 'null'}; reservationRefId=${s.reservationRefId ?? 'null'}`,
    solution:'Reconciliar la estadía por código exacto de reserva y habitación del PMS.',
  });

  const activeKeys = await prisma.roomKey.findMany({
    where:{ status:{in:[KeyStatus.ASIGNADA,KeyStatus.COPIA_ADICIONAL,KeyStatus.PENDIENTE_DEVOLUCION]} },
    select:{id:true,code:true,status:true,roomId:true,stayId:true,stay:{select:{id:true,roomId:true,status:true,stage:true,reservationId:true}}},
  });
  for (const k of activeKeys) {
    if (!k.stayId || !k.stay) findings.push({severity:'CRITICA',problem:`Llave ${k.code} activa sin estadía`,impact:'La llave física no tiene ocupación trazable.',evidence:`status=${k.status}; stayId=${k.stayId ?? 'null'}`,solution:'Vincularla a la estadía correcta o reintegrarla como disponible.'});
    else if (k.roomId !== k.stay.roomId) findings.push({severity:'CRITICA',problem:`Llave ${k.code} vinculada a habitación distinta de su estadía`,impact:'Riesgo de entrega/control de llave sobre habitación incorrecta.',evidence:`key.roomId=${k.roomId}; stay.roomId=${k.stay.roomId}; reserva=${k.stay.reservationId}`,solution:'Corregir el vínculo de la llave y registrar el movimiento correspondiente.'});
    else if (k.status === KeyStatus.ASIGNADA && (k.stay.status !== RoomStayStatus.IN_HOUSE || k.stay.stage !== RoomStayStage.CONFIRMADO)) findings.push({severity:'ATENCION',problem:`Llave ${k.code} asignada a estadía no confirmada`,impact:'El estado físico de la llave contradice el estado operativo de la estadía.',evidence:`reserva=${k.stay.reservationId}; status=${k.stay.status}; stage=${k.stay.stage}`,solution:'Confirmar la estadía si el huésped está alojado; si no, liberar la llave.'});
  }

  const confirmedIds = new Set(activeStays.filter(s=>s.stage===RoomStayStage.CONFIRMADO).map(s=>s.id));
  const keyedIds = new Set(activeKeys.filter(k=>k.status===KeyStatus.ASIGNADA && k.stayId).map(k=>k.stayId!));
  for (const id of confirmedIds) if (!keyedIds.has(id)) {
    const s=activeStays.find(x=>x.id===id)!;
    findings.push({severity:'CRITICA',problem:`IN_HOUSE confirmado sin llave principal asignada: hab. ${s.room?.number ?? '?'}`,impact:'Ocupación confirmada sin entrega de llave trazable.',evidence:`reserva=${s.reservationId}; stayId=${s.id}`,solution:'Registrar la entrega de la llave principal o corregir el estado de la estadía.'});
  }

  const guarantees = await prisma.guarantee.findMany({where:{deletedAt:null},select:{id:true,state:true,amount:true,currency:true,reservationReferenceId:true,stayId:true,stay:{select:{reservationRefId:true,deletedAt:true}},cashMovements:{where:{voidedAt:null},select:{id:true,kind:true,direction:true,amount:true,currency:true}}}});
  for (const g of guarantees) {
    if (g.stayId && (!g.stay || g.stay.deletedAt || g.stay.reservationRefId !== g.reservationReferenceId)) findings.push({severity:'CRITICA',problem:'Garantía vinculada a estadía incompatible',impact:'Garantía puede aplicarse o devolverse sobre una estancia incorrecta.',evidence:`guaranteeId=${g.id}; reservationRefId=${g.reservationReferenceId}; stayId=${g.stayId}`,solution:'Reasociar la garantía a la estadía correcta conservando su historial.'});
    const cashIn=g.cashMovements.filter(m=>m.direction==='ENTRADA').reduce((a,m)=>a+Number(m.amount),0);
    if (cashIn > Number(g.amount) && g.currency==='CLP') findings.push({severity:'CRITICA',problem:'Garantía con entradas de Caja superiores al monto registrado',impact:'Caja puede estar sobreestimada por doble contabilización.',evidence:`guaranteeId=${g.id}; garantía=${g.amount} ${g.currency}; entradas=${cashIn} ${g.currency}`,solution:'Revisar movimientos asociados y anular únicamente el movimiento duplicado, nunca borrar la garantía.'});
  }

  const openHandovers=await prisma.shiftHandover.findMany({where:{status:HandoverStatus.ENVIADA},select:{id:true,issuedAt:true,receivedAt:true,fromShift:{select:{id:true,type:true,date:true,status:true}},toShift:{select:{id:true,status:true}}}});
  for(const h of openHandovers) if(h.receivedAt===null && (h.toShift?.status===ShiftStatus.ACTIVO || h.toShift?.status===ShiftStatus.RECIBIDO || h.toShift?.status===ShiftStatus.CERRADO)) findings.push({severity:'ATENCION',problem:'Handover sin recepción formal aunque el turno receptor ya avanzó',impact:'El ciclo de relevo queda históricamente inconcluso.',evidence:`handoverId=${h.id}; origen=${h.fromShift.type} ${h.fromShift.date.toISOString().slice(0,10)}; destinoStatus=${h.toShift?.status}`,solution:'Regularizar la recepción y bloquear futuras transiciones mientras exista una entrega anterior abierta.'});

  const staleShifts=await prisma.shift.findMany({where:{status:{in:[ShiftStatus.ENTREGA_ENVIADA,ShiftStatus.RECIBIDO]},plannedEnd:{lt:new Date(now.getTime()-3*3600_000)},archivedAt:null},select:{id:true,type:true,date:true,status:true,actualEnd:true}});
  for(const s of staleShifts) findings.push({severity:'ATENCION',problem:`Turno ${s.type} ${s.date.toISOString().slice(0,10)} quedó en ${s.status}`,impact:'El turno anterior permanece abierto pese al avance operacional.',evidence:`shiftId=${s.id}; actualEnd=${s.actualEnd?.toISOString() ?? 'null'}`,solution:'Regularizar/cerrar el turno y revisar la transición automática del relevo.'});

  const [alerts,tasks,followUps]=await Promise.all([
    prisma.alert.findMany({where:{deletedAt:null,level:AlertLevel.CRITICA,status:{in:[AlertStatus.NUEVA,AlertStatus.VISTA]}},select:{id:true,title:true,message:true}}),
    prisma.task.findMany({where:{deletedAt:null,priority:'CRITICA',status:{in:[TaskStatus.PENDIENTE,TaskStatus.EN_CURSO,TaskStatus.BLOQUEADA]}},select:{id:true,title:true,status:true}}),
    prisma.followUp.findMany({where:{deletedAt:null,status:{in:[FollowUpStatus.PENDIENTE,FollowUpStatus.VENCIDO]},scheduledAt:{lt:now}},select:{id:true,action:true,status:true,scheduledAt:true}}),
  ]);
  for(const a of alerts) findings.push({severity:'CRITICA',problem:`Alerta crítica: ${a.title}`,impact:'Existe una condición crítica activa que requiere revisión.',evidence:`alertId=${a.id}; ${a.message ?? ''}`,solution:'Resolver la condición de origen y cerrar la alerta con evidencia.'});
  for(const t of tasks) findings.push({severity:'CRITICA',problem:`Tarea crítica pendiente: ${t.title}`,impact:'Acción crítica todavía no completada.',evidence:`taskId=${t.id}; status=${t.status}`,solution:'Ejecutar o reasignar la tarea y documentar su cierre.'});
  for(const f of followUps) findings.push({severity:'ATENCION',problem:`Seguimiento vencido: ${f.action}`,impact:'Un seguimiento operativo superó su fecha prevista.',evidence:`followUpId=${f.id}; status=${f.status}; scheduledAt=${f.scheduledAt?.toISOString() ?? 'null'}`,solution:'Ejecutar el seguimiento y registrar resultado/próxima acción.'});

  return findings;
}

function render(findings: Finding[], now: Date) {
  const lines=[`Auditoría automática Production — ${now.toLocaleString('es-CL',{timeZone:'America/Santiago'})}`,''];
  for(const f of findings) lines.push(`${f.severity==='CRITICA'?'🔴':'🟡'} ${f.problem}\nImpacto: ${f.impact}\nEvidencia: ${f.evidence}\nSolución: ${f.solution}\n`);
  return lines.join('\n');
}

export async function runProductionAuditAndNotify(now=new Date()) {
  const findings=await auditProduction(now);
  if(findings.length===0) return {ok:true, findings:0, sent:false, reason:'sin_hallazgos'};

  const fp=fingerprint(findings);
  const state=await prisma.systemSetting.findUnique({where:{key:SETTING_KEY}}).catch(()=>null);
  const old=(state?.value ?? {}) as {fingerprint?:string;lastSentAt?:string};
  const last=old.lastSentAt ? new Date(old.lastSentAt) : null;
  const critical=findings.some(f=>f.severity==='CRITICA');
  const unchanged=old.fingerprint===fp;
  const recentlySent=last && now.getTime()-last.getTime()<12*3600_000;
  if(unchanged && recentlySent) return {ok:true,findings:findings.length,sent:false,reason:'sin_cambios'};

  const body=render(findings,now);
  const result=await sendMail({to:RECIPIENTS,subject:`[${critical?'CRÍTICO':'ATENCIÓN'}] Auditoría Libro Operativo — ${findings.length} hallazgo(s)`,text:body});
  if(!result.sent) return {ok:false,findings:findings.length,sent:false,reason:result.reason};

  await prisma.systemSetting.upsert({where:{key:SETTING_KEY},create:{key:SETTING_KEY,value:{fingerprint:fp,lastSentAt:now.toISOString(),count:findings.length},category:'auditoria',description:'Estado de deduplicación del correo automático de auditoría de Production.'},update:{value:{fingerprint:fp,lastSentAt:now.toISOString(),count:findings.length}}});
  return {ok:true,findings:findings.length,sent:true};
}
