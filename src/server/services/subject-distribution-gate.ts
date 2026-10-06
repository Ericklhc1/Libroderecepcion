import 'server-only';
import {RuleError} from '@/server/errors';

/** Off until a published, verified plural-reader recovery artifact exists. No production setting is written here. */
export function subjectDistributionEnabled(){return process.env.AROH_SUBJECT_AREA_DISTRIBUTION_ENABLED==='true';}
export function assertSubjectDistributionEnabled(){
  if(!subjectDistributionEnabled())throw new RuleError('La nueva distribución por áreas aún no está habilitada. Puedes consultar los resultados existentes y continuar la atención nativa.');
}
