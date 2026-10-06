import { redirect } from 'next/navigation';
import { operationalListHref } from '@/lib/list-navigation';
import type { RawSearchParams } from '@/lib/search-params';

/** Ruta histórica: conserva filtros y envía al lugar operativo canónico. */
export default async function LegacyHousekeepingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  redirect(operationalListHref('/housekeeping', await searchParams));
}
