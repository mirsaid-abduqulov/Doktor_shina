import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class MediaService {
  constructor(private readonly cloudinaryService: CloudinaryService) {}
  /**
   * Telegram file_id orqali rasmni yuklab oladi va cloudinaryga saqlaydi
   */
  async uploadTelegramPhotoToCloudinary(
    fileId: string,
    botToken: string,
    folderName: string = 'tires',
  ) {
    try {
      const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
      const response = await fetch(getFileUrl);
      const data = (await response.json()) as {
        ok: boolean;
        result?: { file_path: string };
      };

      if (!data.ok || !data.result) {
        throw new Error('Telegram getFile failed or result is missing');
      }

      const telegramFilePath = data.result.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${telegramFilePath}`;

      const fileResponse = await fetch(downloadUrl);
      const arraybuffer = await fileResponse.arrayBuffer();
      const buffer = Buffer.from(arraybuffer);

      const faceFile = {
        buffer: buffer,
        originalname: `tg_${fileId}.jpg`,
      } as Express.Multer.File;
      return await this.cloudinaryService.uploadFile(faceFile, folderName);
    } catch (error) {
      console.error('Error uploading Telegram photo to Cloudinary:', error);
      throw new InternalServerErrorException('Rasmni yuklab olishda xatolik');
    }
  }

  /**
   * Express'dan kelgan fileni lokal papkaga saqlaydi
   */
  //   async saveManual(file: Express.Multer.File): Promise<string> {
  //     try {
  //       const fileExt = file.originalname.split('.').pop() || 'jpg';
  //       const fileName = `${randomUUID()}_${Date.now()}.${fileExt}`;
  //       const fullPath = join(this.uploadPath, fileName);

  //       writeFileSync(fullPath, file.buffer);
  //       return `/uploads/requests/${fileName}`;
  //     } catch (error) {
  //       console.error('Error saving manual file:', error);
  //       throw new InternalServerErrorException('Faylni saqlashda xatolik');
  //     }
  //   }
}
