import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { PrismaModule } from 'src/core/database/prisma.module';
import { MediaModule } from '../media/media.module';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';

@Module({
  controllers: [],
  providers: [BotService],
  imports: [
    RedisModule,
    PrismaModule,
    MediaModule,
    ConfigModule,
    TelegrafModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.get<string>('BOT_TOKEN')!,
      }),
    }),
  ],
})
export class BotModule {}
