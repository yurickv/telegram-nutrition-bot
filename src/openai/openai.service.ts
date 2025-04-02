import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class OpenAIService {
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    systemPromt = ``;

    async generateMealPlan(userData: number): Promise<string> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content:
                        'Ти AI-дієтолог. Генеруй корисне меню для здоворого харчування відповідно до параметрів користувача.\n Меню подай списками на 3-4 прийоми їжї із вказанням калорійності страв і їх вагою.\n 80% калорійності слід зїдати в першій половині дня.\n Денну потребу в калоріях ти отримаєш в повідомленні від <user>.\nДостимуйся строго наданій калорійності, не допускай відхилень.',
                },
                { role: 'user', content: `Склади денне меню з калорійністю: ${userData} ккал` },
            ],
            max_tokens: 600,
        });

        const content = response.choices[0]?.message?.content;
        return content ? content.trim() : 'Не вдалося згенерувати меню. Спробуй ще раз!';
    }
}
