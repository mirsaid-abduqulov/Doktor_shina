import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ParseIntPipe,
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
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    if (!ctx.from) return;

    const isAdmin = await this.getAdminByTgId(BigInt(ctx.from.id));

    if (isAdmin) {
      await ctx.reply(
        'Xush kelibsiz, Admin! 🛠',
        Markup.keyboard([["Yangi shina qo'shish"]]).resize(),
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
    // 1. Dastlabki tekshiruvlar
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

    // 2. Admin shina qo'shishni boshlashi
    if (text === "Yangi shina qo'shish") {
      const isAdmin = await this.getAdminByTgId(tgId);
      if (isAdmin) {
        await this.redis.setUserState(tgId, {
          step: 'WAIT_NAME',
          data: { photos: [] },
        });
        await ctx.reply(
          'Yangi shina nomini kiriting:',
          Markup.keyboard([['Bekor qilish']]).resize(),
        );
        return; // Return faqat matn yuborilgandan keyin
      }
    }

    // 3. Bekor qilish logikasi
    if (text === 'Bekor qilish' && state) {
      await this.redis.deleteUserState(tgId);
      const isAdmin = await this.getAdminByTgId(tgId);

      const replyMarkup = isAdmin
        ? Markup.keyboard([["Yangi shina qo'shish"]]).resize()
        : Markup.removeKeyboard();

      await ctx.reply('Jarayon bekor qilindi.', replyMarkup);
      return;
    }

    // 4. SONINI O'ZGARTIRISH (Increment/Decrement) mantiqi
    if (
      state &&
      (state.step === 'WAIT_INC_COUNT' || state.step === 'WAIT_DEC_COUNT')
    ) {
      // text ni yuqorida allaqachon olganmiz
      const countChange = Number(text.trim());

      if (isNaN(countChange) || countChange <= 0) {
        await ctx.reply(
          '⚠️ Xatolik: Iltimos, faqat musbat raqam kiriting!\n\nMisol: 5, 10, 20',
          Markup.keyboard([['Bekor qilish']]).resize(),
        );
        return; // Bu yerda return qilish shart, pastga tushib ketmasligi uchun
      }

      const tireId = state.data.tire_id;
      if (!tireId) {
        await this.redis.deleteUserState(tgId);
        await ctx.reply(
          "Shina ID topilmadi, iltimos qaytadan urinib ko'ring.",
        );
        return;
      }

      const isIncrement = state.step === 'WAIT_INC_COUNT';

      try {
        if (!isIncrement) {
          const currentTire = await this.prisma.tire.findUnique({
            where: { id: tireId },
          });
          if (currentTire && currentTire.count < countChange) {
            await ctx.reply(
              `Xatolik!\nOmborda bor-yog'i ${currentTire.count} ta shina bor.\nSiz esa ${countChange} tani ayirmoqchisiz.`,
              Markup.keyboard([['Bekor qilish']]).resize(),
            );
            return;
          }
        }

        await this.prisma.tire.update({
          where: { id: tireId },
          data: {
            count: isIncrement
              ? { increment: countChange }
              : { decrement: countChange },
          },
        });

        await this.redis.deleteUserState(tgId);
        await ctx.reply(
          `Muvaffaqiyatli bajarildi!\nShina soni ${countChange} taga ${isIncrement ? 'oshirildi' : 'kamaytirildi'}.`,
          Markup.keyboard([["Yangi shina qo'shish"]]).resize(),
        );
        return;
      } catch (error) {
        console.error('Update error:', error);
        await ctx.reply('Bazaga yozishda texnik xatolik yuz berdi.');
        return;
      }
    }

    // 5. Shina qo'shish steplari
    if (state && state.step.startsWith('WAIT_')) {
      switch (state.step) {
        case 'WAIT_NAME':
          state.data.name = text;
          state.step = 'WAIT_SIZE';
          await this.redis.setUserState(tgId, state);
          await ctx.reply("O'lchamini kiriting (Masalan: 205/55 R16):");
          break;

        case 'WAIT_SIZE':
          state.data.size = text;
          state.step = 'WAIT_PRICE';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Narxini kiriting (faqat raqam):');
          break;

        case 'WAIT_PRICE':
          if (isNaN(Number(text))) {
            await ctx.reply('Iltimos, narxni faqat raqamda kiriting!');
            return;
          }
          state.data.price = Number(text);
          state.step = 'WAIT_COUNT';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Soni (dona):');
          break;

        case 'WAIT_COUNT':
          if (isNaN(Number(text))) {
            await ctx.reply('Iltimos, sonini faqat raqamda kiriting!');
            return;
          }
          state.data.count = Number(text);
          state.step = 'WAIT_PHOTOS';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Endi rasm(lar)ni yuboring (Max: 2 ta).');
          break;

        // TAHRIRLASH QISMI
        case 'WAIT_EDIT_NAME':
        case 'WAIT_EDIT_SIZE':
        case 'WAIT_EDIT_PRICE':
        case 'WAIT_EDIT_COUNT':
          const fieldMap = {
            WAIT_EDIT_NAME: 'name',
            WAIT_EDIT_SIZE: 'size',
            WAIT_EDIT_PRICE: 'price',
            WAIT_EDIT_COUNT: 'count',
          };
          const field = fieldMap[state.step];
          const tireId = state.data.tire_id;
          let newValue: string | number = text;

          if (field === 'price' || field === 'count') {
            newValue = Number(text);
            if (isNaN(newValue)) {
              await ctx.reply('Iltimos, faqat raqam kiriting!');
              return;
            }
          }

          try {
            await this.prisma.tire.update({
              where: { id: tireId },
              data: { [field]: newValue },
            });
            await this.redis.deleteUserState(tgId);
            await ctx.reply(
              "Ma'lumotlar muvaffaqiyatli yangilandi!",
              Markup.keyboard([["Yangi shina qo'shish"]]).resize(),
            );
          } catch (error) {
            console.error('Edit error:', error);
            await ctx.reply('Xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.');
          }
          break;
      }
      return;
    }

    // 6. Qidiruv logikasi (Agar hech qanday state bo'lmasa)
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
            Markup.button.callback('Saqlash', 'finalize_tire'),
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

    await ctx.editMessageText("Ma'lumotlar saqlanmoqda...");

    try {
      await this.createTireFromBot(
        state.data as unknown as CreateTireDto,
        state.data.photos,
      );

      await this.redis.deleteUserState(tgId);
      await ctx.reply(
        "Shina bazaga muvaffaqiyatli qo'shildi!",
        Markup.keyboard([["Yangi shina qo'shish"]]).resize(),
      );
      await ctx.answerCbQuery();
    } catch (error) {
      console.error(error);
      await ctx.reply('Xatolik yuz berdi.');
      await ctx.answerCbQuery();
    }
  }

  private async searchTires(ctx: Context, query: string) {
    if (!ctx.chat || !ctx.from) return;

    await ctx.reply(`🔍 "${query}" bo'yicha shinalar qidirilmoqda...`);

    const tires = await this.prisma.tire.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { size: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: { photos: true },
      take: 5,
    });

    if (tires.length === 0) {
      return await ctx.reply(
        "Kechirasiz, ko'rsatilgan so'rov bo'yicha shina topilmadi.",
      );
    }

    // 1. Foydalanuvchi admin ekanligini tekshiramiz
    const isAdmin = await this.getAdminByTgId(BigInt(ctx.from.id));

    for (const tire of tires) {
      const captionText =
        `<b>Shina ma'lumotlari</b>\n\n` +
        `<b>Nomi:</b> ${tire.name}\n` +
        `<b>O'lchami:</b> ${tire.size}\n` +
        `<b>Narxi:</b> ${tire.price.toLocaleString('uz-UZ')} $\n` +
        `<b>Ombor qoldig'i:</b> ${tire.count} dona`;

      // 2. Media group yuborish (Rasmlar bo'lsa)
      if (tire.photos && tire.photos.length > 0) {
        const mediaGroup = tire.photos.map((p) => ({
          type: 'photo',
          media: p.url,
        }));
        try {
          await ctx.replyWithMediaGroup(mediaGroup as any);
        } catch (error) {
          console.error('Album yuborishda xato:', error);
        }
      }

      // 3. Admin uchun tugmalar yasaymiz
      let extraMarkup: any = {};
      // searchTires ichidagi tugmalar qismi
      if (isAdmin) {
        extraMarkup = Markup.inlineKeyboard([
          [
            Markup.button.callback('Kamaytirish', `dec_tire_${tire.id}`),
            Markup.button.callback('Tahrirlash', `edit_tire_${tire.id}`),
            Markup.button.callback("Qo'shish", `inc_tire_${tire.id}`),
          ],
        ]);
      }

      // 4. Matn va tugmalarni yuboramiz
      await ctx.replyWithHTML(captionText, extraMarkup);
    }
  }

  // 1. Qo'shish tugmasi bosilganda
  @Action(/^inc_tire_(.+)$/)
  async onIncrementStart(@Ctx() ctx: any) {
    const tireId = ctx.match[1];
    const tgId = BigInt(ctx.from.id);

    await this.redis.setUserState(tgId, {
      step: 'WAIT_INC_COUNT',
      data: { tire_id: tireId, photos: [] },
    });

    // Avval callbackga javob beramiz (soat belgisi ketishi uchun)
    await ctx.answerCbQuery();

    // Keyin alohida xabar yuboramiz
    await ctx.reply("Nechta shina qo'shmoqchisiz? (Raqam kiriting)");
  }

  @Action(/^dec_tire_(.+)$/)
  async onDecrementStart(@Ctx() ctx: any) {
    const tireId = ctx.match[1];
    const tgId = BigInt(ctx.from.id);

    await this.redis.setUserState(tgId, {
      step: 'WAIT_DEC_COUNT',
      data: { tire_id: tireId, photos: [] },
    });

    await ctx.answerCbQuery();
    await ctx.reply('Nechta shina kamaytirmoqchisiz? (Raqam kiriting)');
  }

  // 3. onText ichida ishlov berish
  // ... (oldingi javobdagi WAIT_INC_COUNT va WAIT_DEC_COUNT mantiqi bu yerda ishlaydi)
  // 1. Tahrirlash tugmasi bosilganda (qaysi maydonni tahrirlashni tanlash)
  @Action(/^edit_tire_(.+)$/)
  async onEditStart(@Ctx() ctx: any) {
    const tireId = ctx.match[1];
    const tgId = BigInt(ctx.from.id);

    await this.redis.setUserState(tgId, {
      step: 'SELECT_EDIT_FIELD',
      data: { tire_id: tireId, photos: [] },
    });

    await ctx.answerCbQuery();
    await ctx.reply(
      "Qaysi ma'lumotni o'zgartirmoqchisiz?",
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Nomi', 'edit_name'),
          Markup.button.callback("O'lchami", 'edit_size'),
        ],
        [
          Markup.button.callback('Narxi', 'edit_price'),
          Markup.button.callback('Soni', 'edit_count'),
        ],
      ]),
    );
  }

  // 2. Maydon tanlanganda
  @Action(/^edit_(name|size|price|count)$/)
  async onFieldSelect(@Ctx() ctx: any) {
    const field = ctx.match[1]; // name, size, price yoki count
    const tgId = BigInt(ctx.from.id);
    const state = await this.redis.getUserState(tgId);

    if (!state || !state.data.tire_id) {
      return ctx.answerCbQuery("Eski ma'lumot topilmadi.");
    }

    state.step = `WAIT_EDIT_${field.toUpperCase()}`; // Masalan: WAIT_EDIT_NAME
    await this.redis.setUserState(tgId, state);

    const labels = {
      name: 'nomini',
      size: "o'lchamini",
      price: 'narxini',
      count: 'sonini',
    };

    await ctx.answerCbQuery();
    await ctx.reply(`Yangi ${labels[field]}ni kiriting:`, Markup.keyboard([['Bekor qilish']]).resize());
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

  async pluseTireFromBot(limit: number, tire_id: string) {
    try {
      await this.prisma.tire.update({
        where: { id: tire_id },
        data: { count: { increment: limit } },
      });
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Serverda hatolik');
    }
  }

  async minuseTireFromBot(limit: number, tire_id: string) {
    try {
      await this.prisma.tire.update({
        where: { id: tire_id },
        data: { count: { decrement: limit } },
      });
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Serverda hatolik');
    }
  }

  async tireDataUpdateFromBot(
    payload: Partial<{ name: string; size: string; price: number }>,
    tire_id: string,
  ) {
    try {
      const data = { ...payload };
      if (payload.price) data.price = Number(payload.price);

      await this.prisma.tire.update({ where: { id: tire_id }, data });
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Serverda hatolik');
    }
  }
}
