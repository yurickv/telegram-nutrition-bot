import { Injectable } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { ConfirmationService } from '../confirmation/confirmation.service';

import TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class OnboardingService {
    constructor(
        private userService: UserService,
        private confirmationService: ConfirmationService,
    ) {}

    askWeight(bot: TelegramBot, chatId: number, setState: (state: string) => void) {
        setState('waiting_for_weight');
        bot.sendMessage(chatId, 'Введіть свою вагу (кг):');
    }

    async handleWeightInput(bot: TelegramBot, chatId: number, text: string, setState: (state: string) => void) {
        const val = Number(text.trim());
        if (isNaN(val) || val < 40 || val > 150) {
            return bot.sendMessage(chatId, 'Введіть число від 40 до 150.');
        }
        await this.userService.updateUser(chatId, { weight: val });
        setState('');
        this.askHeight(bot, chatId, setState);
    }

    askHeight(bot: TelegramBot, chatId: number, setState: (state: string) => void) {
        setState('waiting_for_height');
        bot.sendMessage(chatId, 'Введіть свій ріст (см):');
    }

    async handleHeightInput(bot: TelegramBot, chatId: number, text: string, setState: (state: string) => void) {
        const val = Number(text.trim());
        if (isNaN(val) || val < 100 || val > 220) {
            return bot.sendMessage(chatId, 'Введіть число від 100 до 220.');
        }
        await this.userService.updateUser(chatId, { height: val });
        setState('');
        this.askAge(bot, chatId, setState);
    }

    askAge(bot: TelegramBot, chatId: number, setState: (state: string) => void) {
        setState('waiting_for_age');
        bot.sendMessage(chatId, 'Введіть свій вік:');
    }

    async handleAgeInput(bot: TelegramBot, chatId: number, text: string, setState: (state: string) => void) {
        const val = Number(text.trim());
        if (isNaN(val) || val < 14 || val > 130) {
            return bot.sendMessage(chatId, 'Введіть число від 14 до 130.');
        }
        await this.userService.updateUser(chatId, { age: val });
        setState('');
        this.askGender(bot, chatId, setState);
    }
    askGender(bot: TelegramBot, chatId: number, setState: (state: string) => void) {
        setState('waiting_for_gender');
        bot.sendMessage(chatId, 'Оберіть вашу стать:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Чоловік', callback_data: 'gender:true' }],
                    [{ text: 'Жінка', callback_data: 'gender:false' }],
                ],
            },
        });
    }

    async handleGender(bot: TelegramBot, chatId: number, data: string, setState: (state: string) => void) {
        const value = data.split(':')[1] === 'true';
        await this.userService.updateUser(chatId, { sex: value });
        setState('');
        this.askActivity(bot, chatId, setState);
    }

    askActivity(bot: TelegramBot, chatId: number, setState: (state: string) => void) {
        setState('waiting_for_activity');
        bot.sendMessage(chatId, 'Оберіть рівень активності:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Сидячий', callback_data: 'activity:1.2' }],
                    [{ text: 'Легка активність', callback_data: 'activity:1.375' }],
                    [{ text: 'Помірна активність', callback_data: 'activity:1.55' }],
                    [{ text: 'Висока активність', callback_data: 'activity:1.725' }],
                ],
            },
        });
    }

    async handleActivity(bot: TelegramBot, chatId: number, data: string, setState: (state: string) => void) {
        const value = parseFloat(data.split(':')[1]);
        await this.userService.updateUser(chatId, { activity: value });
        setState('');
        this.askGoal(bot, chatId, setState);
    }

    askGoal(bot: TelegramBot, chatId: number, setState: (state: string) => void) {
        setState('waiting_for_goal');
        bot.sendMessage(chatId, 'Яка ваша ціль?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Схуднення', callback_data: 'goal:lose_weight' }],
                    [{ text: 'Набір ваги', callback_data: 'goal:gain_weight' }],
                    [{ text: 'Підтримка форми', callback_data: 'goal:maintain' }],
                ],
            },
        });
    }

    async handleGoal(bot: TelegramBot, chatId: number, data: string, setState: (state: string) => void) {
        const value = data.split(':')[1];
        await this.userService.updateUser(chatId, { goal: value });
        setState('');
        await this.confirmationService.confirmData(bot, chatId);
    }
}
