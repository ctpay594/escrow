export interface AdminRecord {
  id: string;
  username: string;
  password: string;
  created_at: string;
  updated_at: string;
}

export interface PublicAdmin {
  id: string;
  username: string;
}
