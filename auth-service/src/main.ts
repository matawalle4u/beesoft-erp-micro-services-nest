import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // HTTP server (for login, register, refresh endpoints)
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // TCP microservice listener (for inter-service communication)
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port: 3001,
    },
  });

  await app.startAllMicroservices();
  await app.listen(3000);
  console.log('Auth HTTP server running on port 3000');
  console.log('Auth TCP microservice running on port 3001');
}
bootstrap();