import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'src/core/database/prisma.service';
import { CreateAdminDto, Role } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

@Injectable()
export class AdminsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const admin = await this.prisma.admin.findFirst({
      where: { telegramId: 7079898917n },
    });
    if (!admin) {
      await this.prisma.admin.create({
        data: {
          telegramId: 7079898917n,
          fullName: 'mirsaid',
          isActive: true,
          role: Role.SUPER_ADMIN,
        },
      });
    }
  }

  async create(dto: CreateAdminDto) {
    return this.prisma.admin.create({
      data: { ...dto, fullName: normalizeName(dto.fullName) },
    });
  }

  async findAll() {
    return this.prisma.admin.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
    });
    if (!admin) throw new NotFoundException('Admin topilmadi');
    return admin;
  }

  async findByTelegramId(telegramId: bigint) {
    return this.prisma.admin.findUnique({
      where: { telegramId },
    });
  }

  async update(id: string, dto: UpdateAdminDto) {
    const existAdmin = await this.findOne(id);
    return this.prisma.admin.update({
      where: { id },
      data: {
        ...dto,
        fullName: dto.fullName
          ? normalizeName(dto.fullName)
          : existAdmin.fullName,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.admin.delete({
      where: { id },
    });
  }
}
export function normalizeName(name: string): string {
  if (!name) return name;

  return name
    .replace(/[‘’`´]/g, "'")
    .replace(/["«»„“”]/g, '')
    .trim()
    .toUpperCase();
}
