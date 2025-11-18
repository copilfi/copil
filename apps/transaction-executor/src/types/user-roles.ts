export type UserRole = 'admin' | 'operator' | 'user' | 'readonly';

export interface RolePermissions {
  role: UserRole;
  permissions: {
    canWithdraw: boolean;
    canSwap: boolean;
    canBridge: boolean;
    canManageKeys: boolean;
    canManageUsers: boolean;
    canAccessAdminPanel: boolean;
    maxDailyLimit: string; // in wei
    requiresMultiSig: boolean;
    multiSigThreshold: number; // Amount requiring multi-sig
  };
}

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions['permissions']> = {
  admin: {
    canWithdraw: true,
    canSwap: true,
    canBridge: true,
    canManageKeys: true,
    canManageUsers: true,
    canAccessAdminPanel: true,
    maxDailyLimit: '1000000000000000000000000', // 1M ETH
    requiresMultiSig: false,
    multiSigThreshold: 0,
  },
  operator: {
    canWithdraw: true,
    canSwap: true,
    canBridge: true,
    canManageKeys: false,
    canManageUsers: false,
    canAccessAdminPanel: true,
    maxDailyLimit: '100000000000000000000000', // 100K ETH
    requiresMultiSig: true,
    multiSigThreshold: 10000000000000000000000, // 10K ETH
  },
  user: {
    canWithdraw: true,
    canSwap: true,
    canBridge: true,
    canManageKeys: false,
    canManageUsers: false,
    canAccessAdminPanel: false,
    maxDailyLimit: '10000000000000000000000', // 10K ETH
    requiresMultiSig: true,
    multiSigThreshold: 1000000000000000000000, // 1K ETH
  },
  readonly: {
    canWithdraw: false,
    canSwap: false,
    canBridge: false,
    canManageKeys: false,
    canManageUsers: false,
    canAccessAdminPanel: false,
    maxDailyLimit: '0',
    requiresMultiSig: false,
    multiSigThreshold: 0,
  },
};

export interface UserWithRole {
  id: number;
  email: string;
  role: UserRole;
  permissions: RolePermissions['permissions'];
  dailyLimit?: bigint;
  isWhitelisted: boolean;
  allowedIPs: string[];
  trustedDevices: string[];
}
