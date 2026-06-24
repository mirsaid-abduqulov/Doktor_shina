import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Action, Ctx, InjectBot, On, Start, Update } from 'nestjs-telegraf';
import { PrismaService } from 'src/core/database/prisma.service';
import { Context, Markup, Telegraf } from 'telegraf';
import { CreateProductDto } from '../products/dto/create-product.dto';
import { MediaService } from '../media/media.service';
import { RedisService, UserState } from '../redis/redis.service';
import { ProductsService } from '../products/products.service';
import { Prisma } from '@prisma/client';
import { normalize } from 'path';
import { normalizeName } from '../admins/admins.service';
import { Role } from '../admins/dto/create-admin.dto';
import { CategoriesService } from '../categories/categories.service';

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
    private readonly categoriesService: CategoriesService,
  ) { }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    if (!ctx.from) return;

    const user = await this.getAdminByTgId(BigInt(ctx.from.id));

    if (user) {
      await ctx.reply(
        `Xush kelibsiz, ${user.fullName}! (${user.role.toUpperCase()})`,
        this.getMainKeyboard(user.role),
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
    const user = await this.getAdminByTgId(tgId);
    const role = user?.role;

    // 1. Bekor qilish (Har doim birinchi)
    if (text === 'Bekor qilish' && state) {
      await this.redis.deleteUserState(tgId);
      await ctx.reply('Jarayon bekor qilindi.', this.getMainKeyboard(role));
      return;
    }

    // 2. Yangi mahsulot qo'shish boshlanishi
    if (text === "Yangi mahsulot qo'shish") {
      if (role === 'super_admin' || role === 'admin' || role === 'staff') {
        const categories = await this.prisma.category.findMany({
          where: { parentId: null },
        });

        await this.redis.setUserState(tgId, {
          step: 'WAIT_CATEGORY',
          data: { photos: [] },
        });

        const buttons = categories.map((c) => [
          Markup.button.callback(c.name, `set_cat_${c.id}`),
        ]);
        buttons.push([Markup.button.callback('Bekor qilish', 'cancel_process')]);

        await ctx.reply(
          'Mahsulot kategoriyasini tanlang:',
          Markup.inlineKeyboard(buttons),
        );
        return;
      }
    }

    // 3. Xodimlarni boshqarish
    if (text === 'Xodimlarni boshqarish') {
      if (role === 'super_admin' || role === 'admin') {
        await ctx.reply(
          'Xodimlarni boshqarish bo\'limi:',
          Markup.inlineKeyboard([
            [Markup.button.callback('👥 Xodimlar ro\'yxati', 'list_staff')],
            [Markup.button.callback('➕ Yangi xodim qo\'shish', 'add_staff_start')],
          ]),
        );
        return;
      }
    }

    // 4. Katalog
    if (text === 'Katalog') {
      const categories = await this.prisma.category.findMany({
        where: { parentId: null },
      });

      if (categories.length === 0) {
        await ctx.reply("Hali kategoriyalar yo'q.");
      }

      const buttons = categories.map((c) => [
        Markup.button.callback(c.name, `browse_cat_${c.id}_1`),
      ]);

      if (role === 'super_admin' || role === 'admin') {
        buttons.push([Markup.button.callback("➕ Yangi kategoriya qo'shish", 'add_cat_root')]);
        buttons.push([
          Markup.button.callback("✏️ Tahrirlash", 'edit_cat_list_root'),
          Markup.button.callback("🗑️ O'chirish", 'delete_cat_list_root')
        ]);
      }

      await ctx.reply(
        'Kategoriyani tanlang:',
        Markup.inlineKeyboard(buttons),
      );
      return;
    }

    // 5. Ombordagi sonni o'zgartirish
    if (
      state &&
      (state.step === 'WAIT_INC_COUNT' || state.step === 'WAIT_DEC_COUNT')
    ) {
      const countChange = Number(text.trim());
      if (isNaN(countChange) || countChange <= 0) {
        return ctx.reply('Faqat musbat raqam kiriting:');
      }

      const productId = state.data.product_id;
      const isIncrement = state.step === 'WAIT_INC_COUNT';

      try {
        if (!isIncrement) {
          const product = await this.prisma.product.findUnique({
            where: { id: productId },
          });
          if (product && product.stockQty < countChange) {
            return ctx.reply(`Omborda yetarli mahsulot yo'q (Hozir: ${product.stockQty}).`);
          }
        }

        await this.prisma.product.update({
          where: { id: productId },
          data: {
            stockQty: isIncrement
              ? { increment: countChange }
              : { decrement: countChange },
          },
        });

        await this.redis.deleteUserState(tgId);
        await ctx.reply('Muvaffaqiyatli yangilandi.', this.getMainKeyboard(role));
        return;
      } catch (error) {
        return ctx.reply('Xatolik yuz berdi.');
      }
    }

    // 6. Qolgan WAIT holatlari
    if (state && state.step.startsWith('WAIT_')) {
      switch (state.step) {
        case 'WAIT_NEW_CATEGORY_NAME':
          await this.handleCreateCategory(ctx, tgId, state, text);
          break;

        case 'WAIT_NAME':
          state.data.name = text;
          state.step = 'WAIT_PRICE';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Narxini kiriting:');
          break;

        case 'WAIT_PRICE':
          if (isNaN(Number(text))) return ctx.reply('Faqat raqam kiriting:');
          state.data.price = Number(text);
          state.step = 'WAIT_COUNT';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Soni:');
          break;

        case 'WAIT_COUNT':
          if (isNaN(Number(text))) return ctx.reply('Faqat raqam kiriting:');
          state.data.stockQty = Number(text);
          state.step = 'WAIT_PHOTOS';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Rasm yuboring (Max: 2).');
          break;

        case 'WAIT_EDIT_NAME':
        case 'WAIT_EDIT_PRICE':
        case 'WAIT_EDIT_STOCK_QTY':
          await this.handleEditField(ctx, tgId, state, text);
          break;

        case 'WAIT_EDIT_CATEGORY_NAME':
          await this.handleEditCategoryName(ctx, tgId, state, text);
          break;

        // Staff Management States
        case 'WAIT_STAFF_NAME':
          state.data.name = text; // Reuse field
          state.step = 'WAIT_STAFF_TG_ID';
          await this.redis.setUserState(tgId, state);
          await ctx.reply('Ushbu xodimning Telegram ID raqamini yuboring (Masalan: 123456789):');
          break;

        case 'WAIT_STAFF_TG_ID':
          await this.handleCreateStaff(ctx, tgId, state, text);
          break;

        case 'WAIT_EDIT_STAFF_NAME':
          await this.handleEditStaffName(ctx, tgId, state, text);
          break;
      }
      return;
    }

    await this.searchProducts(ctx, text);
  }

  // --- Category Logic ---

  @Action('add_cat_root')
  async onAddCatRoot(@Ctx() ctx: any) {
    const tgId = BigInt(ctx.from.id);
    await this.redis.setUserState(tgId, {
      step: 'WAIT_NEW_CATEGORY_NAME',
      data: { photos: [], categoryId: null } as any,
    });
    await ctx.answerCbQuery();
    await ctx.reply('Yangi kategoriya nomini kiriting:', Markup.keyboard([['Bekor qilish']]).resize());
  }

  @Action(/^add_subcat_(.+)$/)
  async onAddSubCat(@Ctx() ctx: any) {
    const parentId = ctx.match[1];
    const tgId = BigInt(ctx.from.id);
    await this.redis.setUserState(tgId, {
      step: 'WAIT_NEW_CATEGORY_NAME',
      data: { photos: [], categoryId: parentId } as any,
    });
    await ctx.answerCbQuery();
    await ctx.reply('Yangi ichki kategoriya nomini kiriting:', Markup.keyboard([['Bekor qilish']]).resize());
  }

  async handleCreateCategory(ctx: Context, tgId: bigint, state: UserState, text: string) {
    const parentId = state.data.categoryId;
    const name = normalizeName(text);
    try {
      const category = await this.prisma.category.create({
        data: {
          name,
          parentId: parentId || null,
        },
      });
      await this.redis.deleteUserState(tgId);

      const user = await this.getAdminByTgId(tgId);
      await ctx.reply(
        `Kategoriya "${name}" muvaffaqiyatli yaratildi. ✅`,
        this.getMainKeyboard(user?.role),
      );

      // Stay in the same view
      return this.showCategoryView(ctx, category.id, 1);
    } catch (e) {
      await ctx.reply('Kategoriya yaratishda xatolik.');
    }
  }

  @Action('edit_cat_list_root')
  async onEditCatListRoot(@Ctx() ctx: any) {
    const categories = await this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { name: 'asc' },
    });

    const buttons = categories.map((c) => [
      Markup.button.callback(`✏️ ${c.name}`, `edit_cat_start_${c.id}`),
    ]);
    buttons.push([Markup.button.callback('⬅️ Orqaga', 'back_to_catalog')]);

    await ctx.editMessageText('Tahrirlash uchun kategoriyani tanlang:', Markup.inlineKeyboard(buttons));
    await ctx.answerCbQuery();
  }

  @Action('delete_cat_list_root')
  async onDeleteCatListRoot(@Ctx() ctx: any) {
    const categories = await this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { name: 'asc' },
    });

    const buttons = categories.map((c) => [
      Markup.button.callback(`🗑️ ${c.name}`, `delete_cat_confirm_${c.id}`),
    ]);
    buttons.push([Markup.button.callback('⬅️ Orqaga', 'back_to_catalog')]);

    await ctx.editMessageText('O\'chirish uchun kategoriyani tanlang:', Markup.inlineKeyboard(buttons));
    await ctx.answerCbQuery();
  }

  @Action(/^edit_cat_start_(.+)$/)
  async onEditCatStart(@Ctx() ctx: any) {
    const categoryId = ctx.match[1];
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) return ctx.answerCbQuery('Kategoriya topilmadi');

    await this.redis.setUserState(BigInt(ctx.from.id), {
      step: 'WAIT_EDIT_CATEGORY_NAME',
      data: { categoryId } as any,
    });

    await ctx.answerCbQuery();
    await ctx.reply(
      `<b>${category.name}</b> uchun yangi nom kiriting:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([['Bekor qilish']]).resize(),
      }
    );
  }

  async handleEditCategoryName(ctx: Context, tgId: bigint, state: UserState, text: string) {
    const categoryId = (state.data as any).categoryId;
    const name = normalizeName(text);

    try {
      await this.categoriesService.update(categoryId, { name });
      await this.redis.deleteUserState(tgId);
      const user = await this.getAdminByTgId(tgId);
      await ctx.reply(`Kategoriya nomi o'zgartirildi: ${name} ✅`, this.getMainKeyboard(user?.role));
      return this.showCategoryView(ctx, categoryId, 1);
    } catch (e) {
      await ctx.reply('Xatolik yuz berdi.');
    }
  }

  @Action(/^delete_cat_confirm_(.+)$/)
  async onDeleteCatConfirm(@Ctx() ctx: any) {
    const categoryId = ctx.match[1];
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) return ctx.answerCbQuery('Kategoriya topilmadi');

    await ctx.editMessageText(
      `Rostdan ham <b>${category.name}</b> kategoriyasini o'chirmoqchimisiz?`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Ha', `delete_cat_execute_${categoryId}`),
            Markup.button.callback('❌ Yo\'q', `browse_cat_${categoryId}_1`),
          ],
        ]),
      }
    );
    await ctx.answerCbQuery();
  }

  @Action(/^delete_cat_execute_(.+)$/)
  async onDeleteCatExecute(@Ctx() ctx: any) {
    const categoryId = ctx.match[1];
    try {
      await this.categoriesService.remove(categoryId);
      await ctx.editMessageText('Kategoriya o\'chirildi ✅');
      await ctx.answerCbQuery();
      
      // Go back to catalog or parent
      const tgId = BigInt(ctx.from.id);
      const user = await this.getAdminByTgId(tgId);
      const categories = await this.prisma.category.findMany({
        where: { parentId: null },
      });

      const buttons = categories.map((c) => [
        Markup.button.callback(c.name, `browse_cat_${c.id}_1`),
      ]);
      if (user?.role === 'super_admin' || user?.role === 'admin') {
        buttons.push([Markup.button.callback("➕ Yangi kategoriya qo'shish", 'add_cat_root')]);
        buttons.push([
          Markup.button.callback("✏️ Tahrirlash", 'edit_cat_list_root'),
          Markup.button.callback("🗑️ O'chirish", 'delete_cat_list_root')
        ]);
      }

      await ctx.reply('Asosiy katalog:', Markup.inlineKeyboard(buttons));

    } catch (e) {
      const message = e.response?.message || 'Xatolik yuz berdi. Kategoriyada mahsulotlar yoki ichki bo\'limlar bo\'lishi mumkin.';
      await ctx.answerCbQuery(message, { show_alert: true });
    }
  }

  async showCategoryView(ctx: any, categoryId: string, page: number) {
    const tgId = BigInt(ctx.from.id);
    const user = await this.getAdminByTgId(tgId);
    const role = user?.role;

    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      include: { parent: true },
    });
    if (!category) return;

    const children = await this.prisma.category.findMany({
      where: { parentId: categoryId },
      orderBy: { name: 'asc' },
    });

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: { categoryId },
        include: { photos: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 5,
        take: 5,
      }),
      this.prisma.product.count({ where: { categoryId } }),
    ]);

    const totalPages = Math.ceil(total / 5);

    let messageText = `📂 <b>${category.name}</b>\n`;
    if (category.parent) messageText += `⬆️ Yuqori: ${category.parent.name}\n`;
    messageText += `------------------------\n\n`;

    const inlineButtons: any[][] = [];

    if (children.length > 0) {
      messageText += `<b>Pastki bo'limlar:</b>\n`;
      children.forEach((c) => {
        inlineButtons.push([Markup.button.callback(`📁 ${c.name}`, `browse_cat_${c.id}_1`)]);
      });
      messageText += `\n`;
    }

    if (products.length > 0) {
      messageText += `<b>Mahsulotlar:</b> (Jami: ${total})\n`;
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const num = (page - 1) * 5 + (i + 1);
        messageText += `${num}. ${p.name} - ${Number(p.price).toLocaleString()} $\n`;
        inlineButtons.push([Markup.button.callback(`🛒 ${num}. ${p.name}`, `view_p_${p.id}`)]);
      }
    } else if (children.length === 0) {
      messageText += `<i>Bu bo'limda mahsulotlar yo'q.</i>\n`;
    }

    if (role === 'super_admin' || role === 'admin') {
      inlineButtons.push([
        Markup.button.callback("➕ Yangi ichki kategoriya", `add_subcat_${categoryId}`),
      ]);
      inlineButtons.push([
        Markup.button.callback("✏️ Kategoriyani tahrirlash", `edit_cat_start_${categoryId}`),
        Markup.button.callback("🗑️ Kategoriyani o'chirish", `delete_cat_confirm_${categoryId}`),
      ]);
    }

    const navButtons: any[] = [];
    if (page > 1) navButtons.push(Markup.button.callback('⬅️ Oldingi', `browse_cat_${categoryId}_${page - 1}`));
    if (totalPages > 1) navButtons.push(Markup.button.callback(`${page} / ${totalPages}`, 'noop'));
    if (page < totalPages) navButtons.push(Markup.button.callback('Keyingi ➡️', `browse_cat_${categoryId}_${page + 1}`));
    if (navButtons.length > 0) inlineButtons.push(navButtons);

    const backBtn = category.parentId
      ? Markup.button.callback('⬅️ Orqaga', `browse_cat_${category.parentId}_1`)
      : Markup.button.callback('⬅️ Asosiy katalog', 'back_to_catalog');
    inlineButtons.push([backBtn]);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(messageText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(inlineButtons),
      });
    } else {
      await ctx.replyWithHTML(messageText, Markup.inlineKeyboard(inlineButtons));
    }
  }

  @Action(/^browse_cat_(.+)_(\d+)$/)
  async onBrowse(@Ctx() ctx: any) {
    const categoryId = ctx.match[1];
    const page = parseInt(ctx.match[2]);
    await this.showCategoryView(ctx, categoryId, page);
    await ctx.answerCbQuery();
  }

  @Action('back_to_catalog')
  async onBackToCatalog(@Ctx() ctx: any) {
    const tgId = BigInt(ctx.from.id);
    const user = await this.getAdminByTgId(tgId);
    const categories = await this.prisma.category.findMany({
      where: { parentId: null },
    });

    const buttons = categories.map((c) => [
      Markup.button.callback(c.name, `browse_cat_${c.id}_1`),
    ]);
    if (user?.role === 'super_admin' || user?.role === 'admin') {
      buttons.push([Markup.button.callback("➕ Yangi kategoriya qo'shish", 'add_cat_root')]);
      buttons.push([
        Markup.button.callback("✏️ Tahrirlash", 'edit_cat_list_root'),
        Markup.button.callback("🗑️ O'chirish", 'delete_cat_list_root')
      ]);
    }

    await ctx.editMessageText('Kategoriyalarni tanlang:', Markup.inlineKeyboard(buttons));
    await ctx.answerCbQuery();
  }

  // --- Staff Management Logic ---

  @Action('add_staff_start')
  async onAddStaffStart(@Ctx() ctx: any) {
    const tgId = BigInt(ctx.from.id);
    const user = await this.getAdminByTgId(tgId);
    if (!user) return;

    const buttons: any[] = [];
    if (user.role === 'super_admin') {
      buttons.push([Markup.button.callback('Admin', 'add_staff_role_admin')]);
    }
    buttons.push([Markup.button.callback('Staff', 'add_staff_role_staff')]);
    buttons.push([Markup.button.callback('Bekor qilish', 'cancel_process')]);

    await ctx.editMessageText(
      'Yangi xodim uchun rolni tanlang:',
      Markup.inlineKeyboard(buttons),
    );
    await ctx.answerCbQuery();
  }

  @Action(/^add_staff_role_(.+)$/)
  async onSetStaffRole(@Ctx() ctx: any) {
    const role = ctx.match[1];
    const tgId = BigInt(ctx.from.id);

    await this.redis.setUserState(tgId, {
      step: 'WAIT_STAFF_NAME',
      data: { photos: [], role } as any,
    });

    await ctx.answerCbQuery();
    await ctx.reply(
      `Yangi ${role.toUpperCase()}ning to'liq ismini (F.I.O) kiriting:`,
      Markup.keyboard([['Bekor qilish']]).resize(),
    );
  }

  async handleCreateStaff(ctx: Context, tgId: bigint, state: UserState, text: string) {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) {
      return ctx.reply('Iltimos, faqat raqamlardan iborat Telegram ID yuboring:');
    }
    const staffTgId = BigInt(trimmed);

    const { role, name: fullName } = state.data as any;

    try {
      await this.prisma.admin.create({
        data: {
          telegramId: staffTgId,
          fullName: normalizeName(fullName),
          role: role,
          isActive: true,
        },
      });

      await this.redis.deleteUserState(tgId);
      const user = await this.getAdminByTgId(tgId);
      await ctx.reply(
        `Yangi ${role.toUpperCase()} muvaffaqiyatli qo'shildi! ✅`,
        this.getMainKeyboard(user?.role),
      );
    } catch (e) {
      if (e.code === 'P2002') {
        await ctx.reply('Ushbu Telegram ID allaqachon ro\'yxatdan o\'tgan! Iltimos, boshqa ID kiriting:');
      } else {
        await ctx.reply('Xodimni saqlashda xatolik yuz berdi.');
      }
    }
  }

  @Action('list_staff')
  async onListStaff(@Ctx() ctx: any) {
    const staff = await this.prisma.admin.findMany({
      orderBy: { role: 'asc' },
    });

    const buttons = staff.map((s) => [
      Markup.button.callback(`${s.fullName} (${s.role.toUpperCase()})`, `view_staff_${s.id}`),
    ]);
    buttons.push([Markup.button.callback('⬅️ Orqaga', 'cancel_process')]);

    await ctx.editMessageText('👥 <b>Xodimlar ro\'yxati:</b>\nTanlash uchun bosing:', {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
    await ctx.answerCbQuery();
  }

  @Action(/^view_staff_(.+)$/)
  async onViewStaff(@Ctx() ctx: any) {
    const staffId = ctx.match[1];
    const staff = await this.prisma.admin.findUnique({ where: { id: staffId } });
    if (!staff) return ctx.answerCbQuery('Xodim topilmadi');

    const currentUser = await this.getAdminByTgId(BigInt(ctx.from.id));
    if (!currentUser) return;

    const canEdit = this.checkCanEdit(currentUser.role, staff.role, currentUser.id, staff.id);

    let text = `👤 <b>Xodim ma'lumotlari:</b>\n\n`;
    text += `Ism: <b>${staff.fullName}</b>\n`;
    text += `Role: ${staff.role.toUpperCase()}\n`;
    text += `Telegram ID: <code>${staff.telegramId}</code>\n`;
    text += `Status: ${staff.isActive ? '✅ Faol' : '❌ Faol emas'}\n`;

    const buttons: any[][] = [];
    if (canEdit) {
      buttons.push([
        Markup.button.callback('📝 Ismni tahrirlash', `edit_staff_name_${staff.id}`),
        Markup.button.callback(`${staff.isActive ? '🔴 Faolsizlantirish' : '🟢 Faollashtirish'}`, `toggle_staff_status_${staff.id}`),
      ]);
      
      const roleButtons: any[] = [];
      if (currentUser.role === 'super_admin') {
        if (staff.role !== 'admin') roleButtons.push(Markup.button.callback('➡️ Admin qilish', `set_staff_role_admin_${staff.id}`));
        if (staff.role !== 'staff') roleButtons.push(Markup.button.callback('➡️ Staff qilish', `set_staff_role_staff_${staff.id}`));
      } else if (currentUser.role === 'admin' && staff.role !== 'staff') {
        roleButtons.push(Markup.button.callback('➡️ Staff qilish', `set_staff_role_staff_${staff.id}`));
      }
      if (roleButtons.length > 0) buttons.push(roleButtons);
    }
    
    buttons.push([Markup.button.callback('⬅️ Ro\'yxatga qaytish', 'list_staff')]);

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons),
    });
    await ctx.answerCbQuery();
  }

  private checkCanEdit(actorRole: string, targetRole: string, actorId: string, targetId: string): boolean {
    if (actorId === targetId) return false;
    if (actorRole === 'super_admin' && (targetRole === 'admin' || targetRole === 'staff')) return true;
    if (actorRole === 'admin' && targetRole === 'staff') return true;
    return false;
  }

  @Action(/^toggle_staff_status_(.+)$/)
  async onToggleStaffStatus(@Ctx() ctx: any) {
    const staffId = ctx.match[1];
    const staff = await this.prisma.admin.findUnique({ where: { id: staffId } });
    if (!staff) return ctx.answerCbQuery('Xodim topilmadi');

    const currentUser = await this.getAdminByTgId(BigInt(ctx.from.id));
    if (!currentUser || !this.checkCanEdit(currentUser.role, staff.role, currentUser.id, staff.id)) {
      return ctx.answerCbQuery('Ruxsat yo\'q');
    }

    await this.prisma.admin.update({
      where: { id: staffId },
      data: { isActive: !staff.isActive },
    });

    await ctx.answerCbQuery(`Status o'zgartirildi: ${!staff.isActive ? 'Faol' : 'Faol emas'}`);
    return this.onViewStaff(ctx);
  }

  @Action(/^set_staff_role_(admin|staff)_(.+)$/)
  async onSetStaffRoleUpdate(@Ctx() ctx: any) {
    const newRole = ctx.match[1];
    const staffId = ctx.match[2];
    const staff = await this.prisma.admin.findUnique({ where: { id: staffId } });
    if (!staff) return ctx.answerCbQuery('Xodim topilmadi');

    const currentUser = await this.getAdminByTgId(BigInt(ctx.from.id));
    if (!currentUser || !this.checkCanEdit(currentUser.role, staff.role, currentUser.id, staff.id)) {
      return ctx.answerCbQuery('Ruxsat yo\'q');
    }

    // Role check for specific transitions
    if (currentUser.role === 'admin' && newRole !== 'staff') {
      return ctx.answerCbQuery('Admin faqat staff tayinlashi mumkin');
    }

    await this.prisma.admin.update({
      where: { id: staffId },
      data: { role: newRole as Role },
    });

    await ctx.answerCbQuery(`Rol o'zgartirildi: ${newRole.toUpperCase()}`);
  }

  @Action(/^edit_staff_name_(.+)$/)
  async onEditStaffNameStart(@Ctx() ctx: any) {
    const staffId = ctx.match[1];
    const staff = await this.prisma.admin.findUnique({ where: { id: staffId } });
    if (!staff) return ctx.answerCbQuery('Xodim topilmadi');

    const currentUser = await this.getAdminByTgId(BigInt(ctx.from.id));
    if (!currentUser || !this.checkCanEdit(currentUser.role, staff.role, currentUser.id, staff.id)) {
      return ctx.answerCbQuery('Ruxsat yo\'q');
    }

    await this.redis.setUserState(BigInt(ctx.from.id), {
      step: 'WAIT_EDIT_STAFF_NAME',
      data: { staff_id: staffId } as any,
    });

    await ctx.answerCbQuery();
    await ctx.reply(`<b>${staff.fullName}</b> uchun yangi ism kiriting:`, {
      parse_mode: 'HTML',
      ...Markup.keyboard([['Bekor qilish']]).resize(),
    });
  }

  async handleEditStaffName(ctx: Context, tgId: bigint, state: UserState, text: string) {
    const staffId = (state.data as any).staff_id;
    const name = normalizeName(text);

    try {
      await this.prisma.admin.update({
        where: { id: staffId },
        data: { fullName: name },
      });

      await this.redis.deleteUserState(tgId);
      const user = await this.getAdminByTgId(tgId);
      await ctx.reply(`Xodim ismi o'zgartirildi: ${name} ✅`, this.getMainKeyboard(user?.role));
      
      // We can't easily return to the view message because it's in history, 
      // but we can send a new view or just leave it at the keyboard.
    } catch (e) {
      await ctx.reply('Xatolik yuz berdi.');
    }
  }

  // --- Product Logic ---

  @Action(/^set_cat_(.+)$/)
  async onSetCategory(@Ctx() ctx: any) {
    const categoryId = ctx.match[1];
    const tgId = BigInt(ctx.from.id);
    const state = await this.redis.getUserState(tgId);

    if (state && state.step === 'WAIT_CATEGORY') {
      const subCategories = await this.prisma.category.findMany({
        where: { parentId: categoryId },
      });

      if (subCategories.length > 0) {
        const buttons = subCategories.map((c) => [
          Markup.button.callback(c.name, `set_cat_${c.id}`),
        ]);
        const currentCat = await this.prisma.category.findUnique({ where: { id: categoryId } });
        const backBtn = currentCat?.parentId
          ? Markup.button.callback('⬅️ Orqaga', `set_cat_${currentCat.parentId}`)
          : Markup.button.callback('⬅️ Boshiga', 'reset_category_selection');

        buttons.push([backBtn]);

        await ctx.editMessageText(
          `<b>${currentCat?.name}</b> ichidan tanlang:`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
        );
        return;
      }

      state.data.categoryId = categoryId;
      state.step = 'WAIT_NAME';
      await this.redis.setUserState(tgId, state);
      const currentCat = await this.prisma.category.findUnique({ where: { id: categoryId } });
      await ctx.answerCbQuery();
      await ctx.editMessageText(`${currentCat?.name} kategoriya tanlandi ✅`);
      await ctx.reply('Mahsulot nomini kiriting:', Markup.keyboard([['Bekor qilish']]).resize());
    }
  }

  @Action('reset_category_selection')
  async onResetCategorySelection(@Ctx() ctx: any) {
    const categories = await this.prisma.category.findMany({ where: { parentId: null } });
    const buttons = categories.map((c) => [Markup.button.callback(c.name, `set_cat_${c.id}`)]);
    buttons.push([Markup.button.callback('Bekor qilish', 'cancel_process')]);
    await ctx.editMessageText('Kategoriyani tanlang:', Markup.inlineKeyboard(buttons));
  }

  @Action(/^view_p_(.+)$/)
  async onViewProduct(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    const p = await this.prisma.product.findUnique({
      where: { id: pId },
      include: { photos: true, category: true },
    });
    if (!p) return ctx.answerCbQuery('Topilmadi');

    const caption = `<b>${p.name}</b>\nKategoriya: ${p.category.name}\nNarx: ${Number(p.price)} $\nSoni: ${p.stockQty} ${p.unit}`;

    if (p.photos.length > 0) {
      try {
        await ctx.replyWithMediaGroup(
          p.photos.map((ph) => ({ type: 'photo', media: ph.url })) as any,
        );
      } catch (e) { }
    }

    const user = await this.getAdminByTgId(BigInt(ctx.from.id));
    const role = user?.role;
    let markup: any = {};
    if (role === 'super_admin' || role === 'admin' || role === 'staff') {
      markup = Markup.inlineKeyboard([
        [
          Markup.button.callback('-', `dec_p_${p.id}`),
          Markup.button.callback('Edit', `edit_p_${p.id}`),
          Markup.button.callback('+', `inc_p_${p.id}`),
        ],
        [Markup.button.callback("❌ O'chirish", `del_p_${p.id}`)],
      ]);
    }
    await ctx.replyWithHTML(caption, markup);
    await ctx.answerCbQuery();
  }

  // --- Handlers & Helpers ---

  async handleEditField(ctx: Context, tgId: bigint, state: UserState, text: string) {
    const rawField = state.step.replace('WAIT_EDIT_', '').toLowerCase();
    const field = rawField === 'stock_qty' ? 'stockQty' : rawField;
    const pId = state.data.product_id;
    let val: any = text;

    if (field === 'price' || field === 'stockQty') {
      val = Number(val);
      if (isNaN(val)) return ctx.reply('Faqat raqam kiriting:');
      if (field === 'price') val = new Prisma.Decimal(val);
    }

    try {
      await this.prisma.product.update({
        where: { id: pId },
        data: { [field]: val },
      });
      await this.redis.deleteUserState(tgId);
      const user = await this.getAdminByTgId(tgId);
      await ctx.reply('Yangilandi ✅', this.getMainKeyboard(user?.role));
    } catch (e) {
      await ctx.reply('Xatolik yuz berdi.');
    }
  }

  getMainKeyboard(role?: string) {
    const buttons = [['Katalog'], ["Yangi mahsulot qo'shish"]];
    if (role === 'super_admin' || role === 'admin') {
      buttons.push(['Xodimlarni boshqarish']);
    }
    return Markup.keyboard(buttons).resize();
  }

  @Action(/^del_p_(.+)$/)
  async onDelete(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply(
      "Rostdan ham o'chirmoqchimisiz?",
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Ha', `confirm_del_${pId}`),
          Markup.button.callback("❌ Yo'q", 'cancel_process'),
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
      await this.updateProductPhotos(state.data.product_id!, state.data.photos);
      await this.redis.deleteUserState(tgId);
      const user = await this.getAdminByTgId(tgId);
      await ctx.reply('Rasmlar yangilandi ✅', this.getMainKeyboard(user?.role));
      await ctx.answerCbQuery();
    } catch (e) {
      await ctx.reply('Xatolik');
    }
  }

  async updateProductPhotos(pId: string, tgFileIds: string[]) {
    const product = await this.prisma.product.findUnique({
      where: { id: pId },
      include: { photos: true },
    });
    if (product?.photos) {
      for (const ph of product.photos) {
        await this.productsService.deletePhoto(ph.publicId).catch(() => { });
      }
      await this.prisma.photo.deleteMany({ where: { productId: pId } });
    }

    const token = this.configService.get<string>('BOT_TOKEN') as string;
    const newPhotos: any[] = [];
    for (const id of tgFileIds) {
      const res = await this.mediaservice.uploadTelegramPhotoToCloudinary(id, token);
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
          [
            Markup.button.callback(
              'Saqlash',
              state.step === 'WAIT_EDIT_PHOTO'
                ? 'finalize_photo_edit'
                : 'finalize_product',
            ),
          ]
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
      const user = await this.getAdminByTgId(tgId);
      if (!user) throw new Error('User not found');

      const payload: CreateProductDto = {
        name: state.data.name!,
        categoryId: state.data.categoryId!,
        price: state.data.price!,
        stockQty: state.data.stockQty!,
        createdById: user.id,
        unit: state.data.unit || 'dona',
      };

      await this.createProductFromBot(payload, state.data.photos);
      await this.redis.deleteUserState(tgId);
      await ctx.reply("Muvaffaqiyatli qo'shildi ✅", this.getMainKeyboard(user.role));
    } catch (e) {
      await ctx.reply('Xatolik yuz berdi saqlashda.');
    }
  }

  private async searchProducts(ctx: Context, query: string) {
    if (!ctx.from) return;
    const user = await this.getAdminByTgId(BigInt(ctx.from.id));
    const role = user?.role;
    const products = await this.prisma.product.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      include: { photos: true, category: true },
      take: 5,
    });

    if (products.length === 0) return ctx.reply('Topilmadi.');

    for (const p of products) {
      const caption = `<b>${p.name}</b>\nKategoriya: ${p.category.name}\nNarx: ${Number(p.price)} $\nSoni: ${p.stockQty} ${p.unit}`;
      if (p.photos.length > 0) {
        try {
          await ctx.replyWithMediaGroup(
            p.photos.map((ph) => ({ type: 'photo', media: ph.url })) as any,
          );
        } catch (e) { }
      }
      let markup: any = {};
      if (role === 'super_admin' || role === 'admin' || role === 'staff') {
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
    await ctx.reply("Qancha qo'shish kerak?", Markup.keyboard([['Bekor qilish']]).resize());
  }

  @Action(/^dec_p_(.+)$/)
  async onDec(@Ctx() ctx: any) {
    const pId = ctx.match[1];
    await this.redis.setUserState(BigInt(ctx.from.id), {
      step: 'WAIT_DEC_COUNT',
      data: { product_id: pId, photos: [] },
    });
    await ctx.answerCbQuery();
    await ctx.reply('Qancha ayirish kerak?', Markup.keyboard([['Bekor qilish']]).resize());
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
          Markup.button.callback('Soni', 'edit_stock_qty'),
          Markup.button.callback('Rasm', `edit_photo_${pId}`),
        ],
        [Markup.button.callback('Bekor qilish', 'cancel_process')],
      ]),
    );
  }

  @Action(/^edit_(name|price|stock_qty)$/)
  async onFieldSelect(@Ctx() ctx: any) {
    const state = await this.redis.getUserState(BigInt(ctx.from.id));
    if (!state) return ctx.answerCbQuery('Xato');
    state.step = `WAIT_EDIT_${ctx.match[1].toUpperCase()}`;
    await this.redis.setUserState(BigInt(ctx.from.id), state);
    await ctx.answerCbQuery();
    await ctx.reply('Yangi qiymatni kiriting:', Markup.keyboard([['Bekor qilish']]).resize());
  }

  async getAdminByTgId(id: bigint) {
    return this.prisma.admin.findUnique({ where: { telegramId: id } });
  }

  async createProductFromBot(payload: CreateProductDto, tgFileIds: string[]) {
    const token = this.configService.get<string>('BOT_TOKEN') as string;
    const photos: any[] = [];
    for (const id of tgFileIds) {
      const res = await this.mediaservice.uploadTelegramPhotoToCloudinary(id, token);
      photos.push({ url: res.url, publicId: res.publicId });
    }
    return this.prisma.product.create({
      data: {
        name: normalizeName(payload.name),
        categoryId: payload.categoryId,
        createdById: payload.createdById,
        price: new Prisma.Decimal(payload.price),
        stockQty: payload.stockQty,
        unit: payload.unit,
        photos: { create: photos }
      },
    });
  }
}
