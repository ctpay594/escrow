const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export function getApiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export async function backendFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(getApiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof data?.message === 'string'
        ? data.message
        : Array.isArray(data?.message)
          ? data.message.join(', ')
          : 'Request failed';

    throw new Error(message);
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
  return isUnauthorizedMessage(message) ? 401 : 500;
}
