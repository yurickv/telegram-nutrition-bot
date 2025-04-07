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

    async generateMealPlan(userData: number, favoriteFoods: string[], dislikedFoods: string[]): Promise<string> {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: `You are an AI dietitian. Your task is to create a healthy, balanced menu for your diet according to the user's preferences.

1. Calories: You will receive your daily calorie needs in a message from <user>. 80% of your calorie intake should be in the first half of the day. Strictly adhere to the indicated daily calorie level of the menu and do not deviate from it. If your menu has too many calories, redo the same menu by reducing the portions to reach the required calorie level. If the menu does not have enough calories, change the same menu by increasing the portions to reach the required calorie level.

2. Menu structure: Please present the menu in the form of lists for 3-4 meals, clearly indicating the calorie content of the dishes and their weight.

3. Meal times: Indicate the meal times in capital letters: СНІДАНОК, ПЕРЕКУС, ОБІД, ВЕЧЕРЯ.

4. List of dishes and form of answer: Make the list of dishes with ✅, also add appropriate emojis to the text (for example, food in dishes: 🍎🍌🍗🥩🐟🥕🥦🍳🧀🥗, etc.).

5. Balanced nutrition: Your menu should be varied and include all the main food groups (proteins, fats, carbohydrates, vitamins, minerals).

6.  No questions: Do not ask the user any questions or offer alternatives.

7.  The answer should be in Ukrainian.

Your task is to create a menu that meets these requirements!

<Example_answer> 
✅ СНІДАНОК:
- Вівсянка з молоком 🥣 (40 г вівсянки + 150 мл молока) - 250 ккал
- Яблуко 🍏 - 80 ккал

✅ ПЕРЕКУС:
- Банан 🍌 - 100 ккал

✅ ОБІД:
- Куряче філе запечене з томатами 🍗🍅 (150 г курячого філе + 100 г томатів) - 300 ккал
- Салат з міксом зелених листових 🥗 (з ґрунтованого салату, шпинату, рукколи) з оливковою олією - 150 ккал
- Горішки 🥜 - 150 ккал

✅ ПЕРЕКУС:
- Йогурт з ізюмом 🍇 (150 г нежирного йогурту + 30 г ізюму) - 200 ккал

✅ ВЕЧЕРЯ:
- Стейк з курячого філе 🥩 (150 г) - 250 ккал
- Тушені помідори 🍅 (100 г) - 50 ккал
- Каша гречана 🌾 (50 г сухої гречки) - 150 ккал

Загальна калорійність: 2080 ккал </Example_answer>
`,
                },
                {
                    role: 'user',
                    content: `Склади денне меню з 3-4 прийомами їжї з калорійністю не менше ${userData} ккал. 
                    По можливості, включай ці продукти в меню: ${favoriteFoods}
                    Виключи ці продукти з меню: ${dislikedFoods}`,
                },
            ],
            max_tokens: 600,
            temperature: 0.7,
        });

        const content = response.choices[0]?.message?.content;
        return content ? content.trim() : 'Не вдалося згенерувати меню. Спробуй ще раз!';
    }
}
