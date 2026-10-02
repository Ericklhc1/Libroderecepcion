import 'server-only';
import { prisma } from '@/lib/prisma';
import { escalationSchema } from '@/domain/operational-automation';

/** Explicit enabled policies own their matching deadline; legacy detectors remain the fallback. */
export async function activeRuleOverrides(kind:'entry'|'task'|'housekeeping', trigger:'UNRECEIVED'|'OVERDUE', now:Date) {
  if(process.env.AROH_AUTOMATION_EXECUTION_ENABLED!=='true')return [];
  const policies=await prisma.operationalAutomation.findMany({where:{kind:'ESCALATION',enabled:true,revokedAt:null,expiresAt:{gt:now},owner:{active:true,deletedAt:null,mustChangePassword:false,role:{permissions:{some:{permission:{key:'system.configure'}}}}}},select:{departmentId:true,configuration:true}});
  return policies.flatMap(p=>{const c=escalationSchema.safeParse(p.configuration);if(!c.success||c.data.trigger!==trigger||(c.data.kind&&c.data.kind!==kind))return [];return [{departmentId:p.departmentId,...(c.data.priority?{priority:c.data.priority}:{})}];});
}
