import 'server-only';
import type { Prisma } from '@prisma/client';

/** One eligibility rule for selectors, writes, publication and coverage.
 * Historical assignments remain readable even when their person is ineligible. */
export const eligibleScheduleAccountWhere = {
  active: true,
  deletedAt: null,
  hiddenFromSelectors: false,
  role: { operational: true },
} satisfies Prisma.UserWhereInput;

export function eligibleScheduleCollaboratorWhere(departmentId: string): Prisma.ScheduleCollaboratorWhereInput {
  return {
    active: true,
    user: { is: eligibleScheduleAccountWhere },
    memberships: { some: { departmentId, active: true, department: { active: true } } },
  };
}
