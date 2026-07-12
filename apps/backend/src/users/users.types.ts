export interface UserRecord {
  id: string;
  username: string;
  password: string;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
}

export interface UserListItem {
  id: string;
  username: string;
  password: string;
  created_at: string;
  updated_at: string;
}
