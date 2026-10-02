import {z} from 'zod';
/** Missing HTML checkboxes are false. Required inspection is enforced separately by the service. */
export const hkCheckbox = z.union([z.boolean(),z.enum(['on','off','true','false',''])]).optional().transform(value=>value===true||value==='true'||value==='on');
