import { Injectable, NotFoundException } from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PrismaService } from 'src/core/database/prisma.service';
import { Prisma } from '@prisma/client';
import { Context } from 'telegraf';
import axios from 'axios';
import { normalizeName } from '../admins/admins.service';

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
      const product = await tx.product.create({
        data: {
          name: normalizeName(dto.name),
          categoryId: dto.categoryId,
          createdById: dto.createdById,
          price: new Prisma.Decimal(dto.price),
          stockQty: dto.stockQty,
          unit: dto.unit || 'dona',
        },
        select: { id: true },
      });

      return { success: true, product_id: product.id };
    });
  }

  /**
   * Barcha mahsulotlarni qidirish (Paginatsiya bilan)
   */
  async findAll(query?: string, categoryId?: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    
    const where: Prisma.ProductWhereInput = {
      AND: [
        categoryId ? { categoryId } : {},
        query ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
          ],
        } : {},
        { isActive: true }
      ]
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { 
          photos: true,
          category: true,
          createdBy: {
            select: {
              id: true,
              fullName: true,
              role: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where })
    ]);

    return { products, total, totalPages: Math.ceil(total / limit) };
  }

  /**
   * ID bo'yicha topish
   */
  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { 
        photos: true,
        category: true,
        createdBy: true
      },
    });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    return product;
  }

  /**
   * Mahsulotni yangilash
   */
  async update(id: string, dto: UpdateProductDto) {
    const product = await this.findOne(id);
    
    const data: Prisma.ProductUpdateInput = {
      ...dto,
      name: dto.name ? normalizeName(dto.name) : product.name,  
      price: dto.price ? new Prisma.Decimal(dto.price) : undefined,
    };

    return this.prisma.product.update({
      where: { id },
      data,
    });
  }

  /**
   * Mahsulotni o'chirish (yoki isActive=false qilish)
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

      // Rasmlarni Cloudinary-dan o'chirish
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

  async addPhotoToProduct(productId: string, url: string, publicId: string) {
    return this.prisma.photo.create({
      data: {
        url,
        publicId,
        productId,
      }
    });
  }

  async deletePhoto(publicId: string) {
    // DB-dan o'chirish
    await this.prisma.photo.deleteMany({
      where: { publicId }
    });
    // Cloudinary-dan o'chirish
    return await this.cloudinary.deleteFile(publicId);
  }
}
