import { z } from 'zod';
import { UX_ACTIONS, UX_ROUTES } from './ux-telemetry';

export const uxEventSchema = z.object({
  intentId:z.string().uuid(),event:z.enum(['ROUTE','ACTION','RESULT','EXIT']),route:z.enum(UX_ROUTES),
  entityType:z.enum(['OperationalEntry','Task','Room']).optional(),entityId:z.string().regex(/^[a-z0-9]{1,40}$/).optional(),
  selectedAction:z.enum(UX_ACTIONS).optional(),visibleActions:z.array(z.enum(UX_ACTIONS)).max(16).optional(),
  result:z.enum(['SUCCESS','FAILED','LEFT','PENDING']).optional(),duration:z.number().int().min(0).max(3600000).optional(),backNavigation:z.boolean().optional(),
}).strict().superRefine((value,context)=>{
  const resultValid=value.event==='RESULT' ? value.result==='SUCCESS'||value.result==='FAILED' : value.event==='EXIT' ? value.result==='LEFT'||value.result==='PENDING' : value.result===undefined;
  if(!resultValid)context.addIssue({code:z.ZodIssueCode.custom,path:['result'],message:'Resultado no corresponde al evento.'});
});
