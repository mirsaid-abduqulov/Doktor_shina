import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  v2 as cloudinary,
  UploadApiResponse,
  UploadApiErrorResponse,
} from 'cloudinary';

@Injectable()
export class CloudinaryService {
  constructor(private configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'shina',
  ): Promise<{ url: string; publicId: string; resourceType: string }> {
    return new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          resource_type: 'auto',
        },
        (error: UploadApiErrorResponse, result: UploadApiResponse) => {
          if (error) {
            // Cloudinary xatolarini tahlil qilish
            if (error.message.includes('File size too large')) {
              return reject(
                new BadRequestException(
                  'Fayl hajmi Cloudinary limiti (max 20-100MB) dan oshib ketdi.',
                ),
              );
            }
            if (error.message.includes('Invalid image file')) {
              return reject(
                new BadRequestException(
                  'Yuborilgan fayl formati yaroqsiz yoki buzilgan.',
                ),
              );
            }
            // Umumiy xato
            return reject(
              new InternalServerErrorException(
                `Cloudinary xatoligi: ${error.message}`,
              ),
            );
          }
          if (result) {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              resourceType: result.resource_type,
            });
          } else {
            reject(
              new InternalServerErrorException(
                'Yuklash muvaffaqiyatsiz: Natija qaytmadi',
              ),
            );
          }
        },
      );
      if (!file || !file.buffer) {
        return reject(
          new BadRequestException(
            "Fayl ma'lumotlari topilmadi (buffer empty).",
          ),
        );
      }
      upload.end(file.buffer);
    });
  }

  async deleteFile(publicId: string, resourceType: 'image' | 'raw' = 'image') {
    try {
      const result = (await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
      })) as { result: string };
      if (result.result !== 'ok' && result.result !== 'not found') {
        throw new Error(result.result);
      }
      return result;
    } catch (error) {
      throw new Error(`Cloudinary delete failed: ${(error as Error).message}`);
    }
  }

  async getResourcesByFolder(folderName: string) {
    try {
      const dbResources = (await cloudinary.search
        .expression(`folder="${folderName}"`)
        .max_results(500)
        .execute()) as {
        resources: {
          secure_url: string;
          public_id: string;
          resource_type: string;
          format: string;
          bytes: number;
        }[];
      };

      return dbResources.resources.map((resource) => ({
        url: resource.secure_url,
        publicId: resource.public_id,
        type: resource.resource_type,
        format: resource.format,
        size: resource.bytes,
      }));
    } catch (error) {
      throw new Error(`Failed to get resources: ${(error as Error).message}`);
    }
  }

  // CloudinaryService ichiga qo'shish uchun
  async uploadFromBuffer(
    buffer: Buffer,
    folder: string = 'tires',
  ): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder },
        (error: UploadApiErrorResponse, result: UploadApiResponse) => {
          if (error) return reject(new Error(error.message));
          resolve(result?.secure_url); // Bizga faqat URL kerak bo'lsa
        },
      );
      uploadStream.end(buffer);
    });
  }
}
