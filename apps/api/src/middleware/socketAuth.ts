import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import TokenService from '@/services/TokenService';
import AdvancedRateLimiter from '@/middleware/rateLimiter';

export interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    address: string;
    email?: string;
  };
  isAuthenticated: boolean;
  rateLimitKey?: string;
}

export interface SocketRateLimit {
  requests: number;
  resetTime: number;
}

export class SocketAuthService {
  private static readonly RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
  private static readonly MAX_REQUESTS_PER_MINUTE = 60;
  private static readonly MAX_CONNECTIONS_PER_IP = 10;
  
  private static socketRateLimits = new Map<string, SocketRateLimit>();
  private static ipConnections = new Map<string, Set<string>>();

  /**
   * WebSocket authentication middleware
   */
  static authenticate() {
    return async (socket: AuthenticatedSocket, next: (err?: Error) => void) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        const clientIP = this.getSocketIP(socket);

        // Check IP connection limits
        if (!this.checkIPConnectionLimit(clientIP, socket.id)) {
          return next(new Error('Too many connections from this IP'));
        }

        // Rate limiting per IP
        if (!this.checkRateLimit(clientIP)) {
          return next(new Error('Rate limit exceeded'));
        }

        if (!token) {
          // Allow anonymous connections with limited permissions
          socket.isAuthenticated = false;
          socket.rateLimitKey = `anon:${clientIP}`;
          logger.info(`Anonymous socket connection: ${socket.id} from ${clientIP}`);
          return next();
        }

        // Verify JWT token
        const decoded = await TokenService.verifyAccessToken(token);
        if (!decoded) {
          logger.warn(`Invalid token for socket ${socket.id}`);
          return next(new Error('Invalid token'));
        }

        // Set user information
        socket.user = {
          id: decoded.userId,
          address: decoded.address,
          email: decoded.email
        };
        socket.isAuthenticated = true;
        socket.rateLimitKey = `user:${decoded.userId}`;

        logger.info(`Authenticated socket connection: ${socket.id} for user ${decoded.userId}`);
        next();

      } catch (error) {
        logger.error('Socket authentication error:', error);
        next(new Error('Authentication failed'));
      }
    };
  }

  /**
   * Check if user has permission for specific action
   */
  static requireAuth() {
    return (socket: AuthenticatedSocket, next: (err?: Error) => void) => {
      if (!socket.isAuthenticated || !socket.user) {
        return next(new Error('Authentication required'));
      }
      next();
    };
  }

  /**
   * Rate limiting middleware for socket events
   */
  static rateLimit(maxRequests: number = 10, windowMs: number = 60000) {
    return (socket: AuthenticatedSocket, next: (err?: Error) => void) => {
      const key = socket.rateLimitKey || `socket:${socket.id}`;
      
      if (!this.checkEventRateLimit(key, maxRequests, windowMs)) {
        logger.warn(`Rate limit exceeded for socket ${socket.id}`);
        return next(new Error('Rate limit exceeded'));
      }
      
      next();
    };
  }

  /**
   * Validate and sanitize socket event data
   */
  static validateEventData(allowedEvents: string[]) {
    return (eventName: string, data: any, socket: AuthenticatedSocket, next: (err?: Error) => void) => {
      try {
        // Check if event is allowed
        if (!allowedEvents.includes(eventName)) {
          logger.warn(`Unauthorized event: ${eventName} from socket ${socket.id}`);
          return next(new Error('Unauthorized event'));
        }

        // Basic data validation
        if (data && typeof data === 'object') {
          // Check for prototype pollution
          if (data.hasOwnProperty('__proto__') || data.hasOwnProperty('constructor')) {
            logger.error('Prototype pollution attempt detected');
            return next(new Error('Invalid data'));
          }

          // Sanitize string data
          this.sanitizeSocketData(data);
        }

        // Check data size
        const dataSize = JSON.stringify(data || {}).length;
        if (dataSize > 10000) { // 10KB limit
          return next(new Error('Data too large'));
        }

        next();
      } catch (error) {
        logger.error('Event validation error:', error);
        next(new Error('Data validation failed'));
      }
    };
  }

  /**
   * Connection cleanup on disconnect
   */
  static onDisconnect(socket: AuthenticatedSocket) {
    return () => {
      const clientIP = this.getSocketIP(socket);
      
      // Remove from IP connections tracking
      const ipSet = this.ipConnections.get(clientIP);
      if (ipSet) {
        ipSet.delete(socket.id);
        if (ipSet.size === 0) {
          this.ipConnections.delete(clientIP);
        }
      }

      logger.info(`Socket disconnected: ${socket.id} ${socket.user ? `(user: ${socket.user.id})` : '(anonymous)'}`);
    };
  }

  /**
   * Get client IP from socket
   */
  private static getSocketIP(socket: Socket): string {
    const forwarded = socket.handshake.headers['x-forwarded-for'] as string;
    const realIP = socket.handshake.headers['x-real-ip'] as string;
    const cloudflareIP = socket.handshake.headers['cf-connecting-ip'] as string;
    
    return (
      cloudflareIP ||
      realIP ||
      (forwarded ? forwarded.split(',')[0].trim() : '') ||
      socket.handshake.address ||
      'unknown'
    );
  }

  /**
   * Check IP connection limits
   */
  private static checkIPConnectionLimit(clientIP: string, socketId: string): boolean {
    let ipSet = this.ipConnections.get(clientIP);
    
    if (!ipSet) {
      ipSet = new Set();
      this.ipConnections.set(clientIP, ipSet);
    }
    
    if (ipSet.size >= this.MAX_CONNECTIONS_PER_IP && !ipSet.has(socketId)) {
      return false;
    }
    
    ipSet.add(socketId);
    return true;
  }

  /**
   * Basic rate limiting check
   */
  private static checkRateLimit(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.RATE_LIMIT_WINDOW;
    
    let rateLimit = this.socketRateLimits.get(key);
    
    if (!rateLimit || rateLimit.resetTime < windowStart) {
      rateLimit = { requests: 1, resetTime: now + this.RATE_LIMIT_WINDOW };
      this.socketRateLimits.set(key, rateLimit);
      return true;
    }
    
    if (rateLimit.requests >= this.MAX_REQUESTS_PER_MINUTE) {
      return false;
    }
    
    rateLimit.requests++;
    return true;
  }

  /**
   * Rate limit for specific events
   */
  private static checkEventRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    let rateLimit = this.socketRateLimits.get(`event:${key}`);
    
    if (!rateLimit || rateLimit.resetTime < windowStart) {
      rateLimit = { requests: 1, resetTime: now + windowMs };
      this.socketRateLimits.set(`event:${key}`, rateLimit);
      return true;
    }
    
    if (rateLimit.requests >= maxRequests) {
      return false;
    }
    
    rateLimit.requests++;
    return true;
  }

  /**
   * Sanitize socket event data
   */
  private static sanitizeSocketData(data: any): void {
    if (typeof data === 'string') {
      // Remove potential XSS patterns
      data = data.replace(/[<>]/g, '');
    } else if (Array.isArray(data)) {
      data.forEach(item => this.sanitizeSocketData(item));
    } else if (data && typeof data === 'object') {
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          this.sanitizeSocketData(data[key]);
        }
      }
    }
  }

  /**
   * Cleanup expired rate limits
   */
  static cleanupRateLimits(): void {
    const now = Date.now();
    
    for (const [key, rateLimit] of this.socketRateLimits.entries()) {
      if (rateLimit.resetTime < now) {
        this.socketRateLimits.delete(key);
      }
    }
    
    logger.debug('Cleaned up expired socket rate limits');
  }

  /**
   * Get connection statistics
   */
  static getConnectionStats(): {
    totalConnections: number;
    authenticatedConnections: number;
    anonymousConnections: number;
    ipConnections: number;
  } {
    let totalConnections = 0;
    let authenticatedConnections = 0;
    
    for (const ipSet of this.ipConnections.values()) {
      totalConnections += ipSet.size;
    }
    
    return {
      totalConnections,
      authenticatedConnections,
      anonymousConnections: totalConnections - authenticatedConnections,
      ipConnections: this.ipConnections.size
    };
  }
}

export default SocketAuthService;