import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { prisma } from '@/config/database';

export interface IPWhitelistConfig {
  enabled: boolean;
  allowedIPs: string[];
  allowedRanges: string[];
  adminIPs: string[];
}

// Default IP whitelist configuration
const defaultConfig: IPWhitelistConfig = {
  enabled: process.env.NODE_ENV === 'production',
  allowedIPs: [
    '127.0.0.1',
    '::1',
    'localhost'
  ],
  allowedRanges: [
    '10.0.0.0/8',    // Private network
    '172.16.0.0/12', // Private network
    '192.168.0.0/16' // Private network
  ],
  adminIPs: [
    '127.0.0.1',
    '::1'
  ]
};

// Parse CIDR notation
function isIPInRange(ip: string, range: string): boolean {
  const [rangeIP, prefixLength] = range.split('/');
  const prefix = parseInt(prefixLength, 10);
  
  // Convert IP to integer for comparison
  const ipToInt = (ipStr: string): number => {
    return ipStr.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  };
  
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(rangeIP);
  const mask = (-1 << (32 - prefix)) >>> 0;
  
  return (ipInt & mask) === (rangeInt & mask);
}

// Get client IP address
function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'] as string;
  const realIP = req.headers['x-real-ip'] as string;
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIP) {
    return realIP;
  }
  
  return req.socket.remoteAddress || req.connection.remoteAddress || req.ip || '0.0.0.0';
}

// Check if IP is allowed
function isIPAllowed(ip: string, config: IPWhitelistConfig): boolean {
  // Check direct IP matches
  if (config.allowedIPs.includes(ip)) {
    return true;
  }
  
  // Check IP ranges
  for (const range of config.allowedRanges) {
    if (isIPInRange(ip, range)) {
      return true;
    }
  }
  
  return false;
}

// IP whitelist middleware for general access
export const ipWhitelist = (customConfig?: Partial<IPWhitelistConfig>) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const config = { ...defaultConfig, ...customConfig };
    
    if (!config.enabled) {
      next();
      return;
    }
    
    const clientIP = getClientIP(req);
    
    try {
      // Check database for dynamic IP whitelist
      const dbWhitelist = await prisma.iPWhitelist.findMany({
        where: { isActive: true },
        select: { ipAddress: true, ipRange: true }
      });
      
      // Add database IPs to allowed list
      const dbAllowedIPs = dbWhitelist
        .filter(entry => entry.ipAddress)
        .map(entry => entry.ipAddress!);
      
      const dbAllowedRanges = dbWhitelist
        .filter(entry => entry.ipRange)
        .map(entry => entry.ipRange!);
      
      const extendedConfig = {
        ...config,
        allowedIPs: [...config.allowedIPs, ...dbAllowedIPs],
        allowedRanges: [...config.allowedRanges, ...dbAllowedRanges]
      };
      
      if (isIPAllowed(clientIP, extendedConfig)) {
        next();
        return;
      }
      
      // Log unauthorized access attempt
      logger.warn(`Unauthorized IP access attempt: ${clientIP} to ${req.method} ${req.path}`);
      
      res.status(403).json({
        success: false,
        error: 'Access denied: IP not whitelisted'
      });
      
    } catch (error) {
      logger.error('IP whitelist error:', error);
      
      // Fallback to static config on database error
      if (isIPAllowed(clientIP, config)) {
        next();
        return;
      }
      
      res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
  };
};

// Strict IP whitelist for admin operations
export const adminIPWhitelist = () => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIP = getClientIP(req);
    
    if (!defaultConfig.adminIPs.includes(clientIP)) {
      logger.warn(`Unauthorized admin access attempt from IP: ${clientIP}`);
      res.status(403).json({
        success: false,
        error: 'Admin access denied: IP not authorized'
      });
      return;
    }
    
    next();
  };
};

// Middleware to add IP to whitelist (admin only)
export const addIPToWhitelist = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { ipAddress, ipRange, description } = req.body;
    
    if (!ipAddress && !ipRange) {
      res.status(400).json({
        success: false,
        error: 'Either ipAddress or ipRange is required'
      });
      return;
    }
    
    await prisma.iPWhitelist.create({
      data: {
        ipAddress: ipAddress || null,
        ipRange: ipRange || null,
        description: description || 'Added via API',
        isActive: true,
        createdAt: new Date()
      }
    });
    
    logger.info(`IP ${ipAddress || ipRange} added to whitelist`);
    
    res.json({
      success: true,
      message: 'IP added to whitelist successfully'
    });
    
  } catch (error) {
    logger.error('Error adding IP to whitelist:', error);
    next(error);
  }
};

// Get current client IP (utility endpoint)
export const getClientIPEndpoint = (req: Request, res: Response): void => {
  const clientIP = getClientIP(req);
  
  res.json({
    success: true,
    clientIP,
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'remote-address': req.socket.remoteAddress
    }
  });
};

export default {
  ipWhitelist,
  adminIPWhitelist,
  addIPToWhitelist,
  getClientIPEndpoint,
  getClientIP
};