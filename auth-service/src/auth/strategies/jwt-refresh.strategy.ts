import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../../users/users.service';
import { TokenService } from '../../token/token.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    config: ConfigService,
    private usersService: UsersService,
    private tokenService: TokenService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    } as any);
  }

  async validate(req: any, payload: { sub: string }) {
    const stored = await this.tokenService.getRefreshToken(payload.sub);
    if (!stored) throw new UnauthorizedException('Refresh token expired or not found');

    const incoming = req.body?.refreshToken;
    const isValid = await bcrypt.compare(incoming, stored);
    if (!isValid) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException('User not found');

    return user;
  }
}