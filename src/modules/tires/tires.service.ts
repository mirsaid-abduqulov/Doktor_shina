// tires.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateTireDto } from './dto/create-tire.dto';
import { PrismaService } from 'src/core/database/prisma.service';
import { Context } from 'telegraf';
import axios from 'axios';

@Injectable()
export class TiresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * Telegramdan kelgan rasm bufferini Cloudinary-ga yuklash
   */
  async uploadTireImage(fileBuffer: Buffer): Promise<string> {
    // CloudinaryService uploadFile Multer obyektini kutyapti,
    // shuning uchun biz unga kerakli strukturani yasab beramiz
    const fakeFile = {
      buffer: fileBuffer,
    } as Express.Multer.File;

    const uploaded = await this.cloudinary.uploadFile(
      fakeFile,
      'tires_warehouse',
    );
    return uploaded.url; // Cloudinary secure_url qaytaradi
  }

  /**
   * Yangi shina yaratish
   */
  async create(createTireDto: CreateTireDto) {
    return this.prisma.$transaction(async (tx) => {
      try {
        const newTire = await tx.tire.create({
          data: {
            name: createTireDto.name,
            size: createTireDto.size,
            price: Number(createTireDto.price),
            count: Number(createTireDto.count),
          },
          select: { id: true },
        });

        return { success: true, tire_id: newTire.id };
      } catch (e) {
        console.log(e);
      }
    });
  }

  /**
   * Barcha shinalarni qidirish (Filter bilan)
   */
  async findAll(query?: string) {
    return this.prisma.tire.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { size: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * ID bo'yicha topish
   */
  async findOne(id: string) {
    const tire = await this.prisma.tire.findUnique({
      where: { id },
      include: { photos: true },
    });
    if (!tire) throw new NotFoundException('Shina topilmadi');
    return tire;
  }

  /**
   * Shinani o'chirish (Cloudinary-dan ham rasmini o'chirish imkoniyati bilan)
   */
  async remove(id: string) {
    return await this.prisma.$transaction(async (tx) => {
      const tire = await tx.tire.findUnique({
        where: { id },
        include: { photos: true },
      });

      if (!tire) {
        throw new NotFoundException('Tovar topilmadi');
      }
      // 1. Cloudinary-dan rasmlarni o'chirish
      if (tire.photos && tire.photos.length > 0) {
        for (const photo of tire.photos) {
          const photoObj = photo as { publicId: string };
          await this.cloudinary.deleteFile(photoObj.publicId);
        }
      }

      // 2. Bazadan o'chirish
      return tx.tire.delete({ where: { id } });
    });
  }

  // tires.service.ts yoki util faylda
  async saveTelegramPhoto(ctx: Context, fileId: string) {
    const link = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(link.href, {
      responseType: 'arraybuffer',
    });
    const buffer = Buffer.from(response.data as ArrayBuffer);

    // Cloudinary-ga yuklash va tayyor natijani olish
    return this.cloudinary.uploadFromBuffer(buffer, 'tires');
  }
}
