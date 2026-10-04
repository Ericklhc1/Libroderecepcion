/** Una excepción revisada permite continuar, pero no acredita recepción física. */
export function handoverElementPending(element: {
  declared: boolean; confirmed: boolean; missingReason?: string | null; missingApprovedAt?: Date | string | null;
}) {
  return element.declared && !element.confirmed && !(element.missingReason && element.missingApprovedAt);
}
