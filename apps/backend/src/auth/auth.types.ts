export interface JwtPayload {
  sub: string;
  username: string;
}

export interface AuthResponse {
  user: {
    id: string;
    username: string;
  };
  accessToken: string;
}
