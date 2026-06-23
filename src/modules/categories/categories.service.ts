import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/core/database/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { normalizeName } from '../admins/admins.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createCategoryDto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: {
        name: normalizeName(createCategoryDto.name),
        description: createCategoryDto.description,
        parentId: createCategoryDto.parentId,
      },
    });
  }

  async findAll() {
    return this.prisma.category.findMany({
      include: {
        children: true,
        parent: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        children: true,
        parent: true,
        products: true,
      },
    });
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }
    return category;
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto) {
    const existCategory = await this.findOne(id);

    return this.prisma.category.update({
      where: { id },
      data: { ...updateCategoryDto, name: updateCategoryDto.name ? normalizeName(updateCategoryDto.name) : existCategory.name },
    });
  }

  async remove(id: string) {
    const existCategory = await this.findOne(id);
    if (existCategory.children.length > 0) {
      throw new BadRequestException('Kategoriyani o`chirish mumkin emas chunki unda subkategoriyalar mavjud');
    }
    if (existCategory.products.length > 0) {
      throw new BadRequestException('Kategoriyani o`chirish mumkin emas chunki unda mahsulotlar mavjud  ');
    }
    return this.prisma.category.delete({
      where: { id },
    });
  }

  async getTree() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      include: {
        children: {
          include: {
            children: true,
          },
        },
      },
    });
  }
}
