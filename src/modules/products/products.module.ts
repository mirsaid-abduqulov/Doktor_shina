import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PrismaModule } from 'src/core/database/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { Module } from '@nestjs/common';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
  imports: [PrismaModule, CloudinaryModule],
  exports: [ProductsService],
})
export class ProductsModule {}
