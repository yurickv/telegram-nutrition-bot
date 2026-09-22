import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { UserService } from 'src/user/user.service';
import { OpenAIService } from 'src/openai/openai.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { ConfirmationService } from './confirmation/confirmation.service';
import { FoodPreferenceService } from './food/food-preference.service';
import { FoodInputService } from './food/food-input.service';
import { isUserDataValid } from 'src/utils/validateUserData';
import { calculateCalories } from 'src/utils/calcColories';
import { User } from 'src/user/user.schema';
import { BroadcastService } from './broadcast/broadcast.service';
import { appButton } from 'src/utils/appButton';

@Injectable()
export class TelegramService implements OnModuleInit {
    private bot: TelegramBot;
    private adminChatId: number;
    private processingUsers = new Set<number>();
    private userStates = new Map<number, string>();

    private mainKeyboard: TelegramBot.ReplyKeyboardMarkup = {
        keyboard: [[{ text: '📋 Меню' }, { text: 'ℹ️ Допомога' }], [{ text: '🥗 Застосунок' }]],
        resize_keyboard: true,
        one_time_keyboard: false,
    };

    constructor(
        private configService: ConfigService,
        private userService: UserService,
        private openAIService: OpenAIService,
        private onboarding: OnboardingService,
        private confirm: ConfirmationService,
        private foodPref: FoodPreferenceService,
        private foodInput: FoodInputService,
        private broadcast: BroadcastService,
    ) {}

    async onModuleInit() {
        this.adminChatId = Number(this.configService.get<string>('ADMIN_CHAT_ID'));
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        const domain = this.configService.get<string>('RENDER_EXTERNAL_URL');
        if (this.configService.get<string>('NODE_ENV') === 'development') {
            this.bot = new TelegramBot(token, { polling: true });
        } else {
            this.bot = new TelegramBot(token, { webHook: { port: false } });
            await this.bot.setWebHook(`${domain}/bot`);
        }

        this.bot.setMyCommands([
            { command: '/start', description: 'Розпочати' },
            { command: '/menu', description: 'Отримати меню' },
            { command: '/edit', description: 'Редагувати дані' },
            { command: '/add_favorite', description: 'Додати улюблені продукти' },
            { command: '/del_food', description: 'Виключити небажані продукти' },
            { command: '/feedback', description: 'Написати розробнику' },
        ]);

        const commandHandler = (regex: RegExp, handler: (msg: TelegramBot.Message) => void) => {
            this.bot.onText(regex, (msg) => {
                this.clearUserState(msg.chat.id);
                this.broadcast.cancelPending(this.bot, msg.chat.id);
                handler(msg);
            });
        };

        commandHandler(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from?.username || '';
            const user = await this.userService.findByChatId(chatId);

            if (!user) {
                await this.userService.createOrUpdateUser(chatId, {
                    username,
                    weight: 0,
                    height: 0,
                    age: 0,
                    sex: true,
                    activity: 1.2,
                    goal: 'maintain',
                    amountMenu: 0,
                });

                this.bot.sendMessage(
                    chatId,
                    `Привіт 👋 Я AI-дієтолог.
Я допоможу швидко скласти збалансоване меню на день.
Введіть вагу, зріст і ціль — і вже за хвилину отримаєте своє меню!`,
                    {
                        reply_markup: this.mainKeyboard,
                    },
                );

                setTimeout(
                    () => this.onboarding.askWeight(this.bot, chatId, (s) => this.setUserState(chatId, s)),
                    1000,
                );
            } else {
                if (user.username !== username) {
                    await this.userService.updateUser(chatId, { username });
                }

                this.confirm.confirmData(this.bot, chatId);
                setTimeout(
                    () =>
                        this.bot.sendMessage(chatId, 'Оберіть дію нижче:', {
                            reply_markup: this.mainKeyboard,
                        }),
                    1000,
                );
                setTimeout(
                    () =>
                        this.bot.sendMessage(chatId, '🥗 Спробуйте застосунок Sytno:', {
                            reply_markup: appButton('cta'),
                        }),
                    1500,
                );
            }
        });

        commandHandler(/\/edit/, (msg) => {
            // this.bot.sendMessage(msg.chat.id, 'Редагування даних. Почнемо з ваги:', {
            //     reply_markup: this.mainKeyboard,
            // });
            this.onboarding.askWeight(this.bot, msg.chat.id, (s) => this.setUserState(msg.chat.id, s));
        });

        commandHandler(/\/add_favorite/, (msg) => this.foodPref.handleFavoriteFoods(this.bot, msg.chat.id));

        commandHandler(/\/del_food/, (msg) => this.foodPref.handleDislikedFoods(this.bot, msg.chat.id));

        commandHandler(/\/menu/, async (msg) => {
            await this.sendMenu(msg.chat.id);
        });
        commandHandler(/\/feedback/, (msg) => {
            const chatId = msg.chat.id;
            this.setUserState(chatId, 'waiting_for_feedback');
            this.bot.sendMessage(
                chatId,
                '✍️ Напишіть про свої труднощі в роботі бота або побажання для нових функцій (до 300 символів):',
            );
        });

        this.bot.onText(/\/broadcast/, (msg) => this.broadcast.start(this.bot, msg.chat.id));

        this.bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text?.trim();
            const state = this.userStates.get(chatId);

            void this.userService.resetBlockedIfFlagged(chatId);

            const isCommand = !!msg.text?.startsWith('/');
            if (!isCommand && this.broadcast.isAwaitingContent(chatId)) {
                return this.broadcast.handleContent(this.bot, msg);
            }

            // If user entered a command, cancel state
            if (text?.startsWith('/') && state) {
                this.clearUserState(chatId);
                return;
            }

            // Handle persistent keyboard buttons
            if (text === '📋 Меню') return await this.sendMenu(chatId);
            if (text === '🥗 Застосунок') {
                return this.bot.sendMessage(
                    chatId,
                    '🥗 Новий застосунок Sytno: меню на тиждень, заміна страв, список покупок, підрахунок БЖВ.',
                    { reply_markup: appButton('cta') },
                );
            }
            if (text === 'ℹ️ Допомога') {
                await this.bot.sendMessage(
                    chatId,
                    `📊 Врахування калорійності❗— це ключ🔧 до ефективного схуднення або набору ваги.

🥗 Меню складається з урахуванням принципів:
✅ Здорового 🧠 харчування  
✅ Балансу макроелементів  
✅ Рекомендацій МОЗ України 🇺🇦

💡 Хочете улюблену страву в меню?
➕ Додате її назву до списку *улюблених продуктів* через команду /add\\_favorite

🚫 Не хочете бачити певні страви?
➖ Вкажіть їх у списку *небажаних продуктів* через /del\\_food

📌 *Доступні команди:*
_Перевірити свої дані_ /start
_Змінити дані_ /edit
_Отримати нове меню_ /menu
_Додати улюблені продукти / страви в меню_ /add\\_favorite
_Виключити продукти / страви з меню_  /del\\_food
Відгук або побажання /feedback
`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: this.mainKeyboard,
                    },
                );
                return this.bot.sendMessage(chatId, '🥗 Більше можливостей у застосунку Sytno:', {
                    reply_markup: appButton('cta'),
                });
            }

            // Handle user input based on current state
            switch (state) {
                case 'waiting_for_weight':
                    return this.onboarding.handleWeightInput(this.bot, chatId, text, (s) =>
                        this.setUserState(chatId, s),
                    );
                case 'waiting_for_height':
                    return this.onboarding.handleHeightInput(this.bot, chatId, text, (s) =>
                        this.setUserState(chatId, s),
                    );
                case 'waiting_for_age':
                    return this.onboarding.handleAgeInput(this.bot, chatId, text, (s) => this.setUserState(chatId, s));
                case 'adding_favorite_foods':
                    return this.foodInput.handleFoodInput(this.bot, chatId, text, 'favorite', () =>
                        this.clearUserState(chatId),
                    );
                case 'adding_disliked_foods':
                    return this.foodInput.handleFoodInput(this.bot, chatId, text, 'disliked', () =>
                        this.clearUserState(chatId),
                    );
                case 'waiting_for_feedback':
                    const feedback = msg.text?.trim();
                    if (!feedback || feedback.length > 300) {
                        return this.bot.sendMessage(
                            chatId,
                            '⚠️ Повідомлення повинне містити до 300 символів. Спробуйте ще раз.',
                        );
                    }
                    await this.bot.sendMessage(
                        this.adminChatId,
                        `📨 Новий фідбек від @${msg.from?.username || 'невідомо'}:\n\n${feedback}`,
                    );
                    this.bot.sendMessage(chatId, '✅ Дякуємо! Ваше повідомлення надіслано розробнику.');
                    return this.clearUserState(chatId);
            }
        });

        this.bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id;
            const data = query.data;

            void this.userService.resetBlockedIfFlagged(chatId);

            if (data === 'broadcast:confirm' || data === 'broadcast:cancel') {
                return this.broadcast.handleCallback(this.bot, query);
            }

            if (data.startsWith('gender:')) {
                await this.onboarding.handleGender(this.bot, chatId, data, (s) => this.setUserState(chatId, s));
                this.bot.answerCallbackQuery(query.id);
            } else if (data.startsWith('activity:')) {
                await this.onboarding.handleActivity(this.bot, chatId, data, (s) => this.setUserState(chatId, s));
                this.bot.answerCallbackQuery(query.id);
            } else if (data.startsWith('goal:')) {
                await this.onboarding.handleGoal(this.bot, chatId, data, (s) => this.setUserState(chatId, s));
                this.bot.answerCallbackQuery(query.id);
            } else if (data.startsWith('remove_fav_i:')) {
                const idx = parseInt(data.split(':')[1], 10);
                const user = await this.userService.findByChatId(chatId);
                const food = user?.favoriteFoods?.[idx];
                if (food) {
                    await this.userService.removeFavoriteFood(chatId, food);
                    this.bot.answerCallbackQuery(query.id, { text: `${food} видалено.` });
                    this.foodPref.handleFavoriteFoods(this.bot, chatId);
                } else {
                    this.bot.answerCallbackQuery(query.id, { text: 'Не знайдено елемент.' });
                }
            } else if (data.startsWith('remove_dis_i:')) {
                const idx = parseInt(data.split(':')[1], 10);
                const user = await this.userService.findByChatId(chatId);
                const food = user?.dislikedFoods?.[idx];
                if (food) {
                    await this.userService.removeDislikedFood(chatId, food);
                    this.bot.answerCallbackQuery(query.id, { text: `${food} видалено.` });
                    this.foodPref.handleDislikedFoods(this.bot, chatId);
                } else {
                    this.bot.answerCallbackQuery(query.id, { text: 'Не знайдено елемент.' });
                }
            } else if (data.startsWith('remove_fav:')) {
                const food = data.split(':')[1];
                await this.userService.removeFavoriteFood(chatId, food);
                this.bot.answerCallbackQuery(query.id, { text: `${food} видалено.` });
                this.foodPref.handleFavoriteFoods(this.bot, chatId);
            } else if (data.startsWith('remove_dis:')) {
                const food = data.split(':')[1];
                await this.userService.removeDislikedFood(chatId, food);
                this.bot.answerCallbackQuery(query.id, { text: `${food} видалено.` });
                this.foodPref.handleDislikedFoods(this.bot, chatId);
            } else if (data === 'add_fav') {
                this.foodInput.promptAddFoods(this.bot, chatId, 'favorite', (s) => this.setUserState(chatId, s));
                this.bot.answerCallbackQuery(query.id);
            } else if (data === 'add_dis') {
                this.foodInput.promptAddFoods(this.bot, chatId, 'disliked', (s) => this.setUserState(chatId, s));
                this.bot.answerCallbackQuery(query.id);
            }
        });
    }

    private async sendMenu(chatId: number) {
        if (this.processingUsers.has(chatId)) return;
        this.processingUsers.add(chatId);

        try {
            const user = await this.userService.findByChatId(chatId);
            if (!user || !isUserDataValid(user)) {
                return this.bot.sendMessage(chatId, 'Щоб отримати меню, спершу завершіть анкету командою /edit');
            }

            const now = new Date();
            const last = user.lastMenuRequest ? new Date(user.lastMenuRequest) : null;
            const isSameDay = last && now.toDateString() === last.toDateString();

            const amountToday = isSameDay ? user.amountMenuToday || 0 : 0;

            if (amountToday >= 15) {
                return this.bot.sendMessage(chatId, '❗️Ви вже отримали 15 меню сьогодні. Спробуйте завтра.');
            }

            const loading = await this.bot.sendMessage(chatId, 'Готуємо меню...');
            const calories = calculateCalories(user);
            const mealPlan = await this.openAIService.generateMealPlan(
                calories,
                user.favoriteFoods,
                user.dislikedFoods,
            );

            this.bot.editMessageText(`Ваше меню на день:\n${mealPlan}`, {
                chat_id: chatId,
                message_id: loading.message_id,
                reply_markup: appButton('cta'),
            });

            const updateData: Partial<User> = {
                amountMenu: (user.amountMenu || 0) + 1,
                amountMenuToday: amountToday + 1,
                lastMenuRequest: now,
            };

            if (!user.firstInit) {
                updateData.firstInit = now;
            }

            await this.userService.updateUser(chatId, updateData);
        } catch (err) {
            console.error('Menu error:', err);
            this.bot.sendMessage(chatId, 'Помилка при створенні меню.');
        } finally {
            this.processingUsers.delete(chatId);
        }
    }

    private setUserState(chatId: number, state: string | null) {
        if (!state) return this.userStates.delete(chatId);
        this.userStates.set(chatId, state);
    }

    private clearUserState(chatId: number) {
        this.userStates.delete(chatId);
    }

    getBot() {
        return this.bot;
    }
}
