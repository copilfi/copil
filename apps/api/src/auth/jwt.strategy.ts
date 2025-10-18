import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private jwksCache: { byKid: Map<string, { pem: string; fetchedAt: number }>; allFetchedAt?: number } = { byKid: new Map() };

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
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
    const issuer: string | undefined = typeof payload?.iss === 'string' ? payload.iss : undefined;
    const isPrivy = Boolean(issuer && issuer.includes('auth.privy.io'));

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
      // As last resort, use internal secret (not recommended for Privy tokens)
      const fallback = this.configService.get<string>('JWT_SECRET');
      if (!fallback) throw new Error('No verification key available for JWT.');
      return fallback;
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
      const res = await fetch(jwksUrl);
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

  async validate(payload: any) {
    // Internal tokens: payload.sub is numeric user id
    if (typeof payload?.sub === 'number') {
      return { id: payload.sub, privyDid: payload.privyDid, email: payload.email };
    }

    // Privy tokens: create or find user by Privy DID
    if (!(typeof payload?.iss === 'string' && payload.iss.includes('auth.privy.io'))) {
      throw new Error('Invalid token issuer.');
    }
    const privyDid: string | undefined = typeof payload?.sub === 'string' ? payload.sub : undefined;
    if (!privyDid) {
      throw new Error('Invalid token payload: missing subject.');
    }
    const email: string = typeof payload?.email === 'string' ? payload.email : 'user@privy.local';
    const user = await this.authService.findOrCreateUser(privyDid, email);
    return { id: user.id, privyDid: user.privyDid, email: user.email };
  }
}
