import { Module } from '@nestjs/common';
import { TiresController } from './tires.controller';
import { TiresService } from './tires.service';
import { PrismaModule } from 'src/core/database/prsima.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  controllers: [TiresController],
  providers: [TiresService],
  imports: [PrismaModule, CloudinaryModule],
  exports: [TiresService],
})
export class TiresModule {}
