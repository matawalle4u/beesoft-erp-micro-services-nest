import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { TokenService } from '../../token/token.service';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private usersService: UsersService,
    private tokenService: TokenService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret'),
      passReqToCallback: true,
    } as any);
  }

  async validate(req: any, payload: JwtPayload) {
    // Check token blacklist (for logout)
    if (await this.tokenService.isBlacklisted(payload.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return { id: user.id, email: user.email, roles: user.roles, jti: payload.jti };
  }
}