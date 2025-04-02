import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { OpenAIService } from '../openai/openai.service';
import { calculateCalories } from '../utils/calcColories';

@Injectable()
export class TelegramService implements OnModuleInit {
    private bot: TelegramBot;
    private userData = new Map<number, any>();

    constructor(
        private configService: ConfigService,
        private openAIService: OpenAIService,
    ) {}

    async onModuleInit() {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        this.bot = new TelegramBot(token, { polling: true });

        this.bot.onText(/\/start/, (msg) => {
            this.bot.sendMessage(msg.chat.id, 'Привіт! Я AI-дієтолог. Введи свої дані: вага, зріст, ціль.');
            setTimeout(() => this.askWeight(msg.chat.id), 2000);
        });
        this.bot.setMyCommands([
            { command: '/start', description: 'Розпочати' },
            { command: '/menu', description: 'Отримати меню' },
            { command: '/edit', description: 'Редагувати дані' },
        ]);

        this.bot.onText(/\/edit/, (msg) => this.askWeight(msg.chat.id));

        this.bot.onText(/\/menu/, async (msg) => {
            try {
                const user = this.userData.get(msg.chat.id);
                if (!user) {
                    return this.bot.sendMessage(
                        msg.chat.id,
                        'Будь ласка, введіть свої дані командою /start перед отриманням меню.',
                    );
                }

                const calories = calculateCalories(user);

                const mealPlan = await this.openAIService.generateMealPlan(calories);
                this.bot.sendMessage(
                    msg.chat.id,
                    `Твоє меню на день:
${mealPlan}`,
                );
            } catch (error) {
                console.error('Помилка при запиті до OpenAI:', error);
                this.bot.sendMessage(msg.chat.id, 'Сталася помилка при генерації меню. Спробуй ще раз.');
            }
        });
    }

    private askWeight(chatId: number, message = 'Введи свою вагу (кг) (від 40 до 150):') {
        this.bot.sendMessage(chatId, message);
        this.bot.once('message', (msg) => {
            const weight = Number(msg.text.trim());
            if (isNaN(weight) || weight < 40 || weight > 150) {
                this.bot.sendMessage(chatId, 'Будь ласка, введи число від 40 до 150.');
                return this.askWeight(chatId, '>');
            }
            this.userData.set(chatId, { weight });
            this.askHeight(chatId);
        });
    }

    private askHeight(chatId: number, message = 'Введи свій ріст (см) (від 100 до 220):') {
        this.bot.sendMessage(chatId, message);
        this.bot.once('message', (msg) => {
            const height = Number(msg.text.trim());
            if (isNaN(height) || height < 100 || height > 220) {
                this.bot.sendMessage(chatId, 'Будь ласка, введи число від 100 до 220.');
                return this.askHeight(chatId, '>');
            }
            this.userData.get(chatId).height = height;
            this.askAge(chatId);
        });
    }

    private askAge(chatId: number, message = 'Введи свій вік (від 14 до 130 років):') {
        this.bot.sendMessage(chatId, message);
        this.bot.once('message', (msg) => {
            const age = Number(msg.text.trim());
            if (isNaN(age) || age < 14 || age > 130) {
                this.bot.sendMessage(chatId, 'Будь ласка, введи число від 14 до 130.');
                return this.askAge(chatId, '>');
            }
            this.userData.get(chatId).age = age;
            this.askGender(chatId);
        });
    }

    private askGender(chatId: number) {
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Чоловік', callback_data: 'true' }],
                    [{ text: 'Жінка', callback_data: 'false' }],
                ],
            },
        };
        this.bot.sendMessage(chatId, 'Оберіть вашу стать:', options);
        this.bot.once('callback_query', (query) => {
            this.userData.get(chatId).gender = query.data;
            this.bot.answerCallbackQuery(query.id);
            this.askActivity(chatId);
        });
    }

    private askActivity(chatId: number) {
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Сидячий спосіб життя', callback_data: '1.2' }],
                    [{ text: 'Легка активність (1-3 тренування)', callback_data: '1.375' }],
                    [{ text: 'Помірна активність (3-5 тренувань)', callback_data: '1.55' }],
                    [{ text: 'Дуже активний (6-7 тренувань)', callback_data: '1.725' }],
                    [{ text: 'Надзвичайна активність', callback_data: '1.9' }],
                ],
            },
        };
        this.bot.sendMessage(chatId, 'Оберіть рівень активності:', options);
        this.bot.once('callback_query', (query) => {
            this.userData.get(chatId).activity = parseFloat(query.data);
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
        this.bot.once('callback_query', (query) => {
            this.userData.get(chatId).goal = query.data;
            this.bot.answerCallbackQuery(query.id);
            this.confirmData(chatId);
        });
    }

    private confirmData(chatId: number) {
        const user = this.userData.get(chatId);
        let goalText = '';
        if (user.goal === 'lose_weight') goalText = 'Схуднення';
        if (user.goal === 'gain_weight') goalText = 'Набір ваги';
        if (user.goal === 'maintain') goalText = 'Підтримка форми';
        this.bot.sendMessage(
            chatId,
            `Ваші дані:\nВага: ${user.weight} кг\nРіст: ${user.height} см\nВік: ${user.age} років\nСтать: ${
                user.gender ? 'Чоловік' : 'Жінка'
            }\nЦіль: ${goalText}
            \nВаша денна норма калорії ${calculateCalories(user)}
            \nЩоб змінити дані, натисніть /edit 
            \nЩоб отримати денне меню натисніть /menu`,
        );
    }
}
