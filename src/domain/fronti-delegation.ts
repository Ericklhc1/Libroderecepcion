import { z } from 'zod';
import { canonicalJson, frontiStepSchema, type FrontiStep } from './fronti-execution';

const fieldRule = z.discriminatedUnion('type', [
  z.object({type:z.literal('enum'),values:z.array(z.string().max(6000)).min(1).max(100)}).strict(),
  z.object({type:z.literal('text'),maxLength:z.number().int().min(1).max(6000)}).strict(),
  z.object({type:z.literal('integer'),min:z.number().int().nonnegative(),max:z.number().int().nonnegative().max(1000000000)}).strict(),
  z.object({type:z.literal('record'),kind:z.enum(['task','entry']),departmentId:z.string().min(1),statuses:z.array(z.string().min(1)).min(1).max(10)}).strict(),
]);
export const dynamicDelegationSchema = z.object({
  requestKey:z.string().uuid(), instruction:z.string().min(3).max(6000), objective:z.string().min(3).max(500),
  availableAt:z.string().datetime({offset:true}), expiresAt:z.string().datetime({offset:true}),
  maxExecutions:z.number().int().min(1).max(100), maxActions:z.number().int().min(1).max(1000),
  budget:z.object({currency:z.enum(['CLP','USD']),maxMinorUnits:z.number().int().positive().max(1000000000)}).strict().optional(),
  rules:z.array(z.object({action:z.string().min(1),fixedFields:frontiStepSchema.shape.fields,
    variableFields:z.record(fieldRule),
    cost:z.object({field:z.string().min(1),currency:z.enum(['CLP','USD'])}).strict().optional(),
  }).strict()).min(1).max(12),
}).strict().superRefine((v,ctx)=>{
  const start=Date.parse(v.availableAt),end=Date.parse(v.expiresAt);
  if(end<=start||end-start>31*86400000)ctx.addIssue({code:'custom',message:'La vigencia máxima es 31 días.'});
  for(const rule of v.rules){
    if(Object.keys(rule.variableFields).some(key=>key in rule.fixedFields))ctx.addIssue({code:'custom',message:'Un campo no puede ser fijo y variable.'});
    for(const constraint of Object.values(rule.variableFields))if(constraint.type==='integer'&&constraint.max<constraint.min)ctx.addIssue({code:'custom',message:'Límite máximo inferior al mínimo.'});
    if(rule.cost&&(!v.budget||rule.cost.currency!==v.budget.currency||rule.fixedFields.currency!==rule.cost.currency))ctx.addIssue({code:'custom',message:'El importe exige presupuesto y moneda fija coincidentes.'});
  }
});
export type DynamicDelegation = z.infer<typeof dynamicDelegationSchema>;

/** Integer accounting prevents float rounding from extending a monetary mandate. */
export function minorUnits(value: unknown, currency:'CLP'|'USD') {
  if(typeof value!=='string'||!/^\d{1,10}(\.\d{1,2})?$/.test(value))throw new Error('Importe inválido.');
  const [whole,fraction='']=value.split('.');
  if(currency==='CLP'&&fraction.replace(/0/g,''))throw new Error('CLP requiere pesos enteros.');
  const result=Number(whole)*(currency==='USD'?100:1)+(currency==='USD'?Number(fraction.padEnd(2,'0')):0);
  if(!Number.isSafeInteger(result))throw new Error('Importe fuera del límite.');
  return result;
}

export function matchDelegatedStep(policy:DynamicDelegation,step:FrontiStep){
  const rule=policy.rules.find(rule=>rule.action===step.action&&Object.entries(rule.fixedFields).every(([key,value])=>canonicalJson(value)===canonicalJson(step.fields[key]))&&Object.entries(step.fields).every(([key,value])=>{
    if(key in rule.fixedFields)return true;
    const constraint=rule.variableFields[key];if(!constraint||typeof value!=='string')return false;
    if(constraint.type==='enum')return constraint.values.includes(value);
    if(constraint.type==='text')return value.length<=constraint.maxLength;
    if(constraint.type==='record')return value.length>0&&value.length<=100;
    return /^\d+$/.test(value)&&Number(value)>=constraint.min&&Number(value)<=constraint.max;
  }));
  if(!rule)throw new Error('La acción o sus parámetros exceden la delegación.');
  return {rule,cost:rule.cost?minorUnits(step.fields[rule.cost.field],rule.cost.currency):0};
}
