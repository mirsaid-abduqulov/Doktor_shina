import { Injectable, NotFoundException } from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateProductDto } from './dto/create-product.dto';
import { PrismaService } from 'src/core/database/prisma.service';
import { ProductType, Prisma } from '@prisma/client';
import { Context } from 'telegraf';
import axios from 'axios';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) { }

  /**
   * Telegramdan kelgan rasm bufferini Cloudinary-ga yuklash
   */
  async uploadProductImage(fileBuffer: Buffer): Promise<string> {
    const fakeFile = {
      buffer: fileBuffer,
    } as Express.Multer.File;

    const uploaded = await this.cloudinary.uploadFile(
      fakeFile,
      'products_warehouse',
    );
    return uploaded.url;
  }

  /**
   * Yangi mahsulot yaratish
   */
  async create(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      try {
        const product = await tx.product.create({
          data: {
            name: dto.name,
            type: dto.type,
            price: Number(dto.price),
            count: Number(dto.count),
          },
          select: { id: true },
        });

        return { success: true, product_id: product.id };
      } catch (e) {
        console.log(e);
      }
    });
  }

  /**
   * Barcha mahsulotlarni qidirish
   */
  async findAll(query?: string, type?: ProductType) {
    return this.prisma.product.findMany({
      where: {
        AND: [
          type ? { type } : {},
          query ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
            ],
          } : {},
        ]
      },
      include: { photos: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * ID bo'yicha topish
   */
  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { photos: true },
    });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    return product;
  }

  /**
   * Mahsulotni o'chirish
   */
  async remove(id: string) {
    return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const product = await tx.product.findUnique({
        where: { id },
        include: { photos: true },
      });

      if (!product) {
        throw new NotFoundException('Mahsulot topilmadi');
      }

      if (product.photos && product.photos.length > 0) {
        for (const photo of product.photos) {
          await this.cloudinary.deleteFile(photo.publicId);
        }
      }

      return tx.product.delete({ where: { id } });
    });
  }

  async saveTelegramPhoto(ctx: Context, fileId: string) {
    const link = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(link.href, {
      responseType: 'arraybuffer',
    });
    const buffer = Buffer.from(response.data as ArrayBuffer);

    return this.cloudinary.uploadFromBuffer(buffer, 'products');
  }
}
