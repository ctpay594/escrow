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

export interface EscrowMerchantPreview {
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  real_balance: number;
}
