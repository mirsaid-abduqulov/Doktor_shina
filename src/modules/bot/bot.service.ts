import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Action, Ctx, InjectBot, On, Start, Update } from 'nestjs-telegraf';
import { PrismaService } from 'src/core/database/prisma.service';
import { Context, Markup, Telegraf } from 'telegraf';
import { CreateTireDto } from '../tires/dto/create-tire.dto';
import { MediaService } from '../media/media.service';
import { RedisService } from '../redis/redis.service';

@Update()
@Injectable()
export class BotService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectBot() private bot: Telegraf<Context>,
    private readonly configService: ConfigService,
    private readonly mediaservice: MediaService,
    private readonly redis: RedisService,
  ) { }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    if (!ctx.from) return;

    const isAdmin = await this.getAdminByTgId(BigInt(ctx.from.id));

    if (isAdmin) {
      await ctx.reply(
        'Xush kelibsiz, Admin! 🛠',
        Markup.keyboard([["➕ Yangi shina qo'shish"]]).resize(),
      );
      return;
    }

    await ctx.reply(
      "Xush kelibsiz! Shina qidirish uchun shina nomini yoki o'lchamini yozib yuboring.",
      Markup.removeKeyboard(), // Oddiy foydalanuvchida tugmalar bo'lmaydi
    );
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    if (
      !ctx.from ||
      !('message' in ctx.update) ||
      !('text' in ctx.update.message)
    ) {
      return;
    }
    const tgId = BigInt(ctx.from.id);
    const text = ctx.update.message.text;
    const state = await this.redis.getUserState(tgId);

    // 1. Admin shina qo'shishni boshlashi
    if (text === "➕ Yangi shina qo'shish") {
      const isAdmin = await this.getAdminByTgId(tgId);
      if (isAdmin) {
        await this.redis.setUserState(tgId, {
          step: 'WAIT_NAME',
          data: { photos: [] },
        });
        await ctx.reply(
          'Yangi shina nomini kiriting:',
          Markup.keyboard([['❌ Bekor qilish']]).resize(),
        );
        return;
      }
    }

    // 2. Bekor qilish logikasi
    if (text === '❌ Bekor qilish' && state) {
      await this.redis.deleteUserState(tgId);
      const isAdmin = await this.getAdminByTgId(tgId);
      await ctx.reply(
        'Jarayon bekor qilindi.',
        isAdmin
          ? Markup.keyboard([["➕ Yangi shina qo'shish"]]).resize()
          : Markup.removeKeyboard(),
      );
      return;
    }

    // 3. Shina qo'shish steplari
    if (state && state.step.startsWith('WAIT_')) {
      switch (state.step) {
        case 'WAIT_NAME':
          state.data.name = text;
          state.step = 'WAIT_SIZE';
          await this.redis.setUserState(tgId, state);
          await ctx.reply("O'lchamini kiriting (Masalan: 205/55 R16):");
          return;

        case 'WAIT_SIZE':
          state.data.size = text;
          state.step = 'WAIT_PRICE';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Narxini kiriting (faqat raqam):');
          return;

        case 'WAIT_PRICE':
          if (isNaN(Number(text))) {
            await ctx.reply('Iltimos, narxni faqat raqamda kiriting!');
            return;
          }
          state.data.price = Number(text);
          state.step = 'WAIT_COUNT';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Soni (dona):');
          return;

        case 'WAIT_COUNT':
          if (isNaN(Number(text))) {
            await ctx.reply('Iltimos, sonini faqat raqamda kiriting!');
            return;
          }
          state.data.count = Number(text);
          state.step = 'WAIT_PHOTOS';
          await this.redis.setUserState(tgId, state);
          await ctx.reply("Endi rasm(lar)ni yuboring (Max: 2 ta).");
          return;
      }
      return;
    }

    // 4. Qidiruv logikasi
    await this.searchTires(ctx, text);
  }

  @On('photo')
  async onPhoto(@Ctx() ctx: Context) {
    const tgId = BigInt(ctx.from?.id || 0);
    const state = await this.redis.getUserState(tgId);

    // 1. Bizga message va uning ichida photo massivi borligi aniq bo'lishi kerak
    if (!('message' in ctx.update) || !('photo' in ctx.update.message)) {
      return;
    }

    if (state && state.step === 'WAIT_PHOTOS') {
      // 2. Endi TypeScript photo borligiga ishonadi
      const photos = ctx.update.message.photo;
      const fileId = photos[photos.length - 1].file_id; // pop() o'rniga oxirgi elementni olish xavfsizroq

      if (state.data.photos.length >= 2) {
        await ctx.reply('Maksimal 2 ta rasm yuklash mumkin!');
        return;
      }

      state.data.photos.push(fileId);
      await this.redis.setUserState(tgId, state);

      const currentLength = state.data.photos.length;
      let textMsg = '';
      let showButton = false;

      if (currentLength === 1) {
        textMsg = `1-rasm qabul qilindi (1/2). Yana rasm yuborishingiz yoki saqlashingiz mumkin.`;
        showButton = true;
      } else if (currentLength === 2) {
        textMsg = `2-rasm ham qabul qilindi (2/2). Maksimal limitga yetildi, endi saqlang.`;
        showButton = true;
      }

      if (showButton) {
        await ctx.reply(
          textMsg,
          Markup.inlineKeyboard([
            Markup.button.callback('✅ Saqlash', 'finalize_tire'),
          ]),
        );
        return;
      } else {
        await ctx.reply(textMsg);
        return;
      }
    }
  }

  @Action('finalize_tire')
  async onFinalize(@Ctx() ctx: Context) {
    if (!ctx.from || !('callback_query' in ctx.update)) return;

    const tgId = BigInt(ctx.from.id);
    const state = await this.redis.getUserState(tgId);

    if (!state || state.data.photos.length === 0) {
      await ctx.answerCbQuery('Kamida bitta rasm yuklashingiz kerak!', {
        show_alert: true,
      });
      return;
    }

    await ctx.editMessageText("⏳ Ma'lumotlar saqlanmoqda...");

    try {
      await this.createTireFromBot(
        state.data as unknown as CreateTireDto,
        state.data.photos,
      );

      await this.redis.deleteUserState(tgId);
      await ctx.reply(
        "✅ Shina bazaga muvaffaqiyatli qo'shildi!",
        Markup.keyboard([["➕ Yangi shina qo'shish"]]).resize(),
      );
      await ctx.answerCbQuery();
    } catch (error) {
      console.error(error);
      await ctx.reply('❌ Xatolik yuz berdi.');
      await ctx.answerCbQuery();
    }
  }

  private async searchTires(ctx: Context, query: string) {
    if (!ctx.chat) return;

    await ctx.reply(`🔍 "${query}" bo'yicha shinalar qidirilmoqda...`);

    const tires = await this.prisma.tire.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { size: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: { photos: true },
      take: 5, // Bir qidiruvda maksimum 5ta qaytarish xavfsizroq
    });

    if (tires.length === 0) {
      await ctx.reply("❌ Kechirasiz, ko'rsatilgan so'rov bo'yicha shina topilmadi.");
      return;
    }

    for (const tire of tires) {
      const captionText = `📦 <b>Shina ma'lumotlari</b>\n\n` +
        `🛞 <b>Nomi:</b> ${tire.name}\n` +
        `📏 <b>O'lchami:</b> ${tire.size}\n` +
        `💰 <b>Narxi:</b> ${tire.price.toLocaleString('uz-UZ')} so'm\n` +
        `📊 <b>Ombor qoldig'i:</b> ${tire.count} dona`;

      if (tire.photos && tire.photos.length > 0) {
        const mediaGroup = tire.photos.map((p) => ({
          type: 'photo',
          media: p.url,
        }));

        try {
          // 1. Dastlab albomni (media group) yuboramiz
          await ctx.replyWithMediaGroup(mediaGroup as any);
        } catch (error) {
          console.error('Album yuborishda xato:', error);
        }
      }

      // 2. Keyin matn va tugmachani yuboramiz (huddi rasmdagidek ajralgan holda keladi)
      await ctx.replyWithHTML(captionText);
    }
  }

  async getAdminByTgId(telegramId: bigint) {
    return this.prisma.admin.findUnique({
      where: { telegram_id: telegramId },
    });
  }

  async createTireFromBot(payload: CreateTireDto, tgFileIds: string[]) {
    const botToken = this.configService.get<string>('BOT_TOKEN');
    if (!botToken) throw new NotFoundException('Bot token not found');

    const uploadedPhotos: { url: string; publicId: string }[] = [];

    for (const id of tgFileIds) {
      const result = await this.mediaservice.uploadTelegramPhotoToCloudinary(
        id,
        botToken,
      );

      uploadedPhotos.push({ url: result.url, publicId: result.publicId });
    }
    return await this.prisma.$transaction(async (tx) => {
      try {
        const newTire = await tx.tire.create({
          data: {
            ...payload,
            photos: {
              create: uploadedPhotos,
            },
          },
        });
        return { success: true, tire_id: newTire.id };
      } catch (error) {
        console.log(error);
        throw new InternalServerErrorException('Serverda hatolik');
      }
    });
  }
}
