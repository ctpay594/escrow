export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
} as const;

export function clearSessionCookie(
  response: { cookies: { set: (name: string, value: string, options?: object) => void } },
  cookieName: string,
) {
  response.cookies.set(cookieName, '', {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
