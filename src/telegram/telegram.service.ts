import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { OpenAIService } from '../openai/openai.service';

@Injectable()
export class TelegramService implements OnModuleInit {
    private bot: TelegramBot;

    constructor(
        private configService: ConfigService,
        private openAIService: OpenAIService,
    ) {}

    async onModuleInit() {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        this.bot = new TelegramBot(token, { polling: true });

        this.bot.onText(/\/start/, (msg) => {
            this.bot.sendMessage(msg.chat.id, 'Привіт! Я AI-дієтолог. Введи свої дані: вага, зріст, ціль.');
        });

        this.bot.onText(/\/menu/, async (msg) => {
            try {
                const mealPlan = await this.openAIService.generateMealPlan('чоловік, денна потреба калорій 1800');
                this.bot.sendMessage(msg.chat.id, `Твоє меню на день:\n${mealPlan}`);
            } catch (error) {
                console.error('Помилка при запиті до OpenAI:', error);
                this.bot.sendMessage(msg.chat.id, 'Сталася помилка при генерації меню. Спробуй ще раз.');
            }
        });
    }
}
