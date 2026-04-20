import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleDestroy, OnModuleInit
{
  constructor() {
    // Prisma Clientni PostgreSQL adapteri bilan sozlash
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({ adapter, log: ['error', 'warn'] });
  }
  async onModuleInit() {
    await this.$connect();
    Logger.log('✅ Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    Logger.log('❌ Prisma disconnected');
  }
}
