import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { UserService } from 'src/user/user.service';
import { calculateCalories } from 'src/utils/calcColories';

@Injectable()
export class ConfirmationService {
    constructor(private userService: UserService) {}

    async confirmData(bot: TelegramBot, chatId: number) {
        const user = await this.userService.findByChatId(chatId);
        if (!user) {
            return bot.sendMessage(chatId, 'Дані не знайдено. Натисніть /start.');
        }

        const goalText =
            user.goal === 'lose_weight' ? 'Схуднення' : user.goal === 'gain_weight' ? 'Набір ваги' : 'Підтримка форми';

        const calories = calculateCalories(user);

        bot.sendMessage(
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
}
