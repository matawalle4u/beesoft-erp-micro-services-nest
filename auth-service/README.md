# NestJS JWT Authentication Microservice — Complete Architecture

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Setup (Terminal Steps)](#project-setup)
3. [File Structure](#file-structure)
4. [Complete Source Code](#complete-source-code)
5. [Inter-Microservice Communication](#inter-microservice-communication)
6. [Environment & Configuration](#environment--configuration)
7. [Running & Testing](#running--testing)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      API Gateway                        │
│              (HTTP, Port 3000)                          │
│  - Routes requests to microservices                     │
│  - Validates JWT via AuthGuard                          │
└────────────────────────┬────────────────────────────────┘
                         │ TCP / Redis (Message Broker)
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │ Auth Service │ │ User Service │ │ Other Service│
  │  Port 3001   │ │  Port 3002   │ │  Port 3003   │
  └──────┬───────┘ └──────────────┘ └──────────────┘
         │
  ┌──────▼───────┐
  │  PostgreSQL  │
  │  Redis Cache │
  └──────────────┘
```

**Communication strategies used:**
- **TCP Transport** — direct service-to-service (low latency)
- **Redis Pub/Sub** — event-driven async (e.g., "user.registered")
- **JWT Validation Guard** — other services verify tokens independently using the shared secret

---

## 2. Project Setup (Terminal Steps)

```bash
# 1. Install NestJS CLI globally
npm install -g @nestjs/cli

# 2. Create the monorepo workspace (or standalone service)
nest new auth-microservice
cd auth-microservice

# 3. Install all required dependencies
npm install \
  @nestjs/jwt \
  @nestjs/passport \
  @nestjs/microservices \
  @nestjs/config \
  @nestjs/typeorm \
  passport \
  passport-jwt \
  passport-local \
  bcryptjs \
  typeorm \
  pg \
  redis \
  ioredis \
  class-validator \
  class-transformer

npm install -D \
  @types/passport-jwt \
  @types/passport-local \
  @types/bcryptjs

# 4. Generate modules using the CLI
nest generate module auth
nest generate module users
nest generate module token

nest generate controller auth
nest generate service auth
nest generate service users
nest generate service token

nest generate guard auth/jwt-auth
nest generate guard auth/jwt-refresh
nest generate strategy auth/jwt
nest generate strategy auth/local
```

---

## 3. File Structure

```
auth-microservice/
├── src/
│   ├── main.ts                          ← Bootstrap (HTTP + TCP listener)
│   ├── app.module.ts                    ← Root module
│   │
│   ├── config/
│   │   └── configuration.ts            ← Env config factory
│   │
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts           ← HTTP endpoints (login, register, refresh)
│   │   ├── auth.service.ts              ← Business logic
│   │   ├── auth.microservice.controller.ts  ← TCP message handlers
│   │   │
│   │   ├── dto/
│   │   │   ├── login.dto.ts
│   │   │   ├── register.dto.ts
│   │   │   └── refresh-token.dto.ts
│   │   │
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── jwt-refresh.guard.ts
│   │   │   └── local-auth.guard.ts
│   │   │
│   │   └── strategies/
│   │       ├── jwt.strategy.ts
│   │       ├── jwt-refresh.strategy.ts
│   │       └── local.strategy.ts
│   │
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.service.ts
│   │   ├── users.entity.ts
│   │   └── dto/
│   │       └── create-user.dto.ts
│   │
│   └── token/
│       ├── token.module.ts
│       └── token.service.ts             ← Refresh token management (Redis)
│
├── .env
├── package.json
└── tsconfig.json
```

---


### Pattern A — TCP Direct Call (Synchronous)

Any microservice can call the auth service directly to validate a token:

```typescript
// In another service (e.g., orders-service)
// src/app.module.ts

import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'AUTH_SERVICE',
        transport: Transport.TCP,
        options: { host: 'auth-service', port: 3001 },
      },
    ]),
  ],
})
export class AppModule {}
```

```typescript
// src/orders/orders.service.ts — calling auth service
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

export class OrdersService {
  constructor(
    @Inject('AUTH_SERVICE') private authClient: ClientProxy,
  ) {}

  async validateUserToken(token: string) {
    return firstValueFrom(
      this.authClient.send('auth.validate_token', { token })
    );
  }
}
```

---

### Pattern B — Shared JWT Guard (Recommended for API Gateway)

Instead of calling the auth service on every request, other services can **verify JWTs locally** using the same secret. This is the most performant approach.

```typescript
// shared-lib/src/guards/jwt-global.guard.ts
// Distribute this as an npm package or NestJS library

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtGlobalGuard extends AuthGuard('jwt') {
  handleRequest(err, user) {
    if (err || !user) throw new UnauthorizedException();
    return user;
  }
}
```

```typescript
// shared-lib/src/strategies/shared-jwt.strategy.ts
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export class SharedJwtStrategy extends PassportStrategy(Strategy) {
  constructor(jwtSecret: string) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,  // same JWT_ACCESS_SECRET env var
    });
  }

  async validate(payload: any) {
    return { id: payload.sub, email: payload.email, roles: payload.roles };
  }
}
```

Any service importing this guard and using the same `JWT_ACCESS_SECRET` can validate tokens **without calling auth service** — greatly reducing latency.

---

### Pattern C — Redis Event Bus (Async / Fire-and-forget)

For events like registration, password changes, etc.:

```typescript
// In auth.service.ts — emit event after registration
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

// After successful registration:
this.eventBus.emit('user.registered', {
  userId: user.id,
  email: user.email,
  createdAt: new Date(),
});
```

```typescript
// In notification-service — listen to the event
@EventPattern('user.registered')
async handleUserRegistered(@Payload() data: { userId: string; email: string }) {
  await this.emailService.sendWelcomeEmail(data.email);
}
```

Configure Redis transport in `main.ts`:
```typescript
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.REDIS,
  options: { host: 'localhost', port: 6379 },
});
```

---

### Communication Summary Table

| Scenario | Transport | Pattern | When to use |
|---|---|---|---|
| Validate token in another service | TCP | `send()` + `MessagePattern` | When blacklist check is required |
| Protect routes in other services | Local JWT guard | Shared secret | Best for performance |
| User registered/updated events | Redis | `emit()` + `EventPattern` | Async notifications, audit logs |
| API Gateway token check | TCP | `send()` | Single source of truth for revocation |

---

## 7. Running & Testing

```bash
# Start dependencies with Docker
docker run -d --name postgres -e POSTGRES_PASSWORD=password -p 5432:5432 postgres
docker run -d --name redis -p 6379:6379 redis

# Run the service
npm run start:dev

# Test endpoints
# Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123","firstName":"John"}'

# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# Use protected endpoint (replace TOKEN)
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer TOKEN"

# Refresh tokens (replace REFRESH_TOKEN)
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"REFRESH_TOKEN"}'
```

---

## Key Design Decisions

**Access tokens are short-lived (15m)** — limits damage from token theft. The `jti` (JWT ID) allows individual token revocation via Redis blacklist without waiting for expiry.

**Refresh tokens are hashed in Redis** — even if Redis is compromised, raw tokens are not exposed. Refresh tokens are rotated on every refresh call.

**TCP transport for sync calls** — used when other services need an immediate validated response (e.g., "is this token valid right now?"). Fallback to local JWT verification for high-throughput paths.

**Strategies are self-contained** — the `JwtStrategy` and `JwtRefreshStrategy` live in the auth service, but the shared pattern (Pattern B) lets other services replicate validation logic locally using only the shared secret.
