import { Module } from '@nestjs/common';
import { BotModule } from './modules/bot/bot.module';
import { AdminsModule } from './modules/admins/admins.module';
import { ProductsModule } from './modules/products/products.module';
import { ConfigModule } from '@nestjs/config';
import { CloudinaryModule } from './modules/cloudinary/cloudinary.module';
import { MulterModule } from '@nestjs/platform-express';
import { MediaModule } from './modules/media/media.module';
import { RedisModule } from './modules/redis/redis.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { KeepAliveService } from './keep-alive.service';

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
    CategoriesModule,
    ProductsModule,
    MediaModule,
  ],
  controllers: [],
  providers: [KeepAliveService],
})
export class AppModule {}
