const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export class BackendRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BackendRequestError';
  }
}

export function getApiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export async function backendFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const authorization = headers.get('Authorization') ?? headers.get('authorization');
  if (authorization?.startsWith('Bearer ') && !headers.has('x-session-token')) {
    headers.set('x-session-token', authorization.slice(7).trim());
  }

  let response: Response;

  try {
    response = await fetch(getApiUrl(path), {
      ...init,
      headers,
      cache: 'no-store',
    });
  } catch {
    throw new BackendRequestError(
      'Cannot reach the API. Try again in a moment.',
      502,
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof data?.message === 'string'
        ? data.message
        : Array.isArray(data?.message)
          ? data.message.join(', ')
          : 'Request failed';

    throw new BackendRequestError(message, response.status);
  }

  return data as T;
}

export function isUnauthorizedMessage(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes('unauthorized') ||
    normalized.includes('invalid or expired') ||
    normalized.includes('missing session') ||
    normalized.includes('missing admin session')
  );
}

export function errorStatusFromMessage(message: string): 401 | 400 | 500 {
  if (message.toLowerCase().includes('cannot reach')) {
    return 500;
  }

  return isUnauthorizedMessage(message) ? 401 : 500;
}
