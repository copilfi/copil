import { Injectable, Logger } from '@nestjs/common';
import { URL } from 'url';

/**
 * URL Validator Service to prevent SSRF (Server-Side Request Forgery) attacks
 */
@Injectable()
export class UrlValidatorService {
  private readonly logger = new Logger(UrlValidatorService.name);

  // Allowed URL schemes
  private readonly ALLOWED_SCHEMES = ['https'];

  // Blocked IP ranges (private networks, localhost, metadata servers)
  private readonly BLOCKED_IP_RANGES = [
    // Localhost
    { start: '127.0.0.0', end: '127.255.255.255' },
    // Private networks (RFC 1918)
    { start: '10.0.0.0', end: '10.255.255.255' },
    { start: '172.16.0.0', end: '172.31.255.255' },
    { start: '192.168.0.0', end: '192.168.255.255' },
    // Link-local
    { start: '169.254.0.0', end: '169.254.255.255' },
    // Loopback
    { start: '0.0.0.0', end: '0.255.255.255' },
    // Multicast
    { start: '224.0.0.0', end: '239.255.255.255' },
    // Reserved
    { start: '240.0.0.0', end: '255.255.255.255' },
  ];

  // Blocked hostnames
  private readonly BLOCKED_HOSTNAMES = [
    'localhost',
    'metadata.google.internal',
    '169.254.169.254', // AWS/GCP/Azure metadata server
    'metadata',
    'internal',
  ];

  // Whitelist of allowed domains (external APIs)
  private readonly ALLOWED_DOMAINS = [
    'auth.privy.io',
    'api.privy.io',
    'api.pimlico.io',
    'api.openai.com',
    'api.groq.com',
    'api.coingecko.com',
    'api.dexscreener.com',
    'quote-api.jup.ag',
    'api.hyperliquid.xyz',
    'api.alchemy.com',
    'li.quest', // Li.Fi API
  ];

  /**
   * Validate URL before making HTTP request
   * @param url URL to validate
   * @returns Validation result with reason if invalid
   */
  validateUrl(url: string): { valid: boolean; reason?: string } {
    try {
      const parsedUrl = new URL(url);

      // Check scheme
      if (!this.ALLOWED_SCHEMES.includes(parsedUrl.protocol.replace(':', ''))) {
        return {
          valid: false,
          reason: `Invalid URL scheme: ${parsedUrl.protocol}. Only HTTPS is allowed.`
        };
      }

      // Check hostname
      const hostname = parsedUrl.hostname.toLowerCase();

      // Check against blocked hostnames
      if (this.isBlockedHostname(hostname)) {
        this.logger.warn(`Blocked SSRF attempt to: ${hostname}`);
        return {
          valid: false,
          reason: `Access to ${hostname} is not allowed.`
        };
      }

      // Check if IP address
      if (this.isIpAddress(hostname)) {
        const blocked = this.isBlockedIpAddress(hostname);
        if (blocked) {
          this.logger.warn(`Blocked SSRF attempt to IP: ${hostname}`);
          return {
            valid: false,
            reason: `Access to IP address ${hostname} is not allowed.`
          };
        }
      }

      // Check against whitelist
      if (!this.isAllowedDomain(hostname)) {
        this.logger.warn(`Blocked request to non-whitelisted domain: ${hostname}`);
        return {
          valid: false,
          reason: `Domain ${hostname} is not in the allowed list.`
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: `Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Check if hostname is blocked
   */
  private isBlockedHostname(hostname: string): boolean {
    return this.BLOCKED_HOSTNAMES.some(blocked =>
      hostname === blocked || hostname.endsWith(`.${blocked}`)
    );
  }

  /**
   * Check if string is an IP address
   */
  private isIpAddress(hostname: string): boolean {
    // IPv4 pattern
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 pattern (simplified)
    const ipv6Pattern = /^[0-9a-fA-F:]+$/;

    return ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname);
  }

  /**
   * Check if IP address is in blocked ranges
   */
  private isBlockedIpAddress(ip: string): boolean {
    // Parse IP address
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      // If not valid IPv4, block it for safety
      return true;
    }

    const ipNum = (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];

    // Check against blocked ranges
    for (const range of this.BLOCKED_IP_RANGES) {
      const startParts = range.start.split('.').map(Number);
      const endParts = range.end.split('.').map(Number);

      const startNum = (startParts[0] << 24) + (startParts[1] << 16) + (startParts[2] << 8) + startParts[3];
      const endNum = (endParts[0] << 24) + (endParts[1] << 16) + (endParts[2] << 8) + endParts[3];

      if (ipNum >= startNum && ipNum <= endNum) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if domain is in the allowed list
   */
  private isAllowedDomain(hostname: string): boolean {
    return this.ALLOWED_DOMAINS.some(allowed =>
      hostname === allowed || hostname.endsWith(`.${allowed}`)
    );
  }

  /**
   * Add a domain to the whitelist dynamically (for testing or configuration)
   */
  addAllowedDomain(domain: string): void {
    if (!this.ALLOWED_DOMAINS.includes(domain.toLowerCase())) {
      this.ALLOWED_DOMAINS.push(domain.toLowerCase());
      this.logger.log(`Added ${domain} to allowed domains`);
    }
  }

  /**
   * Validate and sanitize URL before external fetch
   * @param url URL to validate
   * @param options Additional validation options
   * @returns Validated URL or throws error
   */
  validateAndSanitize(url: string, options?: {
    maxLength?: number;
    requireHttps?: boolean;
  }): string {
    const maxLength = options?.maxLength || 2048;
    const requireHttps = options?.requireHttps ?? true;

    // Check length
    if (url.length > maxLength) {
      throw new Error(`URL too long (max ${maxLength} characters)`);
    }

    // Validate URL
    const validation = this.validateUrl(url);
    if (!validation.valid) {
      throw new Error(`URL validation failed: ${validation.reason}`);
    }

    // Additional HTTPS check
    if (requireHttps && !url.startsWith('https://')) {
      throw new Error('Only HTTPS URLs are allowed');
    }

    return url;
  }

  /**
   * Create a safe fetch wrapper with URL validation
   */
  async safeFetch(url: string, options?: RequestInit & { timeout?: number }): Promise<Response> {
    // Validate URL first
    const validatedUrl = this.validateAndSanitize(url);

    // Set timeout (default 30 seconds)
    const timeout = options?.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(validatedUrl, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }

      throw error;
    }
  }
}