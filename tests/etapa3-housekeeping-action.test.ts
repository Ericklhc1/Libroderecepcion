import {describe,expect,it} from 'vitest';
import {ValidationError} from '@/server/errors';
import {runHkAction} from '@/server/housekeeping-action';
describe('Housekeeping: errores útiles en pantalla y Fronti',()=>{
 it('nombra los datos inválidos sin copiar valores ni perder la validación del formulario',async()=>{
  const fieldErrors={workDate:['Fecha inválida'],assignedToId:['Persona inválida']};
  const result=await runHkAction(async()=>{throw new ValidationError(fieldErrors);});
  expect(result).toEqual({ok:false,error:'Revisa estos datos: fecha de trabajo, responsable.',fieldErrors});
 });
 it('mantiene los resultados confirmados',async()=>{
  expect(await runHkAction(async()=>({ok:true,message:'Trabajo registrado',id:'synthetic-id'}))).toEqual({ok:true,message:'Trabajo registrado',id:'synthetic-id'});
 });
});
