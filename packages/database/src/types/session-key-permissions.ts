export type SessionActionType = 'swap' | 'bridge' | 'custom';

export interface SessionKeyPermissions {
  actions?: SessionActionType[];
  chains?: string[];
  notes?: string;
}
