import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from './cloudinary.service';

@Controller('cloudinary')
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: 'image/.*' }),
        ],
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
    @Query('folder') folder?: string,
  ) {
    return this.cloudinaryService.uploadFile(file, folder);
  }

  @Delete('delete')
  async deleteFile(
    @Query('publicId') publicId: string,
    @Query('type') type: 'image' | 'raw' = 'image',
  ) {
    await this.cloudinaryService.deleteFile(publicId, type);
    return { message: `Fayl muvaffaqiyatli o'chirildi`, publicId };
  }

  @Get('folder/:name')
  async getFolderResources(@Param('name') name: string) {
    return this.cloudinaryService.getResourcesByFolder(name);
  }
}
