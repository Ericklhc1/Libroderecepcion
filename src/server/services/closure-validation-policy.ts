import type {Prisma} from '@prisma/client';

/** Historical closure signals stay in history, outside reception work. */
export const closureValidationAlertWhere:Prisma.AlertWhereInput={dedupeKey:{startsWith:'shift-validation:'}};
