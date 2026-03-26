export type SessionRole = string;

export interface SessionUser {
  uid: string;
  email?: string;
  name?: string;
  userId?: string;
  roles: SessionRole[];
  clinicIds: string[];
}

