import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { UserService } from 'src/user/user.service';
import { padRight } from 'src/utils/formatViewButton';

@Injectable()
export class FoodPreferenceService {
    constructor(private userService: UserService) {}

    async handleFavoriteFoods(bot: TelegramBot, chatId: number) {
        const user = await this.userService.findByChatId(chatId);
        const foods = user?.favoriteFoods || [];

        const inlineKeyboard = foods.map((food) => [{ text: padRight(food), callback_data: `remove_fav:${food}` }]);
        inlineKeyboard.push([{ text: '➕ Додати нові', callback_data: 'add_fav' }]);

        bot.sendMessage(chatId, 'Ваші улюблені продукти:', {
            reply_markup: { inline_keyboard: inlineKeyboard },
        });
    }

    async handleDislikedFoods(bot: TelegramBot, chatId: number) {
        const user = await this.userService.findByChatId(chatId);
        const foods = user?.dislikedFoods || [];

        const inlineKeyboard = foods.map((food) => [{ text: padRight(food), callback_data: `remove_dis:${food}` }]);
        inlineKeyboard.push([{ text: '➕ Додати нові', callback_data: 'add_dis' }]);

        bot.sendMessage(chatId, 'Ваші небажані продукти:', {
            reply_markup: { inline_keyboard: inlineKeyboard },
        });
    }
}
