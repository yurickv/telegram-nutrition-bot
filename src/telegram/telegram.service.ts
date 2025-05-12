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

@Injectable()
export class TelegramService implements OnModuleInit {
    private bot: TelegramBot;
    private processingUsers = new Set<number>();
    private userStates = new Map<number, string>();

    constructor(
        private configService: ConfigService,
        private userService: UserService,
        private openAIService: OpenAIService,
        private onboarding: OnboardingService,
        private confirm: ConfirmationService,
        private foodPref: FoodPreferenceService,
        private foodInput: FoodInputService,
    ) {}

    async onModuleInit() {
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
        ]);

        const commandHandler = (regex: RegExp, handler: (msg: TelegramBot.Message) => void) => {
            this.bot.onText(regex, (msg) => {
                this.clearUserState(msg.chat.id);
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

                this.bot.sendMessage(chatId, 'Привіт! Я AI-дієтолог. Введи свої дані: вага, зріст, ціль.');
                setTimeout(
                    () => this.onboarding.askWeight(this.bot, chatId, (s) => this.setUserState(chatId, s)),
                    1000,
                );
            } else {
                if (user.username !== username) {
                    await this.userService.updateUser(chatId, { username });
                }
                this.confirm.confirmData(this.bot, chatId);
            }
        });

        commandHandler(/\/edit/, (msg) =>
            this.onboarding.askWeight(this.bot, msg.chat.id, (s) => this.setUserState(msg.chat.id, s)),
        );
        commandHandler(/\/add_favorite/, (msg) => this.foodPref.handleFavoriteFoods(this.bot, msg.chat.id));
        commandHandler(/\/del_food/, (msg) => this.foodPref.handleDislikedFoods(this.bot, msg.chat.id));

        commandHandler(/\/menu/, async (msg) => {
            const chatId = msg.chat.id;
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

                this.bot.editMessageText(`Твоє меню на день:\n${mealPlan}`, {
                    chat_id: chatId,
                    message_id: loading.message_id,
                });

                await this.userService.updateUser(chatId, {
                    amountMenu: (user.amountMenu || 0) + 1,
                    amountMenuToday: amountToday + 1,
                    lastMenuRequest: now,
                    ...(user.firstInit ? {} : { firstInit: now }),
                });
            } catch (err) {
                console.error('Menu error:', err);
                this.bot.sendMessage(chatId, 'Помилка при створенні меню.');
            } finally {
                this.processingUsers.delete(chatId);
            }
        });

        this.bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id;
            const data = query.data;

            if (data.startsWith('gender:')) {
                await this.onboarding.handleGender(this.bot, chatId, data, (s) => this.setUserState(chatId, s));
                this.bot.answerCallbackQuery(query.id);
            } else if (data.startsWith('activity:')) {
                await this.onboarding.handleActivity(this.bot, chatId, data, (s) => this.setUserState(chatId, s));
                this.bot.answerCallbackQuery(query.id);
            } else if (data.startsWith('goal:')) {
                await this.onboarding.handleGoal(this.bot, chatId, data, (s) => this.setUserState(chatId, s));
                this.bot.answerCallbackQuery(query.id);
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

        this.bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const state = this.userStates.get(chatId);
            if (msg.text.startsWith('/') && state) {
                this.clearUserState(chatId);
                return;
            }

            switch (state) {
                case 'waiting_for_weight':
                    return this.onboarding.handleWeightInput(this.bot, chatId, msg.text, (s) =>
                        this.setUserState(chatId, s),
                    );
                case 'waiting_for_height':
                    return this.onboarding.handleHeightInput(this.bot, chatId, msg.text, (s) =>
                        this.setUserState(chatId, s),
                    );
                case 'waiting_for_age':
                    return this.onboarding.handleAgeInput(this.bot, chatId, msg.text, (s) =>
                        this.setUserState(chatId, s),
                    );
                case 'adding_favorite_foods':
                    return this.foodInput.handleFoodInput(this.bot, chatId, msg.text, 'favorite', () =>
                        this.clearUserState(chatId),
                    );
                case 'adding_disliked_foods':
                    return this.foodInput.handleFoodInput(this.bot, chatId, msg.text, 'disliked', () =>
                        this.clearUserState(chatId),
                    );
            }
        });
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
