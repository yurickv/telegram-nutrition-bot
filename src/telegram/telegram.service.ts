import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { OpenAIService } from '../openai/openai.service';
import { UserService } from 'src/user/user.service';
import { User } from 'src/user/user.schema';

import { calculateCalories } from '../utils/calcColories';
import { isUserDataValid } from 'src/utils/validateUserData';
import { padRight } from 'src/utils/formatViewButton';

@Injectable()
export class TelegramService implements OnModuleInit {
    private bot: TelegramBot;
    private processingUsers = new Set<number>();
    private userStates = new Map<number, string>();

    constructor(
        private configService: ConfigService,
        private openAIService: OpenAIService,
        private userService: UserService,
    ) {}

    async onModuleInit() {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        const domain = this.configService.get<string>('RENDER_EXTERNAL_URL');

        this.bot =
            this.configService.get<string>('NODE_ENV') === 'development'
                ? new TelegramBot(token, { polling: true })
                : new TelegramBot(token, { webHook: { port: false } });

        if (this.configService.get<string>('NODE_ENV') !== 'development') {
            await this.bot.setWebHook(`${domain}/bot`);
        }

        this.bot.setMyCommands([
            { command: '/start', description: 'Розпочати' },
            { command: '/menu', description: 'Отримати меню' },
            { command: '/edit', description: 'Редагувати дані' },
            { command: '/add_favorite', description: 'Додати улюблені продукти' },
            { command: '/del_food', description: 'Виключити небажані продукти' },
        ]);

        // ⏹ Clear state on any command
        const commandHandler = (regex: RegExp, handler: (msg: TelegramBot.Message) => void) => {
            this.bot.onText(regex, (msg) => {
                this.clearUserState(msg.chat.id);
                handler(msg);
            });
        };

        commandHandler(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const user = await this.userService.findByChatId(chatId);
            if (!user) {
                await this.userService.createOrUpdateUser(chatId, {
                    weight: 0,
                    height: 0,
                    age: 0,
                    sex: true,
                    activity: 1.2,
                    goal: 'maintain',
                    amountMenu: 0,
                });
                this.bot.sendMessage(chatId, 'Привіт! Я AI-дієтолог. Введи свої дані: вага, зріст, ціль.');
                setTimeout(() => this.askWeight(chatId), 1000);
            } else {
                this.confirmData(chatId);
            }
        });

        commandHandler(/\/edit/, (msg) => this.askWeight(msg.chat.id));
        commandHandler(/\/add_favorite/, (msg) => this.handleFavoriteFoods(msg.chat.id));
        commandHandler(/\/del_food/, (msg) => this.handleDislikedFoods(msg.chat.id));

        commandHandler(/\/menu/, async (msg) => {
            const chatId = msg.chat.id;
            this.clearUserState(chatId);

            if (this.processingUsers.has(chatId)) return;
            this.processingUsers.add(chatId);

            try {
                const user = await this.userService.findByChatId(chatId);
                if (!user || !isUserDataValid(user)) {
                    return this.bot.sendMessage(
                        chatId,
                        `Щоб отримати коректне меню, заповніть всі свої дані.
Натисніть /edit для завершення опитування.`,
                    );
                }

                const loading = await this.bot.sendMessage(chatId, 'Зачекайте, готуємо меню...');
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

                const updateData: Partial<User> = {};
                updateData.amountMenu = typeof user.amountMenu === 'number' ? user.amountMenu + 1 : 1;
                if (!user.firstInit) updateData.firstInit = new Date();
                await this.userService.updateUser(chatId, updateData);
            } catch (err) {
                console.error('Menu error:', err);
                this.bot.sendMessage(chatId, 'Виникла помилка. Спробуйте пізніше.');
            } finally {
                this.processingUsers.delete(chatId);
            }
        });

        this.bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id;
            const data = query.data;
            if (data.startsWith('remove_fav:')) {
                const food = data.split(':')[1];
                await this.userService.removeFavoriteFood(chatId, food);
                this.bot.answerCallbackQuery(query.id, { text: `${food} видалено.` });
                this.handleFavoriteFoods(chatId);
            } else if (data.startsWith('remove_dis:')) {
                const food = data.split(':')[1];
                await this.userService.removeDislikedFood(chatId, food);
                this.bot.answerCallbackQuery(query.id, { text: `${food} видалено.` });
                this.handleDislikedFoods(chatId);
            } else if (data === 'add_fav') {
                this.promptAddFoods(chatId, 'favorite');
                this.bot.answerCallbackQuery(query.id);
            } else if (data === 'add_dis') {
                this.promptAddFoods(chatId, 'disliked');
                this.bot.answerCallbackQuery(query.id);
            }
        });

        this.bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const state = this.userStates.get(chatId);

            if (msg.text.startsWith('/') && state) {
                this.clearUserState(chatId);
                return; // command will be handled in its own handler
            }

            switch (state) {
                case 'waiting_for_weight':
                    return this.handleWeightInput(chatId, msg.text);
                case 'waiting_for_height':
                    return this.handleHeightInput(chatId, msg.text);
                case 'waiting_for_age':
                    return this.handleAgeInput(chatId, msg.text);
                case 'adding_favorite_foods':
                    return this.handleFoodInput(chatId, msg.text, 'favorite');
                case 'adding_disliked_foods':
                    return this.handleFoodInput(chatId, msg.text, 'disliked');
            }
        });
    }

    private clearUserState(chatId: number) {
        this.userStates.delete(chatId);
    }

    private askWeight(chatId: number) {
        this.userStates.set(chatId, 'waiting_for_weight');
        this.bot.sendMessage(chatId, 'Введи свою вагу (кг):');
    }

    private async handleWeightInput(chatId: number, text: string) {
        const val = Number(text.trim());
        if (isNaN(val) || val < 40 || val > 150) return this.bot.sendMessage(chatId, 'Введи число від 40 до 150.');
        await this.userService.updateUser(chatId, { weight: val });
        this.userStates.delete(chatId);
        this.askHeight(chatId);
    }

    private askHeight(chatId: number) {
        this.userStates.set(chatId, 'waiting_for_height');
        this.bot.sendMessage(chatId, 'Введи свій ріст (см):');
    }

    private async handleHeightInput(chatId: number, text: string) {
        const val = Number(text.trim());
        if (isNaN(val) || val < 100 || val > 220) return this.bot.sendMessage(chatId, 'Введи число від 100 до 220.');
        await this.userService.updateUser(chatId, { height: val });
        this.userStates.delete(chatId);
        this.askAge(chatId);
    }

    private askAge(chatId: number) {
        this.userStates.set(chatId, 'waiting_for_age');
        this.bot.sendMessage(chatId, 'Введи свій вік:');
    }

    private async handleAgeInput(chatId: number, text: string) {
        const val = Number(text.trim());
        if (isNaN(val) || val < 14 || val > 130) return this.bot.sendMessage(chatId, 'Введи число від 14 до 130.');
        await this.userService.updateUser(chatId, { age: val });
        this.userStates.delete(chatId);
        this.askGender(chatId);
    }

    private async askGender(chatId: number) {
        this.bot.sendMessage(chatId, 'Оберіть вашу стать:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Чоловік', callback_data: 'true' }],
                    [{ text: 'Жінка', callback_data: 'false' }],
                ],
            },
        });
        this.bot.once('callback_query', async (query) => {
            await this.userService.updateUser(chatId, { sex: query.data === 'true' });
            this.bot.answerCallbackQuery(query.id);
            this.askActivity(chatId);
        });
    }

    private async askActivity(chatId: number) {
        this.bot.sendMessage(chatId, 'Оберіть рівень активності:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Сидячий спосіб життя', callback_data: '1.2' }],
                    [{ text: 'Легка активність', callback_data: '1.375' }],
                    [{ text: 'Помірна активність', callback_data: '1.55' }],
                    [{ text: 'Дуже активний', callback_data: '1.725' }],
                ],
            },
        });
        this.bot.once('callback_query', async (query) => {
            await this.userService.updateUser(chatId, { activity: parseFloat(query.data) });
            this.bot.answerCallbackQuery(query.id);
            this.askGoal(chatId);
        });
    }

    private askGoal(chatId: number) {
        this.bot.sendMessage(chatId, 'Яка твоя ціль?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Схуднення', callback_data: 'lose_weight' }],
                    [{ text: 'Набір ваги', callback_data: 'gain_weight' }],
                    [{ text: 'Підтримка форми', callback_data: 'maintain' }],
                ],
            },
        });
        this.bot.once('callback_query', async (query) => {
            await this.userService.updateUser(chatId, { goal: query.data });
            this.bot.answerCallbackQuery(query.id);
            this.confirmData(chatId);
        });
    }

    private promptAddFoods(chatId: number, type: 'favorite' | 'disliked') {
        const label = type === 'favorite' ? 'улюблені' : 'небажані';
        this.bot.sendMessage(chatId, `Введіть ваші ${label} продукти через кому (до 30 символів кожен):`);
        this.userStates.set(chatId, type === 'favorite' ? 'adding_favorite_foods' : 'adding_disliked_foods');
    }

    private async handleFoodInput(chatId: number, text: string, type: 'favorite' | 'disliked') {
        const foods = text
            .split(',')
            .map((f) => f.trim())
            .filter((f) => f.length && f.length <= 30);

        if (!foods.length) return this.bot.sendMessage(chatId, 'Немає допустимих продуктів.');

        const addMethod = type === 'favorite' ? this.userService.addFavoriteFoods : this.userService.addDislikedFoods;

        await addMethod.call(this.userService, chatId, foods);
        this.userStates.delete(chatId);
        this.bot.sendMessage(chatId, `${type === 'favorite' ? 'Улюблені' : 'Небажані'} продукти оновлено.`);
    }

    private async handleFavoriteFoods(chatId: number) {
        const user = await this.userService.findByChatId(chatId);
        const foods = user?.favoriteFoods || [];
        const inlineKeyboard = foods.map((food) => [{ text: padRight(food), callback_data: `remove_fav:${food}` }]);
        inlineKeyboard.push([{ text: '➕ Додати нові', callback_data: 'add_fav' }]);

        this.bot.sendMessage(chatId, 'Ваші улюблені продукти:', {
            reply_markup: { inline_keyboard: inlineKeyboard },
        });
    }

    private async handleDislikedFoods(chatId: number) {
        const user = await this.userService.findByChatId(chatId);
        const foods = user?.dislikedFoods || [];
        const inlineKeyboard = foods.map((food) => [{ text: padRight(food), callback_data: `remove_dis:${food}` }]);
        inlineKeyboard.push([{ text: '➕ Додати нові', callback_data: 'add_dis' }]);

        this.bot.sendMessage(chatId, 'Ваші небажані продукти:', {
            reply_markup: { inline_keyboard: inlineKeyboard },
        });
    }

    private async confirmData(chatId: number) {
        const user = await this.userService.findByChatId(chatId);
        if (!user) {
            return this.bot.sendMessage(chatId, `Дані не знайдено. Натисніть /start.`);
        }
        const goalText =
            user.goal === 'lose_weight' ? 'Схуднення' : user.goal === 'gain_weight' ? 'Набір ваги' : 'Підтримка форми';
        const calories = calculateCalories(user);

        this.bot.sendMessage(
            chatId,
            `Ваші дані:
Вага: ${user.weight} кг
Ріст: ${user.height} см
Вік: ${user.age} років
Стать: ${user.sex ? 'Чоловік' : 'Жінка'}
Ціль: ${goalText}
Денна норма калорій: ${calories}

Щоб змінити дані, натисніть /edit
Щоб отримати меню, натисніть /menu
Щоб додати улюблені продукти, натисніть /add_favorite
Щоб виключити продукти, натисніть /del_food`,
        );
    }

    getBot() {
        return this.bot;
    }
}
