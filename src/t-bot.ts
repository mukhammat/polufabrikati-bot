import { Bot, GrammyError, InlineKeyboard } from "grammy";
import products from '../products.json'
import { Context } from "hono";

// In-memory cache for cart state
const cartCache: Map<string, Map<number, number>> = new Map();

export const tBot = async (bot: Bot, c: Context) => {
    const welcome = `🌙 <b>Ассаляму алейкум ва рохматуллахи ва баракатух!</b>
    
✨ Добро пожаловать в наш магазин домашних полуфабрикатов!

🏠 У нас вы найдёте свежую и вкусную продукцию <b>собственного приготовления</b>, сделанную с душой и заботой о качестве.

━━━━━━━━━━━━━━━━━━━━
🎁 <b>Выгодные условия:</b>

🎉 При заказе от <b>5 кг</b> — бесплатная доставка
💎 При заказе от <b>10 кг</b> — скидка <b>10%</b> + бесплатная доставка
━━━━━━━━━━━━━━━━━━━━

🚚 Доставка по вашему адресу
🏬 Самовывоз — забирайте заказ лично

📱 Выберите категорию из меню ниже ⬇️`;
    
    const menu = {
        pelmeni: "🥟 Пельмени",
        manti: "🥟 Манты",
        golubtsy: "🫔 Голубцы",
        kotlety: "🍗 Котлеты",
        tefteli: "🍛 Тефтели и фрикадельки",
        pechenochny_tort: "🥮 Печёночный торт",
        samsa: "🥟 Самса",
    } as const;
    
    
    const menuInlineKeyboard = new InlineKeyboard();
    
    for (const element of Object.entries(menu)) {
        menuInlineKeyboard.text(element[1], element[0]).row();
    }
    
    menuInlineKeyboard
        .text('📞 Связь с менеджером', 'contact_manager')
        .row()
        .text('🛒 Корзина', 'view_cart')
        .text('🗑️ Очистить корзину', 'clear_cart')
        .row();
    
    bot.command('start', async (ctx) => {
        await ctx.reply(welcome, {
            reply_markup: menuInlineKeyboard,
            parse_mode: 'HTML'
        });
    });
    
    // Helper function to get user cart from cache
    const getUserCart = (userId: number) => {
        const userKey = `user:${userId}`;
        if (!cartCache.has(userKey)) {
            cartCache.set(userKey, new Map());
        }
        return cartCache.get(userKey)!;
    };
    
    // Helper function to sync cart to KV (background)
    const syncCartToKV = async (userId: number, productId: number, quantity: number) => {
        try {
            if (quantity > 0) {
                await c.env.KV.put(`cart:${userId}:${productId}`, quantity.toString());
            } else {
                await c.env.KV.delete(`cart:${userId}:${productId}`);
            }
        } catch (error) {
            console.error('Error syncing to KV:', error);
        }
    };
    
    // Helper function to load cart from KV to cache
    const loadCartFromKV = async (userId: number) => {
        const userKey = `user:${userId}`;
        if (cartCache.has(userKey)) return; // Already loaded
        
        const userCart = new Map();
        const list = await c.env.KV.list({ prefix: `cart:${userId}:` });
        
        for (const key of list.keys) {
            const productId = parseInt(key.name.split(':')[2]);
            const qty = await c.env.KV.get(key.name);
            if (qty) {
                userCart.set(productId, parseInt(qty));
            }
        }
        
        cartCache.set(userKey, userCart);
    };
    
    // Helper function to get product by id
    const getProductById = (productId: number) => {
        for (const category of Object.values(products.products)) {
            const product = category.find((p: any) => p.id === productId);
            if (product) return product;
        }
        return null;
    };
    
    // Helper function to get cart quantity from cache
    const getCartQuantity = async (userId: number, productId: number) => {
        await loadCartFromKV(userId);
        const userCart = getUserCart(userId);
        return userCart.get(productId) || 0;
    };

    // Функция для формирования текста корзины
    const formatCartMessage = (userCart: Map<number, number>) => {
        let message = '🛒 Мой заказ:\n\n';
        let totalPrice = 0;
        
        for (const [productId, qty] of userCart.entries()) {
            const product = getProductById(productId);
            if(product) {
                message += `• ${product.name} — ${qty} шт. × ${product.price}₽\n`;
                totalPrice += product.price * qty;
            }
        }
        
        message += `\n💰 Итого: ${totalPrice}₽`;
        return message;
    };
    
    // Menu callbacks
    for (const element of Object.entries(menu)) {
        bot.callbackQuery(element[0], async (ctx) => {
            console.log(element[0], element[1]);
            try {
                await ctx.answerCallbackQuery();
            } catch (error) {
                if(error instanceof GrammyError ) {
                    console.error('Error in callback query:', error.description);
                }
            }
            const productsList
            : 
            [
                {
                    id: number,
                    name: string,
                    weight: string,
                    price: number,
                    imgs: string[]
                }
            ]
             = products["products"][element[0]];
    
            const mediaGroup = [];
    
            for (const value of productsList) {
                for (const element of value.imgs) {
                    if(element) {
                        mediaGroup.push({
                            type: 'photo',
                            media: element,
                        });
                    }
                }
                if(mediaGroup.length > 0) {
                    mediaGroup[mediaGroup.length - 1].caption 
                    = `✨ <b>${value.name}</b>\n\n📦 Вес: <b>${value.weight}</b>\n💰 Цена: <b>${value.price} Реалов</b>\n\n🏠 Домашнее приготовление`
                    mediaGroup[mediaGroup.length - 1].parse_mode = 'HTML';
                }
    
                await ctx.replyWithMediaGroup(mediaGroup);
                
                const currentQty = await getCartQuantity(ctx.callbackQuery.from.id, value.id);
                
                const keyboard = new InlineKeyboard();
                
                if (currentQty > 0) {
                    keyboard
                        .text('➖', `decrease:${value.id}`)
                        .text(`🛒 ${currentQty}`, `quantity:${value.id}`)
                        .text('➕', `increase:${value.id}`)
                        .row();
                } else {
                    keyboard
                        .text('🛒 Добавить в корзину', `increase:${value.id}`)
                        .row();
                }
                
                keyboard
                    .text('⚡ Заказать сейчас', 'order_now')
                    .row()
                    .text('◀️ Вернуться в меню', 'back_to_menu');
                
                await ctx.reply(`💫 <b>${value.name}</b> готовы к заказу!`, {
                    reply_markup: keyboard,
                    parse_mode: 'HTML'
                });
            }
        });
    }

    bot.callbackQuery('order_now', async (ctx) => {
        await ctx.answerCallbackQuery('🎉 Оформление заказа...');
        
        await loadCartFromKV(ctx.callbackQuery.from.id);
        const userCart = getUserCart(ctx.callbackQuery.from.id);
        
        // Проверка пустой корзины
        if(userCart.size === 0) {
            await ctx.reply('🛒 <b>Ваша корзина пуста</b>\n\n😔 Добавьте товары перед оформлением заказа!', {
                reply_markup: new InlineKeyboard()
                    .text('◀️ Перейти в меню', 'back_to_menu'),
                parse_mode: 'HTML'
            });
            return;
        }
        
        // Формируем текст корзины
        const cartMessage = formatCartMessage(userCart);
        
        // Получаем ID менеджера из переменных окружения
        const managerUsername = c.env.MANAGER_USERNAME || 'your_manager'; // добавьте username менеджера
        const managerWoman = 'food_clothes';
        
        // Кодируем сообщение для URL
        const encodedWhatsAppMessage = encodeURIComponent(cartMessage);
        const encodedTelegramMessage = encodeURIComponent(cartMessage);
        
        // Создаём ссылки
        const whatsappUrl = `https://wa.me/966573038983?text=${encodedWhatsAppMessage}`;
        const telegramUrl = `https://t.me/${managerUsername}?text=${encodedTelegramMessage}`;
        const whatsappWomanUrl = `https://wa.me/+77001268866?text=${encodedWhatsAppMessage}`;
        const telegramWomenUrl = `https://t.me/${managerWoman}?text=${encodedTelegramMessage}`;
        
        await ctx.reply(
            '📱 <b>Выберите способ связи с менеджером</b>\n\n' +
            '✅ Ваша корзина будет автоматически отправлена в чат\n\n' +
            '👇 Нажмите на удобный для вас способ связи:',
            {
                reply_markup: new InlineKeyboard()
                    .url('💬🚹 Telegram', telegramUrl)
                    .row()
                    .url('📱🚹 WhatsApp', whatsappUrl)
                    .row()
                    .url('💬🚺 Telegram', whatsappWomanUrl)
                    .row()
                    .url('📱🚺 WhatsApp', telegramWomenUrl)
                    .row()
                    .text('◀️ Назад в меню', 'back_to_menu'),
                parse_mode: 'HTML'
            }
        );
    });

    bot.callbackQuery('back_to_menu', async (ctx) => {
        await ctx.answerCallbackQuery();
        
        await ctx.reply(welcome, {
            reply_markup: menuInlineKeyboard,
            parse_mode: 'HTML'
        });
    });

    bot.callbackQuery('contact_manager', async (ctx) => {
        await ctx.answerCallbackQuery();
        
        const managerUsername = c.env.MANAGER_USERNAME || 'your_manager';
        
        await ctx.reply(
            '📞 <b>Связь с менеджером</b>\n\n' +
            '👋 Наш менеджер готов ответить на все ваши вопросы!\n\n' +
            `💬 Telegram: @${managerUsername}\n` +
            '📱 WhatsApp: <a href="https://wa.me/966573038983">+966 57 303 8983</a>\n' +
            '☎️ Телефон: <code>+966 57 303 8983</code>', 
            {
                reply_markup: new InlineKeyboard()
                    .url('💬 Написать в Telegram', `https://t.me/${managerUsername}`)
                    .row()
                    .url('📱 Написать в WhatsApp', 'https://wa.me/966573038983')
                    .row()
                    .text('◀️ Вернуться в меню', 'back_to_menu'),
                parse_mode: 'HTML'
            }
        );
    });


    // Callbacks
	bot.on("callback_query:data", async (ctx) => {
		const data = ctx.callbackQuery.data;
      	let callbackMessage = undefined;

		// Increase quantity
      	if(data.includes('increase:')) {
			const productId = parseInt(data.split(':')[1]);
            const userCart = getUserCart(ctx.callbackQuery.from.id);
            const currentQty = userCart.get(productId) || 0;
            const newQty = currentQty + 1;

            // Update cache immediately
            userCart.set(productId, newQty);
            
            // Sync to KV in background
            syncCartToKV(ctx.callbackQuery.from.id, productId, newQty);

            // Update keyboard
            const keyboard = new InlineKeyboard()
                .text('➖', `decrease:${productId}`)
                .text(`🛒 ${newQty}`, `quantity:${productId}`)
                .text('➕', `increase:${productId}`)
                .row()
                .text('⚡ Заказать сейчас', 'order_now')
                .row()
                .text('◀️ Вернуться в меню', 'back_to_menu');

            try {
                await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
            } catch (error) {
                console.error('Error updating keyboard:', error);
            }

			callbackMessage = `✅ Количество: ${newQty}`;
		}

        // Decrease quantity
      	if(data.includes('decrease:')) {
			const productId = parseInt(data.split(':')[1]);
            const userCart = getUserCart(ctx.callbackQuery.from.id);
            const currentQty = userCart.get(productId) || 0;
            
            if (currentQty > 1) {
                const newQty = currentQty - 1;
                
                // Update cache immediately
                userCart.set(productId, newQty);
                
                // Sync to KV in background
                syncCartToKV(ctx.callbackQuery.from.id, productId, newQty);
                
                // Update keyboard
                const keyboard = new InlineKeyboard()
                    .text('➖', `decrease:${productId}`)
                    .text(`🛒 ${newQty}`, `quantity:${productId}`)
                    .text('➕', `increase:${productId}`)
                    .row()
                    .text('⚡ Заказать сейчас', 'order_now')
                    .row()
                    .text('◀️ Вернуться в меню', 'back_to_menu');

                try {
                    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
                } catch (error) {
                    console.error('Error updating keyboard:', error);
                }

                callbackMessage = `📉 Количество: ${newQty}`;
            } else {
                // Remove from cart
                userCart.delete(productId);
                
                // Sync to KV in background
                syncCartToKV(ctx.callbackQuery.from.id, productId, 0);
                
                // Update keyboard to initial state
                const keyboard = new InlineKeyboard()
                    .text('🛒 Добавить в корзину', `increase:${productId}`)
                    .row()
                    .text('⚡ Заказать сейчас', 'order_now')
                    .row()
                    .text('◀️ Вернуться в меню', 'back_to_menu');

                try {
                    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
                } catch (error) {
                    console.error('Error updating keyboard:', error);
                }

                callbackMessage = `🗑️ Товар удалён из корзины`;
            }
		}

        // Quantity display (no action)
        if(data.includes('quantity:')) {
            const productId = parseInt(data.split(':')[1]);
            const userCart = getUserCart(ctx.callbackQuery.from.id);
            const currentQty = userCart.get(productId) || 0;
            callbackMessage = `📦 В корзине: ${currentQty} шт.`;
        }

		// Clear cart items
		if(data === 'clear_cart') {
            const userCart = getUserCart(ctx.callbackQuery.from.id);
            
            // Clear cache immediately
            const productIds = Array.from(userCart.keys());
            userCart.clear();
            
            // Sync to KV in background
            for (const productId of productIds) {
                syncCartToKV(ctx.callbackQuery.from.id, productId, 0);
            }

			callbackMessage = `🗑️ Корзина очищена`;
		}

		// View cart items
		if(data === 'view_cart') {
            await loadCartFromKV(ctx.callbackQuery.from.id);
            const userCart = getUserCart(ctx.callbackQuery.from.id);

			if(userCart.size === 0) {
				await ctx.reply('🛒 <b>Ваша корзина пуста</b>\n\n😔 Пока здесь ничего нет.\nВыберите товары из меню!', {
                    reply_markup: new InlineKeyboard()
                        .text('◀️ Перейти в меню', 'back_to_menu'),
                    parse_mode: 'HTML'
                });
			} else {
				let message = '🛒 <b>Ваша корзина:</b>\n\n';
				
				for (const [productId, qty] of userCart.entries()) {
                    const product = getProductById(productId);
					message += `✓ ${product?.name || 'Товар'} — <b>${qty} шт.</b>\n`;
				}
				
                message += '\n💡 <i>Готовы оформить заказ?</i>';
                await ctx.reply(message, {
                    reply_markup: new InlineKeyboard()
                        .text('⚡ Оформить заказ', 'order_now')
                        .row()
                        .text('🗑️ Очистить корзину', 'clear_cart')
                        .row()
                        .text('◀️ Продолжить покупки', 'back_to_menu'),
                    parse_mode: 'HTML'
                });
			}
			callbackMessage = `📋 Просмотр корзины`;
		}

      	await ctx.answerCallbackQuery(callbackMessage);
    });
}