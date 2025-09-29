import crypto from 'crypto';
import { logger } from '@/utils/logger';
import env from '@/config/env';

export interface SecurityEvent {
  id: string;
  type: 'login' | 'api_access' | 'failed_auth' | 'suspicious_activity' | 'admin_action';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId?: string;
  ipAddress: string;
  userAgent?: string;
  details: Record<string, any>;
  timestamp: Date;
}

export interface SecurityAlert {
  id: string;
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metadata: Record<string, any>;
  resolved: boolean;
  createdAt: Date;
}

export class SecurityService {
  private suspiciousIPs = new Map<string, number>();
  private failedAttempts = new Map<string, { count: number; lastAttempt: Date }>();
  private securityEvents: SecurityEvent[] = [];
  private maxEventsHistory = 10000;

  constructor() {
    // Clean up old events periodically
    setInterval(() => {
      this.cleanupOldEvents();
      this.cleanupFailedAttempts();
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Log security event
   */
  async logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<void> {
    const securityEvent: SecurityEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date()
    };

    this.securityEvents.push(securityEvent);

    // Keep only recent events
    if (this.securityEvents.length > this.maxEventsHistory) {
      this.securityEvents = this.securityEvents.slice(-this.maxEventsHistory / 2);
    }

    // Analyze for suspicious patterns
    await this.analyzeSecurityEvent(securityEvent);

    logger.info(`Security event logged: ${event.type} from ${event.ipAddress}`, {
      securityEvent
    });

    // Persistence layer not implemented in current schema
  }

  /**
   * Record failed authentication attempt
   */
  recordFailedAuth(ipAddress: string, userAgent?: string, userId?: string): void {
    const key = `${ipAddress}_${userId || 'unknown'}`;
    const existing = this.failedAttempts.get(key);
    
    const failedAttempt = {
      count: existing ? existing.count + 1 : 1,
      lastAttempt: new Date()
    };

    this.failedAttempts.set(key, failedAttempt);

    this.logSecurityEvent({
      type: 'failed_auth',
      severity: failedAttempt.count > 5 ? 'high' : 'medium',
      userId,
      ipAddress,
      userAgent,
      details: {
        attemptCount: failedAttempt.count,
        consecutiveFailures: true
      }
    });

    // Block IP after too many failures
    if (failedAttempt.count >= 10) {
      this.addSuspiciousIP(ipAddress, 'too_many_failed_auths');
    }
  }

  /**
   * Check if IP is blocked
   */
  isIPBlocked(ipAddress: string): boolean {
    const suspiciousLevel = this.suspiciousIPs.get(ipAddress) || 0;
    return suspiciousLevel >= 100; // Block threshold
  }

  /**
   * Add suspicious IP
   */
  addSuspiciousIP(ipAddress: string, reason: string): void {
    const currentLevel = this.suspiciousIPs.get(ipAddress) || 0;
    let increment = 0;

    switch (reason) {
      case 'too_many_failed_auths':
        increment = 50;
        break;
      case 'suspicious_pattern':
        increment = 30;
        break;
      case 'malicious_request':
        increment = 100; // Immediate block
        break;
      default:
        increment = 10;
    }

    const newLevel = currentLevel + increment;
    this.suspiciousIPs.set(ipAddress, newLevel);

    logger.warn(`IP ${ipAddress} marked as suspicious (level: ${newLevel}): ${reason}`);

    this.logSecurityEvent({
      type: 'suspicious_activity',
      severity: newLevel >= 100 ? 'critical' : 'high',
      ipAddress,
      details: {
        reason,
        suspiciousLevel: newLevel,
        blocked: newLevel >= 100
      }
    });
  }

  /**
   * Analyze security event for patterns
   */
  private async analyzeSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      // Check for rapid successive events from same IP
      const recentEventsFromIP = this.securityEvents
        .filter(e => 
          e.ipAddress === event.ipAddress &&
          Date.now() - e.timestamp.getTime() < 60000 // Last minute
        );

      if (recentEventsFromIP.length > 20) {
        this.addSuspiciousIP(event.ipAddress, 'rapid_requests');
      }

      // Check for failed auth patterns
      const recentFailedAuths = this.securityEvents
        .filter(e => 
          e.type === 'failed_auth' &&
          e.ipAddress === event.ipAddress &&
          Date.now() - e.timestamp.getTime() < 300000 // Last 5 minutes
        );

      if (recentFailedAuths.length > 5) {
        this.addSuspiciousIP(event.ipAddress, 'auth_brute_force');
      }

      // Check for suspicious user agent patterns
      if (event.userAgent) {
        const suspiciousPatterns = [
          /bot/i,
          /crawler/i,
          /scanner/i,
          /python-requests/i,
          /curl/i
        ];

        const isSuspiciousAgent = suspiciousPatterns.some(pattern => 
          pattern.test(event.userAgent!)
        );

        if (isSuspiciousAgent && event.type !== 'api_access') {
          this.addSuspiciousIP(event.ipAddress, 'suspicious_user_agent');
        }
      }

    } catch (error) {
      logger.error('Error analyzing security event:', error);
    }
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics(): {
    totalEvents: number;
    recentEvents: number;
    blockedIPs: number;
    suspiciousIPs: number;
    eventsByType: Record<string, number>;
    eventsBySeverity: Record<string, number>;
  } {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    const recentEvents = this.securityEvents.filter(e => 
      e.timestamp.getTime() > oneHourAgo
    );

    const eventsByType = this.securityEvents.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const eventsBySeverity = this.securityEvents.reduce((acc, event) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const blockedIPs = Array.from(this.suspiciousIPs.entries())
      .filter(([, level]) => level >= 100).length;

    const suspiciousIPs = Array.from(this.suspiciousIPs.entries())
      .filter(([, level]) => level >= 30 && level < 100).length;

    return {
      totalEvents: this.securityEvents.length,
      recentEvents: recentEvents.length,
      blockedIPs,
      suspiciousIPs,
      eventsByType,
      eventsBySeverity
    };
  }

  /**
   * Get security events
   */
  getSecurityEvents(limit = 100): SecurityEvent[] {
    return this.securityEvents
      .slice(-limit)
      .reverse(); // Most recent first
  }

  /**
   * Clear suspicious IP
   */
  clearSuspiciousIP(ipAddress: string): void {
    this.suspiciousIPs.delete(ipAddress);
    this.failedAttempts.delete(ipAddress);
    
    logger.info(`Cleared suspicious status for IP: ${ipAddress}`);
  }

  /**
   * Encrypt sensitive data
   */
  encryptData(data: string): { encrypted: string; iv: string } {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(env.JWT_SECRET, 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      encrypted,
      iv: iv.toString('hex')
    };
  }

  /**
   * Decrypt sensitive data
   */
  decryptData(encrypted: string, iv: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(env.JWT_SECRET, 'salt', 32);
    
    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Generate secure random token
   */
  generateSecureToken(length = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash password with salt
   */
  hashPassword(password: string): { hash: string; salt: string } {
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    
    return { hash, salt };
  }

  /**
   * Verify password
   */
  verifyPassword(password: string, hash: string, salt: string): boolean {
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  }

  /**
   * Clean up old events
   */
  private cleanupOldEvents(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    
    this.securityEvents = this.securityEvents.filter(event => 
      event.timestamp.getTime() > cutoff
    );

    logger.debug(`Cleaned up old security events, ${this.securityEvents.length} remaining`);
  }

  /**
   * Clean up old failed attempts
   */
  private cleanupFailedAttempts(): void {
    const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour ago
    
    for (const [key, attempt] of this.failedAttempts.entries()) {
      if (attempt.lastAttempt.getTime() < cutoff) {
        this.failedAttempts.delete(key);
      }
    }

    // Reduce suspicious IP levels over time
    for (const [ip, level] of this.suspiciousIPs.entries()) {
      if (level > 0) {
        const newLevel = Math.max(0, level - 5); // Reduce by 5 every hour
        if (newLevel === 0) {
          this.suspiciousIPs.delete(ip);
        } else {
          this.suspiciousIPs.set(ip, newLevel);
        }
      }
    }
  }
}

export default SecurityService;
