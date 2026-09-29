export function isSameOriginMutation(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== expected) return false;

  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;

  return true;
}
