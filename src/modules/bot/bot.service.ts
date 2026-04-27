import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Action, Ctx, InjectBot, On, Start, Update } from 'nestjs-telegraf';
import { PrismaService } from 'src/core/database/prisma.service';
import { Context, Markup, Telegraf } from 'telegraf';
import { CreateProductDto } from '../products/dto/create-product.dto';
import { MediaService } from '../media/media.service';
import { RedisService } from '../redis/redis.service';
import { ProductType } from '@prisma/client';
import { ProductsService } from '../products/products.service';

@Update()
@Injectable()
export class BotService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectBot() private bot: Telegraf<Context>,
    private readonly configService: ConfigService,
    private readonly mediaservice: MediaService,
    private readonly redis: RedisService,
    private readonly productsService: ProductsService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    if (!ctx.from) return;

    const isAdmin = await this.getAdminByTgId(BigInt(ctx.from.id));

    if (isAdmin) {
      await ctx.reply(
        'Xush kelibsiz, Admin!',
        Markup.keyboard([["Yangi mahsulot qo'shish"], ['Katalog']]).resize(),
      );
      return;
    }

    await ctx.reply(
      "Xush kelibsiz! Mahsulotlarni ko'rish uchun quyidagilardan foydalaning.",
      Markup.keyboard([['Katalog']]).resize(),
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

    if (text === "Yangi mahsulot qo'shish") {
      const isAdmin = await this.getAdminByTgId(tgId);
      if (isAdmin) {
        await this.redis.setUserState(tgId, {
          step: 'WAIT_TYPE',
          data: { photos: [] },
        });
        await ctx.reply(
          'Mahsulot turini tanlang:',
          Markup.inlineKeyboard([
            [
              Markup.button.callback('Shina', 'set_type_SHINA'),
              Markup.button.callback('Akkumulyator', 'set_type_AKKUMULYATOR'),
            ],
            [
              Markup.button.callback('Disklar', 'set_type_DISKLAR'),
              Markup.button.callback('Extiyot qism', 'set_type_EXTIYOT_QISM'),
            ],
            [Markup.button.callback('Kamera', 'set_type_KAMERA')],
            [Markup.button.callback('Bekor qilish', 'cancel_process')],
          ]),
        );
        return;
      }
    }

    if (text === 'Bekor qilish' && state) {
      await this.redis.deleteUserState(tgId);
      const isAdmin = await this.getAdminByTgId(tgId);
      const replyMarkup = isAdmin
        ? Markup.keyboard([["Yangi mahsulot qo'shish"], ['Katalog']]).resize()
        : Markup.keyboard([['Katalog']]).resize();

      await ctx.reply('Jarayon bekor qilindi.', replyMarkup);
      return;
    }

    if (
      state &&
      (state.step === 'WAIT_INC_COUNT' || state.step === 'WAIT_DEC_COUNT')
    ) {
      const countChange = Number(text.trim());
      if (isNaN(countChange) || countChange <= 0) {
        await ctx.reply('Faqat musbat raqam kiriting:');
        return;
      }

      const productId = state.data.product_id;
      const isIncrement = state.step === 'WAIT_INC_COUNT';

      try {
        if (!isIncrement) {
          const product = await this.prisma.product.findUnique({
            where: { id: productId },
          });
          if (product && product.count < countChange) {
            await ctx.reply(
              `Omborda yetarli mahsulot yo'q (Hozir: ${product.count}).`,
            );
            return;
          }
        }

        await this.prisma.product.update({
          where: { id: productId },
          data: {
            count: isIncrement
              ? { increment: countChange }
              : { decrement: countChange },
          },
        });

        await this.redis.deleteUserState(tgId);
        await ctx.reply(
          'Muvaffaqiyatli yangilandi.',
          Markup.keyboard([["Yangi mahsulot qo'shish"], ['Katalog']]).resize(),
        );
        return;
      } catch (error) {
        await ctx.reply('Xatolik yuz berdi.');
        return;
      }
    }

    if (state && state.step.startsWith('WAIT_')) {
      switch (state.step) {
        case 'WAIT_NAME':
          state.data.name = text;
          state.step = 'WAIT_PRICE';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Narxini kiriting:');
          break;

        case 'WAIT_PRICE':
          if (isNaN(Number(text))) {
            await ctx.reply('Faqat raqam kiriting:');
            return;
          }
          state.data.price = Number(text);
          state.step = 'WAIT_COUNT';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Soni:');
          break;

        case 'WAIT_COUNT':
          if (isNaN(Number(text))) {
            await ctx.reply('Faqat raqam kiriting:');
            return;
          }
          state.data.count = Number(text);
          state.step = 'WAIT_PHOTOS';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Rasm yuboring (Max: 2).');
          break;

        case 'WAIT_EDIT_NAME':
        case 'WAIT_EDIT_PRICE':
        case 'WAIT_EDIT_COUNT':
          const field = state.step.replace('WAIT_EDIT_', '').toLowerCase();
          const pId = state.data.product_id;
          let val: any = text;

          if (field === 'price' || field === 'count') {
            val = Number(text);
            if (isNaN(val)) return ctx.reply('Faqat raqam kiriting:');
          }

          try {
            await this.prisma.product.update({
              where: { id: pId },
              data: { [field]: val },
            });
            await this.redis.deleteUserState(tgId);
            await ctx.reply(
              'Yangilandi.',
              Markup.keyboard([
                ["Yangi mahsulot qo'shish"],
                ['Katalog'],
              ]).resize(),
            );
          } catch (e) {
            await ctx.reply('Xatolik.');
          }
          break;
      }
      return;
    }

    if (text === 'Katalog') {
      await ctx.reply(
        'Mahsulot turini tanlang:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Shina', 'browse_SHINA_1'),
            Markup.button.callback('Akkumulyator', 'browse_AKKUMULYATOR_1'),
          ],
          [
            Markup.button.callback('Disklar', 'browse_DISKLAR_1'),
            Markup.button.callback('Extiyot qism', 'browse_EXTIYOT_QISM_1'),
          ],
          [Markup.button.callback('Kamera', 'browse_KAMERA_1')],
        ]),
      );
      return;
    }

    await this.searchProducts(ctx, text);
  }

  @Action(/^browse_(.+)_(\d+)$/)
  async onBrowse(@Ctx() ctx: any) {
    const type = ctx.match[1] as ProductType;
    const page = parseInt(ctx.match[2]);

    const { products, total, totalPages } = await this.prisma.product
      .findMany({
        where: { type },
        include: { photos: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 10,
        take: 10,
      })
      .then(async (res) => {
        const count = await this.prisma.product.count({ where: { type } });
        return {
          products: res,
          total: count,
          totalPages: Math.ceil(count / 10),
        };
      });

    if (products.length === 0) {
      return ctx.answerCbQuery("Bu bo'limda mahsulotlar topilmadi.");
    }

    let messageText = `<b>${type} bo'limi</b> (Jami: ${total})\n\n`;
    const productButtons: any[] = [];

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const num = (page - 1) * 10 + (i + 1);
      messageText += `${num}. ${p.name} - ${p.price.toLocaleString()} $\n`;
      productButtons.push(Markup.button.callback(`${num}`, `view_p_${p.id}`));
    }

    const inlineButtons: any[][] = [];
    // Mahsulot tugmalarini qatorlarga bo'lish (har qatorda 5 tadan)
    for (let i = 0; i < productButtons.length; i += 5) {
      inlineButtons.push(productButtons.slice(i, i + 5));
    }

    // Navigatsiya tugmalari
    const navButtons: any[] = [];
    if (page > 1) {
      navButtons.push(
        Markup.button.callback('Oldingi', `browse_${type}_${page - 1}`),
      );
    }
    navButtons.push(Markup.button.callback(`${page} / ${totalPages}`, 'noop'));
    if (page < totalPages) {
      navButtons.push(
        Markup.button.callback('Keyingi', `browse_${type}_${page + 1}`),
      );
    }

    if (navButtons.length > 0) {
      inlineButtons.push(navButtons);
    }

    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(inlineButtons),
      });
    } catch (error) {
      await ctx.replyWithHTML(
        messageText,
        Markup.inlineKeyboard(inlineButtons),
      );
    }
    await ctx.answerCbQuery();
  }

  @Action(/^view_p_(.+)$/)
  async onViewProduct(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    const p = await this.prisma.product.findUnique({
      where: { id: pId },
      include: { photos: true },
    });
    if (!p) return ctx.answerCbQuery('Topilmadi');

    const caption = `<b>${p.name}</b>\nTur: ${p.type}\nNarx: ${p.price}\nSoni: ${p.count}`;
    if (p.photos.length > 0) {
      await ctx.replyWithMediaGroup(
        p.photos.map((ph) => ({ type: 'photo', media: ph.url })) as any,
      );
    }

    const isAdmin = await this.getAdminByTgId(BigInt(ctx.from.id));
    let markup: any = {};
    if (isAdmin) {
      markup = Markup.inlineKeyboard([
        [
          Markup.button.callback('-', `dec_p_${p.id}`),
          Markup.button.callback('Edit', `edit_p_${p.id}`),
          Markup.button.callback('+', `inc_p_${p.id}`),
        ],
        [
          Markup.button.callback('Rasm', `edit_photo_${p.id}`),
          Markup.button.callback("O'chirish", `del_p_${p.id}`),
        ],
      ]);
    }
    await ctx.replyWithHTML(caption, markup);
    await ctx.answerCbQuery();
  }

  @Action(/^del_p_(.+)$/)
  async onDelete(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply(
      "Rostdan ham o'chirmoqchimisiz?",
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Ha', `confirm_del_${pId}`),
          Markup.button.callback("Yo'q", 'cancel_process'),
        ],
      ]),
    );
  }

  @Action(/^confirm_del_(.+)$/)
  async onConfirmDelete(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    try {
      await this.productsService.remove(pId);
      await ctx.editMessageText("Mahsulot o'chirildi.");
      await ctx.answerCbQuery();
    } catch (e) {
      await ctx.reply('Xatolik');
    }
  }

  @Action(/^edit_photo_(.+)$/)
  async onEditPhotoStart(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    await this.redis.setUserState(BigInt(ctx.from.id), {
      step: 'WAIT_EDIT_PHOTO',
      data: { product_id: pId, photos: [] },
    });
    await ctx.answerCbQuery();
    await ctx.reply('Yangi rasmlarni yuboring (Max: 2):');
  }

  @Action('finalize_photo_edit')
  async onFinalizePhotoEdit(@Ctx() ctx: any) {
    const tgId = BigInt(ctx.from.id);
    const state = await this.redis.getUserState(tgId);
    if (!state || state.data.photos.length === 0)
      return ctx.answerCbQuery('Kamida 1 ta rasm!');

    await ctx.editMessageText('Rasmlar yangilanmoqda...');
    try {
      if (!state.data.product_id)
        return ctx.answerCbQuery('Xato: ID topilmadi');
      await this.updateProductPhotos(state.data.product_id, state.data.photos);
      await this.redis.deleteUserState(tgId);
      await ctx.reply(
        'Rasmlar yangilandi.',
        Markup.keyboard([["Yangi mahsulot qo'shish"], ['Katalog']]).resize(),
      );
      await ctx.answerCbQuery();
    } catch (e) {
      await ctx.reply('Xatolik');
    }
  }

  async updateProductPhotos(pId: string, tgFileIds: string[]) {
    // 1. Eskilarini o'chirish
    const product = await this.prisma.product.findUnique({
      where: { id: pId },
      include: { photos: true },
    });
    if (product?.photos) {
      for (const ph of product.photos) {
        await this.productsService.deletePhoto(ph.publicId).catch(() => {});
      }
      // DB dan rasmlarni o'chirish
      await this.prisma.photo.deleteMany({ where: { productId: pId } });
    }

    // 2. Yangilarini yuklash
    const token = this.configService.get<string>('BOT_TOKEN') as string;
    const newPhotos: any[] = [];
    for (const id of tgFileIds) {
      const res = await this.mediaservice.uploadTelegramPhotoToCloudinary(
        id,
        token,
      );
      newPhotos.push({ url: res.url, publicId: res.publicId });
    }
    await this.prisma.product.update({
      where: { id: pId },
      data: { photos: { create: newPhotos } },
    });
  }

  @Action('noop')
  async onNoop(@Ctx() ctx: any) {
    await ctx.answerCbQuery();
  }

  @Action(/^set_type_(.+)$/)
  async onSetType(@Ctx() ctx: any) {
    const type = ctx.match[1] as ProductType;
    const tgId = BigInt(ctx.from.id);
    const state = await this.redis.getUserState(tgId);

    if (state && state.step === 'WAIT_TYPE') {
      state.data.type = type;
      state.step = 'WAIT_NAME';
      await this.redis.setUserState(tgId, state);
      await ctx.answerCbQuery();
      await ctx.reply(
        'Mahsulot nomini kiriting:',
        Markup.keyboard([['Bekor qilish']]).resize(),
      );
    }
  }

  @Action('cancel_process')
  async onCancel(@Ctx() ctx: any) {
    const tgId = BigInt(ctx.from.id);
    await this.redis.deleteUserState(tgId);
    await ctx.answerCbQuery('Bekor qilindi');
    await ctx.editMessageText("Jarayon to'xtatildi.");
  }

  @On('photo')
  async onPhoto(@Ctx() ctx: Context) {
    const tgId = BigInt(ctx.from?.id || 0);
    const state = await this.redis.getUserState(tgId);

    if (
      state &&
      (state.step === 'WAIT_PHOTOS' || state.step === 'WAIT_EDIT_PHOTO') &&
      'message' in ctx.update &&
      'photo' in ctx.update.message
    ) {
      const photos = ctx.update.message.photo;
      if (!photos || photos.length === 0) return;
      const fileId = photos[photos.length - 1].file_id;
      if (state.data.photos.length >= 2) return ctx.reply('Max: 2 ta rasm!');

      state.data.photos.push(fileId);
      await this.redis.setUserState(tgId, state);

      const len = state.data.photos.length;
      await ctx.reply(
        `${len}-rasm qabul qilindi.`,
        Markup.inlineKeyboard([
          Markup.button.callback(
            'Saqlash',
            state.step === 'WAIT_EDIT_PHOTO'
              ? 'finalize_photo_edit'
              : 'finalize_product',
          ),
        ]),
      );
    }
  }

  @Action('finalize_product')
  async onFinalize(@Ctx() ctx: Context) {
    if (!ctx.from) return;
    const tgId = BigInt(ctx.from.id);
    const state = await this.redis.getUserState(tgId);

    if (!state || state.data.photos.length === 0)
      return ctx.answerCbQuery('Rasm yuklang!');

    await ctx.editMessageText('Saqlanmoqda...');
    try {
      await this.createProductFromBot(state.data as any, state.data.photos);
      await this.redis.deleteUserState(tgId);
      await ctx.reply(
        "Muvaffaqiyatli qo'shildi.",
        Markup.keyboard([["Yangi mahsulot qo'shish"], ['Katalog']]).resize(),
      );
    } catch (e) {
      await ctx.reply('Xatolik.');
    }
  }

  private async searchProducts(ctx: Context, query: string) {
    if (!ctx.from) return;
    const isAdmin = await this.getAdminByTgId(BigInt(ctx.from.id));
    const products = await this.prisma.product.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      include: { photos: true },
      take: 5,
    });

    if (products.length === 0) return ctx.reply('Topilmadi.');

    for (const p of products) {
      const caption = `<b>${p.name}</b>\nTur: ${p.type}\nNarx: ${p.price}\nSoni: ${p.count}`;
      if (p.photos.length > 0) {
        await ctx.replyWithMediaGroup(
          p.photos.map((ph) => ({ type: 'photo', media: ph.url })) as any,
        );
      }
      let markup: any = {};
      if (isAdmin) {
        markup = Markup.inlineKeyboard([
          [
            Markup.button.callback('-', `dec_p_${p.id}`),
            Markup.button.callback('Edit', `edit_p_${p.id}`),
            Markup.button.callback('+', `inc_p_${p.id}`),
          ],
        ]);
      }
      await ctx.replyWithHTML(caption, markup);
    }
  }

  @Action(/^inc_p_(.+)$/)
  async onInc(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    await this.redis.setUserState(BigInt(ctx.from.id), {
      step: 'WAIT_INC_COUNT',
      data: { product_id: pId, photos: [] },
    });
    await ctx.answerCbQuery();
    await ctx.reply("Qancha qo'shish kerak?");
  }

  @Action(/^dec_p_(.+)$/)
  async onDec(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    await this.redis.setUserState(BigInt(ctx.from.id), {
      step: 'WAIT_DEC_COUNT',
      data: { product_id: pId, photos: [] },
    });
    await ctx.answerCbQuery();
    await ctx.reply('Qancha ayirish kerak?');
  }

  @Action(/^edit_p_(.+)$/)
  async onEditStart(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    await this.redis.setUserState(BigInt(ctx.from.id), {
      step: 'SELECT_FIELD',
      data: { product_id: pId, photos: [] },
    });
    await ctx.answerCbQuery();
    await ctx.reply(
      "Nimani o'zgartiramiz?",
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Nom', 'edit_name'),
          Markup.button.callback('Narx', 'edit_price'),
          Markup.button.callback('Son', 'edit_count'),
        ],
      ]),
    );
  }

  @Action(/^edit_(name|price|count)$/)
  async onFieldSelect(@Ctx() ctx: any) {
    const state = await this.redis.getUserState(BigInt(ctx.from.id));
    if (!state) return ctx.answerCbQuery('Xato');
    state.step = `WAIT_EDIT_${ctx.match[1].toUpperCase()}`;
    await this.redis.setUserState(BigInt(ctx.from.id), state);
    await ctx.answerCbQuery();
    await ctx.reply('Yangi qiymatni kiriting:');
  }

  async getAdminByTgId(id: bigint) {
    return this.prisma.admin.findUnique({ where: { telegram_id: id } });
  }

  async createProductFromBot(payload: CreateProductDto, tgFileIds: string[]) {
    const token = this.configService.get<string>('BOT_TOKEN') as string;
    const photos: any[] = [];
    for (const id of tgFileIds) {
      const res = await this.mediaservice.uploadTelegramPhotoToCloudinary(
        id,
        token,
      );
      photos.push({ url: res.url, publicId: res.publicId });
    }
    return this.prisma.product.create({
      data: { ...payload, photos: { create: photos } },
    });
  }
}
