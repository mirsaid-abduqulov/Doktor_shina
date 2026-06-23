import { Module } from '@nestjs/common';
import { RedisModule as IoRedisModule } from '@nestjs-modules/ioredis';
import { RedisService } from './redis.service';

@Module({
  imports: [
    IoRedisModule.forRoot({
      type: 'single',
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      options: {
        // Upstash ulanishi uchun TLS shart!
        // tls: {
        //   rejectUnauthorized: false,
        // },
        // Ulanish uzilib qolsa qayta ulanishga urinish
        retryStrategy: (times) => Math.min(times * 50, 2000),
      },
    }),
  ],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
