import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { RuleError } from '@/server/errors';

type EntryResult = {id:string;humanId:number;status:string;resolution:string|null};
/** Runs inside the native entry mutation. A failed feedback write rolls back the whole transition. */
export async function publishHkMaintenanceUpdate(tx:Prisma.TransactionClient,user:CurrentUser,before:EntryResult,after:EntryResult) {
  if (before.status===after.status && before.resolution===after.resolution) return;
  await tx.$queryRaw`SELECT "id" FROM "HousekeepingRequest" WHERE "maintenanceEntryId"=${after.id} FOR UPDATE`;
  const request=await tx.housekeepingRequest.findUnique({where:{maintenanceEntryId:after.id}});
  if (!request || request.workflowVersion!==1 || request.isDemo) return;
  const done=['RESUELTO','CERRADO'].includes(after.status);
  if (done&&!after.resolution?.trim()) throw new RuleError('Indica el resultado de Mantenimiento antes de devolver el trabajo al área solicitante.');
  const reopened=!done&&['RESUELTO','CERRADO'].includes(before.status);
  const action=done?'MANTENIMIENTO_RESULTADO':reopened?'MANTENIMIENTO_REABIERTO':'MANTENIMIENTO_AVANCE';
  const note=`Mantenimiento #${after.humanId}: ${done?'resultado disponible':reopened?'reabierto; requiere atención':'atención en curso'}.${after.resolution?`\n${done?'Resultado':'Resultado anterior o avance, no cierre'}: ${after.resolution}`:''}\nEl trabajo de Housekeeping conserva su estado, responsable e inspección.`;
  // No state, assignment, custody, cash or PMS write: only invalidate stale forms and append evidence.
  if (!(await tx.housekeepingRequest.updateMany({where:{id:request.id,version:request.version},data:{version:{increment:1}}})).count) throw new RuleError('El trabajo cambió mientras se devolvía el resultado. Actualiza antes de continuar.');
  await tx.housekeepingEvent.create({data:{requestId:request.id,actorId:user.id,action,fromStatus:request.status,toStatus:request.status,note}});
  await tx.auditLog.create({data:{entity:'HousekeepingWork',entityId:request.id,userId:user.id,sessionId:user.sessionId,action:'EDITAR',summary:`Housekeeping #${request.humanId}: actualización de Mantenimiento #${after.humanId}`,reason:note}});
  const {notifyHkWork}=await import('./housekeeping-work');
  await notifyHkWork(tx,request,user.id,done?'Mantenimiento: resultado disponible':reopened?'Mantenimiento reabierto: revisar continuidad':'Mantenimiento informó un avance');
}
