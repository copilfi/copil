/**
 * Common Types Shared Across Interfaces
 * Centralized to avoid export conflicts and maintain consistency
 */

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface TimeWindow {
  duration: number; // seconds
  bucketSize: number; // seconds
}

export interface SecurityContext {
  userId: number;
  sessionId: string;
  permissions: string[];
  timestamp: Date;
  sourceIp?: string;
  userAgent?: string;
  riskScore?: number;
  mfaVerified?: boolean;
}

export interface IntegrityIssue {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: Date;
  affectedEvents: string[];
  affectedKeys?: string[];
}
