import type { Settings } from './shared';

export class ApiError extends Error {}

export async function api<T>(
  settings: Settings,
  path: string,
  init: RequestInit = {},
  auth = true,
): Promise<{ status: number; data: T }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (auth) {
    if (!settings.userId) throw new ApiError('Not connected. Open Settings and connect your account.');
    headers.set('x-user-id', settings.userId);
  }
  let res: Response;
  try {
    res = await fetch(`${settings.apiUrl.replace(/\/$/, '')}/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiError(`Cannot reach the API at ${settings.apiUrl}`);
  }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`);
  return { status: res.status, data: body as T };
}
