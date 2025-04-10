import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { UserService } from 'src/user/user.service';

@Injectable()
export class FoodInputService {
    constructor(private userService: UserService) {}

    promptAddFoods(bot: TelegramBot, chatId: number, type: 'favorite' | 'disliked', setState: (s: string) => void) {
        const label = type === 'favorite' ? 'улюблені' : 'небажані';
        bot.sendMessage(chatId, `Введіть ваші ${label} продукти через кому (до 30 символів кожен):`);
        setState(type === 'favorite' ? 'adding_favorite_foods' : 'adding_disliked_foods');
    }

    async handleFoodInput(
        bot: TelegramBot,
        chatId: number,
        text: string,
        type: 'favorite' | 'disliked',
        clearState: () => void,
    ) {
        const foods = text
            .split(',')
            .map((f) => f.trim())
            .filter((f) => f.length && f.length <= 30);

        if (!foods.length) {
            return bot.sendMessage(chatId, 'Немає допустимих продуктів.');
        }

        const addMethod = type === 'favorite' ? this.userService.addFavoriteFoods : this.userService.addDislikedFoods;

        await addMethod.call(this.userService, chatId, foods);
        clearState();
        bot.sendMessage(chatId, `${type === 'favorite' ? 'Улюблені' : 'Небажані'} продукти оновлено.`);
    }
}
