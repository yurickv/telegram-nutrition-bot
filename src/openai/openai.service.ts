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

    async generateMealPlan(userData: string): Promise<string> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: `Склади денне меню для користувача з параметрами: ${userData}` }],
            max_tokens: 600,
        });

        const content = response.choices[0]?.message?.content;
        return content ? content.trim() : 'Не вдалося згенерувати меню. Спробуй ще раз!';
    }
}
