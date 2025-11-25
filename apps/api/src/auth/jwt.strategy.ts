import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UrlValidatorService } from '../common/url-validator.service';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private jwksCache: { byKid: Map<string, { pem: string; fetchedAt: number }>; allFetchedAt?: number } = { byKid: new Map() };

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly urlValidator: UrlValidatorService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
      // Support both ES256 (Privy) and HS256 (internal JWT)
      algorithms: ['ES256', 'HS256'],
      secretOrKeyProvider: async (_req: any, rawJwtToken: string, done: (err: any, secret?: string | Buffer) => void) => {
        try {
          const secret = await this.resolveSecretOrKey(rawJwtToken);
          return done(null, secret);
        } catch (e) {
          return done(e as Error);
        }
      },
    });
  }

  private base64urlDecode(input: string): string {
    input = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = input.length % 4;
    if (pad) input += '='.repeat(4 - pad);
    return Buffer.from(input, 'base64').toString('utf8');
  }

  private decodeJwt(raw: string): { header: any; payload: any } {
    const parts = raw.split('.');
    if (parts.length < 2) throw new Error('Invalid JWT format');
    const header = JSON.parse(this.base64urlDecode(parts[0]));
    const payload = JSON.parse(this.base64urlDecode(parts[1]));
    return { header, payload };
  }

  private async resolveSecretOrKey(rawJwtToken: string): Promise<string | Buffer> {
    const { header, payload } = this.decodeJwt(rawJwtToken);
    this.logger.debug(`JWT header: ${JSON.stringify(header)}`);
    this.logger.debug(`JWT payload issuer: ${payload?.iss}, sub: ${payload?.sub}, aud: ${payload?.aud}`);
    const issuer: string | undefined = typeof payload?.iss === 'string' ? payload.iss : undefined;
    // Support both old (auth.privy.io) and new (privy.io) issuer formats
    const isPrivy = Boolean(issuer && (issuer.includes('privy.io')));
    this.logger.debug(`Is Privy token: ${isPrivy}`);

    // Prefer Privy PEM if available for tokens issued by Privy
    if (isPrivy) {
      const pem = this.configService.get<string>('PRIVY_PUBLIC_KEY_PEM');
      if (pem && pem.includes('BEGIN PUBLIC KEY')) {
        return pem;
      }
      // Try JWKS endpoint if provided
      const jwksUrl = this.configService.get<string>('PRIVY_JWKS_ENDPOINT');
      if (jwksUrl) {
        const kid: string | undefined = typeof header?.kid === 'string' ? header.kid : undefined;
        const pemFromJwks = await this.getPemFromJwks(jwksUrl, kid);
        if (pemFromJwks) {
          return pemFromJwks;
        }
        this.logger.warn('JWKS lookup failed; falling back to JWT_SECRET for this request.');
      }
      // No fallback for Privy tokens - must have proper PEM or JWKS
      throw new Error('No Privy public key configured. Set PRIVY_PUBLIC_KEY_PEM or PRIVY_JWKS_ENDPOINT.');
    }

    // Internal app JWTs
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET is not configured.');
    return secret;
  }

  private async getPemFromJwks(jwksUrl: string, kid?: string): Promise<string | null> {
    // Cached by kid
    if (kid && this.jwksCache.byKid.has(kid)) {
      const cached = this.jwksCache.byKid.get(kid)!;
      // 10 minute TTL
      if (Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
        return cached.pem;
      }
    }

    try {
      // Validate URL to prevent SSRF
      const validation = this.urlValidator.validateUrl(jwksUrl);
      if (!validation.valid) {
        this.logger.error(`JWKS URL validation failed: ${validation.reason}`);
        return null;
      }

      // Use safe fetch with timeout
      const res = await this.urlValidator.safeFetch(jwksUrl, { timeout: 10000 });
      if (!res.ok) {
        this.logger.warn(`JWKS fetch failed with HTTP ${res.status}`);
        return null;
      }
      const { keys } = (await res.json()) as { keys?: any[] };
      if (!Array.isArray(keys) || keys.length === 0) {
        this.logger.warn('JWKS payload missing keys');
        return null;
      }
      let jwk = kid ? keys.find((k) => k.kid === kid) : keys[0];
      if (!jwk) {
        this.logger.warn(`JWKS kid ${kid} not found; using first key`);
        jwk = keys[0];
      }
      // Prefer x5c if present
      if (Array.isArray(jwk.x5c) && jwk.x5c.length > 0) {
        const certB64: string = jwk.x5c[0];
        const pem = this.certPemFromX5c(certB64);
        if (kid) this.jwksCache.byKid.set(kid, { pem, fetchedAt: Date.now() });
        return pem;
      }
      // Otherwise, require pre-configured PEM
      this.logger.warn('JWKS did not contain x5c; please set PRIVY_PUBLIC_KEY_PEM env.');
      return null;
    } catch (e) {
      this.logger.error(`JWKS fetch error: ${(e as Error).message}`);
      return null;
    }
  }

  private certPemFromX5c(certB64: string): string {
    // Format certificate into PEM with 64-char line breaks
    const body = certB64.match(/.{1,64}/g)?.join('\n') ?? certB64;
    return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
  }

  async validate(req: Request, payload: any) {
    // Log all authentication attempts for security auditing
    this.logger.log(`Authentication attempt - iss: ${payload?.iss}, sub: ${payload?.sub}`);

    // Internal tokens: payload.sub is numeric user id
    if (typeof payload?.sub === 'number') {
      return { id: payload.sub, privyDid: payload.privyDid, email: payload.email };
    }

    // Privy tokens: strict validation with no bypass
    const issuer = payload?.iss;

    // Strict issuer validation - must be from Privy (supports both old and new formats)
    const validIssuers = ['https://auth.privy.io', 'auth.privy.io', 'privy.io', 'https://privy.io'];
    if (!(typeof issuer === 'string' && validIssuers.some(valid => issuer === valid || issuer.includes('privy.io')))) {
      this.logger.error(`Invalid token issuer: ${issuer}`);
      throw new Error('Invalid token issuer - must be from privy.io');
    }

    // Verify audience matches our app
    const expectedAud = this.configService.get<string>('PRIVY_APP_ID') || this.configService.get<string>('PRIVY_EXPECT_AUD');
    if (!expectedAud) {
      this.logger.error('PRIVY_APP_ID not configured - authentication disabled');
      throw new Error('Privy authentication not properly configured');
    }

    const aud = payload?.aud;
    const audOk = Array.isArray(aud) ? aud.includes(expectedAud) : aud === expectedAud;
    if (!audOk) {
      this.logger.error(`Invalid token audience. Expected: ${expectedAud}, Got: ${aud}`);
      throw new Error('Invalid token audience.');
    }

    // Validate subject (Privy DID)
    const privyDid: string | undefined = typeof payload?.sub === 'string' ? payload.sub : undefined;
    if (!privyDid || !privyDid.startsWith('did:privy:')) {
      this.logger.error(`Invalid Privy DID format: ${privyDid}`);
      throw new Error('Invalid token payload: missing or malformed Privy DID.');
    }

    // Check token timing
    const nowSec = Math.floor(Date.now() / 1000);

    // Not before check
    if (typeof payload?.nbf === 'number' && nowSec < payload.nbf) {
      throw new Error('Token not yet valid.');
    }

    // Expiration check (redundant but explicit)
    if (typeof payload?.exp === 'number' && nowSec >= payload.exp) {
      throw new Error('Token has expired.');
    }

    // Issued at check - reject tokens issued too far in the past (potential replay)
    if (typeof payload?.iat === 'number') {
      const maxAge = 24 * 60 * 60; // 24 hours
      if (nowSec - payload.iat > maxAge) {
        this.logger.warn(`Token too old - issued ${nowSec - payload.iat} seconds ago`);
        throw new Error('Token is too old. Please re-authenticate.');
      }
    }

    const email: string = typeof payload?.email === 'string' ? payload.email : 'user@privy.local';
    const walletAddress = this.extractWalletAddress(req);
    const user = await this.authService.findOrCreateUser(privyDid, email, walletAddress);

    this.logger.log(`Authentication successful for user ${user.id} (${privyDid})`);
    return { id: user.id, privyDid: user.privyDid, email: user.email };
  }

  private extractWalletAddress(req: Request): string | undefined {
    try {
      const body = (req as any)?.body;
      if (body && typeof body.walletAddress === 'string' && body.walletAddress.length > 0) {
        return body.walletAddress;
      }
    } catch (e) {
      this.logger.warn(`Failed to read wallet address from request body: ${(e as Error).message}`);
    }
    return undefined;
  }
}
