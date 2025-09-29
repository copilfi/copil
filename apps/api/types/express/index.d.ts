import type { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface AuthenticatedUser {
      id: string;
      address: `0x${string}`;
      walletAddress: `0x${string}`;
      email?: string;
      permissions?: string[];
      sessions?: Array<{ id: string; createdAt: Date; expiresAt: Date | null }>;
    }

    interface Request {
      user?: AuthenticatedUser;
      sessionID?: string;
      files?: Record<string, unknown>;
      authTokenPayload?: JwtPayload & { userId: string };
    }
  }
}

export {};
