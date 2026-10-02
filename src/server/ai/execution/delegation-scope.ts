import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import type { DynamicDelegation } from '@/domain/fronti-delegation';
import { matchDelegatedStep } from '@/domain/fronti-delegation';
import type { FrontiStep } from '@/domain/fronti-execution';
import { coordinationEntries, coordinationTasks } from '@/server/services/coordination-access';
import { RuleError } from '@/server/errors';
import { actionDefinition, validateStep } from './catalog';

export function validateDynamicCatalog(policy: DynamicDelegation) {
  for(const rule of policy.rules){
    const definition=actionDefinition(rule.action);
    for(const key of [...Object.keys(rule.fixedFields),...Object.keys(rule.variableFields)])if(!definition.fields.includes(key))throw new RuleError('Campo no disponible en este procedimiento: '+key);
    const moneyFields=definition.fields.filter(field=>/amount|clpMinimum|usdMinimum/i.test(field));
    // A variable amount always consumes a same-currency budget. Composite counts remain exact.
    if(moneyFields.some(field=>field in rule.variableFields && rule.cost?.field!==field))throw new RuleError('Todo importe variable requiere su límite monetario.');
    if(rule.cost&&!moneyFields.includes(rule.cost.field))throw new RuleError('El campo de importe no corresponde al procedimiento.');
    for(const [field,constraint] of Object.entries(rule.variableFields)){
      if(/(^id$|Id$|Ids$)/.test(field)&&!['enum','record'].includes(constraint.type))throw new RuleError('Los identificadores variables requieren valores explícitos o un ámbito de registros.');
      if(constraint.type!=='record')continue;
      const matching=(constraint.kind==='task'&&definition.module==='tasks')||(constraint.kind==='entry'&&definition.module==='entries')||(rule.action==='coordinateWorkAction'&&rule.fixedFields.kind===constraint.kind);
      if(field!=='id'||!matching)throw new RuleError('La selección dinámica debe corresponder al registro nativo de esta acción.');
    }
  }
}

export async function assertDynamicSteps(user:CurrentUser,policy:DynamicDelegation,steps:FrontiStep[],tx:Prisma.TransactionClient){
  validateDynamicCatalog(policy);
  let cost=0;
  for(const raw of steps){
    const step=validateStep(raw);
    let matched;
    try { matched=matchDelegatedStep(policy,step); } catch { throw new RuleError('Acción, parámetro o importe fuera de la delegación.'); }
    cost+=matched.cost;
    for(const [field,constraint] of Object.entries(matched.rule.variableFields)){
      if(constraint.type!=='record'||step.fields[field]===undefined)continue;
      const id=String(step.fields[field]);
      const count=constraint.kind==='task'
        ?await tx.task.count({where:{id,departmentId:constraint.departmentId,status:{in:constraint.statuses as Prisma.EnumTaskStatusFilter['in']},AND:[coordinationTasks(user)]}})
        :await tx.operationalEntry.count({where:{id,departmentId:constraint.departmentId,status:{in:constraint.statuses as Prisma.EnumEntryStatusFilter['in']},AND:[coordinationEntries(user)]}});
      if(!count)throw new RuleError('El registro no está dentro del área, estado o acceso delegado.');
    }
  }
  if(!Number.isSafeInteger(cost)||cost>1000000000)throw new RuleError('Importe delegado fuera del límite.');
  return cost;
}
