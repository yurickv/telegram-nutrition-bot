import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { OpenAIService } from '../openai/openai.service';
import { UserService } from 'src/user/user.service';
import { calculateCalories } from '../utils/calcColories';

@Injectable()
export class TelegramService implements OnModuleInit {
    private bot: TelegramBot;

    constructor(
        private configService: ConfigService,
        private openAIService: OpenAIService,
        private userService: UserService,
    ) {}

    async onModuleInit() {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        this.bot = new TelegramBot(token, { polling: true });

        this.bot.onText(/\/start/, async (msg) => {
            let user = await this.userService.findByChatId(msg.chat.id);
            if (!user) {
                user = await this.userService.createOrUpdateUser(msg.chat.id, {
                    weight: 0,
                    height: 0,
                    age: 0,
                    sex: true,
                    activity: 1.2,
                    goal: 'maintain',
                });
                this.bot.sendMessage(msg.chat.id, 'Привіт! Я AI-дієтолог. Введи свої дані: вага, зріст, ціль.');
                setTimeout(() => this.askWeight(msg.chat.id), 2000);
            } else {
                this.confirmData(msg.chat.id);
            }
        });

        this.bot.setMyCommands([
            { command: '/start', description: 'Розпочати' },
            { command: '/menu', description: 'Отримати меню' },
            { command: '/edit', description: 'Редагувати дані' },
            { command: '/add_favorite', description: 'Додати улюблені продукти' },
            { command: '/del_food', description: 'Виключити небажані продукти' },
        ]);

        this.bot.onText(/\/edit/, (msg) => this.askWeight(msg.chat.id));

        this.bot.onText(/\/menu/, async (msg) => {
            const user = await this.userService.findByChatId(msg.chat.id);
            if (!user) {
                return this.bot.sendMessage(
                    msg.chat.id,
                    'Будь ласка, введіть свої дані командою /start перед отриманням меню.',
                );
            }
            const calories = calculateCalories(user);
            const mealPlan = await this.openAIService.generateMealPlan(calories);
            this.bot.sendMessage(msg.chat.id, `Твоє меню на день:\n${mealPlan}`);
        });
        this.bot.onText(/\/add_favorite/, (msg) => this.handleFavoriteFoods(msg.chat.id));
        this.bot.onText(/\/del_food/, (msg) => this.handleDislikedFoods(msg.chat.id));
    }

    private async handleFavoriteFoods(chatId: number) {
        const user = await this.userService.findByChatId(chatId);
        const existing = user?.favoriteFoods?.join(', ') || '';
        const prompt = existing
            ? `Ваші улюблені продукти: ${existing}.
Додайте нові через кому:`
            : 'Введіть ваші улюблені продукти через кому:';

        this.bot.sendMessage(chatId, prompt);
        const listener = async (msg: TelegramBot.Message) => {
            if (msg.chat.id !== chatId) return;
            const newFoods = msg.text
                .split(',')
                .map((f) => f.trim())
                .filter(Boolean);
            await this.userService.addFavoriteFoods(chatId, newFoods);
            this.bot.sendMessage(chatId, 'Улюблені продукти оновлено.');
            this.bot.removeListener('message', listener);
        };
        this.bot.on('message', listener);
    }

    private async handleDislikedFoods(chatId: number) {
        const user = await this.userService.findByChatId(chatId);
        const existing = user?.dislikedFoods?.join(', ') || '';
        const prompt = existing
            ? `Ваші небажані продукти: ${existing}.
Додайте нові через кому:`
            : 'Введіть ваші небажані продукти через кому:';

        this.bot.sendMessage(chatId, prompt);
        const listener = async (msg: TelegramBot.Message) => {
            if (msg.chat.id !== chatId) return;
            const newFoods = msg.text
                .split(',')
                .map((f) => f.trim())
                .filter(Boolean);
            await this.userService.addDislikedFoods(chatId, newFoods);
            this.bot.sendMessage(chatId, 'Небажані продукти оновлено.');
            this.bot.removeListener('message', listener);
        };
        this.bot.on('message', listener);
    }

    private async askWeight(chatId: number, message = 'Введи свою вагу (кг):') {
        this.bot.sendMessage(chatId, message);
        this.bot.once('message', async (msg) => {
            const weight = Number(msg.text.trim());
            if (isNaN(weight) || weight < 40 || weight > 150) {
                return this.askWeight(chatId, 'Будь ласка, введи число від 40 до 150.');
            }
            await this.userService.updateUser(chatId, { weight });
            this.askHeight(chatId);
        });
    }

    private async askHeight(chatId: number, message = 'Введи свій ріст (см):') {
        this.bot.sendMessage(chatId, message);
        this.bot.once('message', async (msg) => {
            const height = Number(msg.text.trim());
            if (isNaN(height) || height < 100 || height > 220) {
                return this.askHeight(chatId, 'Будь ласка, введи число від 100 до 220.');
            }
            await this.userService.updateUser(chatId, { height });
            this.askAge(chatId);
        });
    }

    private async askAge(chatId: number, message = 'Введи свій вік:') {
        this.bot.sendMessage(chatId, message);
        this.bot.once('message', async (msg) => {
            const age = Number(msg.text.trim());
            if (isNaN(age) || age < 14 || age > 130) {
                return this.askAge(chatId, 'Будь ласка, введи число від 14 до 130.');
            }
            await this.userService.updateUser(chatId, { age });
            this.askGender(chatId);
        });
    }

    private async askGender(chatId: number) {
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Чоловік', callback_data: 'true' }],
                    [{ text: 'Жінка', callback_data: 'false' }],
                ],
            },
        };
        this.bot.sendMessage(chatId, 'Оберіть вашу стать:', options);
        this.bot.once('callback_query', async (query) => {
            await this.userService.updateUser(chatId, { sex: query.data === 'true' });
            this.bot.answerCallbackQuery(query.id);
            this.askActivity(chatId);
        });
    }

    private async askActivity(chatId: number) {
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Сидячий спосіб життя', callback_data: '1.2' }],
                    [{ text: 'Легка активність', callback_data: '1.375' }],
                    [{ text: 'Помірна активність', callback_data: '1.55' }],
                    [{ text: 'Дуже активний', callback_data: '1.725' }],
                ],
            },
        };
        this.bot.sendMessage(chatId, 'Оберіть рівень активності:', options);
        this.bot.once('callback_query', async (query) => {
            await this.userService.updateUser(chatId, { activity: parseFloat(query.data) });
            this.bot.answerCallbackQuery(query.id);
            this.askGoal(chatId);
        });
    }

    private askGoal(chatId: number) {
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Схуднення', callback_data: 'lose_weight' }],
                    [{ text: 'Набір ваги', callback_data: 'gain_weight' }],
                    [{ text: 'Підтримка форми', callback_data: 'maintain' }],
                ],
            },
        };
        this.bot.sendMessage(chatId, 'Яка твоя ціль?', options);
        this.bot.once('callback_query', async (query) => {
            const goal = query.data;
            await this.userService.updateUser(chatId, { goal });
            this.bot.answerCallbackQuery(query.id);
            this.confirmData(chatId);
        });
    }

    private async confirmData(chatId: number) {
        const user = await this.userService.findByChatId(chatId);

        if (!user) {
            this.bot.sendMessage(
                chatId,
                `Дані користувача не знайдено. Будь ласка, натисніть /start для початку. 
                Або спробуйте пізніше`,
            );
            return;
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
Ваша денна норма калорій: ${calories}

Щоб змінити дані, натисніть /edit
Щоб отримати денне меню, натисніть /menu

Щоб додати улюблені продукти, натисніть /add_favorite
Щоб виключити певні продукти з меню, натисніть /del_food`,
        );
    }
}
