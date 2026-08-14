export interface AdminJwtPayload {
  sub: string;
  username: string;
  role: 'admin';
}

export interface AdminAuthResponse {
  admin: {
    id: string;
    username: string;
  };
  accessToken: string;
}
