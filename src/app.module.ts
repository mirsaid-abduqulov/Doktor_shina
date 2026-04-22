import { Module } from '@nestjs/common';
import { BotModule } from './modules/bot/bot.module';
import { AdminsModule } from './modules/admins/admins.module';
import { TiresModule } from './modules/tires/tires.module';
import { ConfigModule } from '@nestjs/config';
import { CloudinaryModule } from './modules/cloudinary/cloudinary.module';
import { MulterModule } from '@nestjs/platform-express';
import { MediaModule } from './modules/media/media.module';
import { RedisModule } from './modules/redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CloudinaryModule,
    MulterModule.register({
      limits: {
        fileSize: 100 * 1024 * 1024,
      },
    }),
    RedisModule,
    BotModule,
    AdminsModule,
    TiresModule,
    MediaModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
