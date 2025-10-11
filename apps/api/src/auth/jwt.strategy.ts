import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: { sub: number; privyDid: string; email: string }) {
    // The payload 'sub' now contains the integer user ID from our database.
    // We return the full user object to be attached to the request.
    // This could also involve another DB lookup if we want the most up-to-date user info.
    return { id: payload.sub, privyDid: payload.privyDid, email: payload.email };
  }
}
