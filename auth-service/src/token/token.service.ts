import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class TokenService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(private config: ConfigService) {
    this.client = new Redis({
      host: config.get('redis.host'),
      port: config.get('redis.port'),
    });
  }

  async saveRefreshToken(userId: string, token: string, ttlSeconds = 604800): Promise<void> {
    await this.client.set(`refresh:${userId}`, token, 'EX', ttlSeconds);
  }

  async getRefreshToken(userId: string): Promise<string | null> {
    return this.client.get(`refresh:${userId}`);
  }

  async deleteRefreshToken(userId: string): Promise<void> {
    await this.client.del(`refresh:${userId}`);
  }

  async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    await this.client.set(`blacklist:${jti}`, '1', 'EX', ttlSeconds);
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const result = await this.client.get(`blacklist:${jti}`);
    return result !== null;
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}