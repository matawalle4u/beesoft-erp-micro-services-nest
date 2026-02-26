import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { TokenService } from '../token/token.service';
import { RegisterDto } from './dto/register.dto';
import { User } from '../users/users.entity';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private tokenService: TokenService,
    private config: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;
    const valid = await this.usersService.validatePassword(password, user.password);
    return valid ? user : null;
  }

  async register(dto: RegisterDto) {
    const user = await this.usersService.create(dto);
    return this.generateTokens(user);
  }

  async login(user: User) {
    return this.generateTokens(user);
  }

  async refresh(user: User) {
    return this.generateTokens(user);
  }

  async logout(userId: string, jti: string) {
    // Blacklist the current access token and remove refresh token
    const accessTtl = 15 * 60; // 15 minutes in seconds
    await Promise.all([
      this.tokenService.blacklistToken(jti, accessTtl),
      this.tokenService.deleteRefreshToken(userId),
    ]);
    return { message: 'Logged out successfully' };
  }

  async validateToken(token: string): Promise<{ valid: boolean; payload?: any }> {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.config.get('jwt.accessSecret'),
      });
      const blacklisted = await this.tokenService.isBlacklisted(payload.jti);
      return blacklisted ? { valid: false } : { valid: true, payload };
    } catch {
      return { valid: false };
    }
  }

  private async generateTokens(user: User) {
    const jti = uuidv4();
    const payload = { sub: user.id, email: user.email, roles: user.roles, jti };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get('jwt.accessSecret'),
        expiresIn: this.config.get('jwt.accessExpiresIn'),
      }),
      this.jwtService.signAsync({ sub: user.id }, {
        secret: this.config.get('jwt.refreshSecret'),
        expiresIn: this.config.get('jwt.refreshExpiresIn'),
      }),
    ]);

    // Store hashed refresh token
    const hashed = await bcrypt.hash(refreshToken, 10);
    await this.tokenService.saveRefreshToken(user.id, hashed);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, roles: user.roles },
    };
  }
}