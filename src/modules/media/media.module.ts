import { Module, Global } from '@nestjs/common';
import { MediaService } from './media.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Global()
@Module({
  providers: [MediaService],
  exports: [MediaService],
  imports: [CloudinaryModule],
})
export class MediaModule {}
