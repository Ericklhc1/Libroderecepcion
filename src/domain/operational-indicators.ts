import { elapsedMinutes } from './coordination';
import type { CoordinationRow } from '@/server/services/coordination';

export function measuredDurations(rows:CoordinationRow[],from:Date,to:Date){
  const metric=(start:'assignedAt'|'receivedAt'|'startedAt',end:'receivedAt'|'startedAt'|'completedAt')=>{
    const applicable=rows.filter(row=>row[end]&&row[end]!>=from&&row[end]!<=to);
    const values=applicable.map(row=>elapsedMinutes(row[start],row[end])).filter((n):n is number=>n!==null);
    values.sort((a,b)=>a-b);
    return {minutes:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,p95Minutes:values.length?values[Math.ceil(values.length*.95)-1]!:null,samples:values.length,denominator:applicable.length,missing:applicable.length-values.length,definition:`${start} → ${end}; evento final dentro del período`};
  };
  return {receipt:metric('assignedAt','receivedAt'),attention:metric('receivedAt','startedAt'),resolution:metric('startedAt','completedAt')};
}

export function periodChanges(rows:CoordinationRow[],from:Date,to:Date){
  const within=(date:Date|null)=>!!date&&date>=from&&date<=to;
  return rows.filter(row=>within(row.createdAt)||within(row.updatedAt)||within(row.receivedAt)||within(row.completedAt)).map(row=>({id:row.id,kind:row.kind,title:row.title,href:row.href,owner:row.owner,department:row.department,
    created:within(row.createdAt),received:within(row.receivedAt),completed:within(row.completedAt),updatedAt:row.updatedAt,nextAction:row.nextAction,
    note:'Hechos registrados. Una actualización sin evento específico no permite reconstruir el estado anterior.',
  }));
}
