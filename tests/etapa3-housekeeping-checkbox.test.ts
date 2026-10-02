import {describe,expect,it} from 'vitest';
import {z} from 'zod';
import {hkCheckbox} from '@/domain/housekeeping-form';
describe('Housekeeping: casillas HTML y valores de Fronti',()=>{
 it.each([undefined,'',false,'false','off'])('interpreta %s como desmarcado',value=>expect(hkCheckbox.parse(value)).toBe(false));
 it.each([true,'true','on'])('interpreta %s como marcado',value=>expect(hkCheckbox.parse(value)).toBe(true));
 it('admite la ausencia de una casilla dentro del formulario completo',()=>expect(z.object({requiresInspection:hkCheckbox}).parse({})).toEqual({requiresInspection:false}));
 it.each([null,1,'yes','undefined',{}])('rechaza valores no declarados',value=>expect(hkCheckbox.safeParse(value).success).toBe(false));
});
