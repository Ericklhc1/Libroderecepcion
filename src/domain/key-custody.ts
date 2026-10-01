export type AreaCountSnapshot = { areaId: string; name: string; expected: number; found: number; accountedElsewhere: number; outOfService: number; notes: string | null };
export type StaffCustodySnapshot = { humanId: number; departmentName: string; collaboratorName: string | null; authorizedByName: string; items: { keyCode: string; destinationId: string; destinationName: string; destinationKind: string }[] };
export function areaCountSnapshots(value: unknown): AreaCountSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is AreaCountSnapshot => v && typeof v.areaId === 'string' && typeof v.name === 'string' && ['expected','found','accountedElsewhere','outOfService'].every(k => Number.isInteger(v[k]) && v[k] >= 0));
}
export function staffCustodySnapshots(value: unknown): StaffCustodySnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is StaffCustodySnapshot => v && Number.isInteger(v.humanId) && typeof v.departmentName === 'string' && typeof v.authorizedByName === 'string' && Array.isArray(v.items) && v.items.every((i: Record<string,unknown>) => typeof i.keyCode === 'string' && typeof i.destinationName === 'string'));
}
