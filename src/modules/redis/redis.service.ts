import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import { ProductType } from '@prisma/client';

export interface BotProductData {
  product_id?: string;
  name?: string;
  type?: ProductType;
  price?: number;
  count?: number;
  photos: string[];
}

export interface UserState {
  step: string;
  data: BotProductData;
}

@Injectable()
export class RedisService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  // Ma'lumotni saqlash (1 kun TTL bilan)
  async setUserState(telegramId: bigint, state: UserState) {
    const key = `tire_state:${telegramId}`;
    await this.redis.set(key, JSON.stringify(state), 'EX', 86400); // 86400 sek = 24 soat || 7 kunga saqlash
  }

  // Ma'lumotni o'qish
  async getUserState(telegramId: bigint): Promise<UserState | null> {
    const key = `tire_state:${telegramId}`;
    const data = await this.redis.get(key);
    return data ? (JSON.parse(data) as UserState) : null;
  }

  // Ma'lumotni o'chirish (Ariza bitganda)
  async deleteUserState(telegramId: bigint) {
    await this.redis.del(`tire_state:${telegramId}`);
  }
}
