import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { User } from '../user/user.schema';

@Injectable()
export class GoogleSheetService {
    private sheets;

    constructor() {
        const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, '\n');

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: SERVICE_ACCOUNT_EMAIL,
                private_key: SERVICE_ACCOUNT_PRIVATE_KEY,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        this.sheets = google.sheets({ version: 'v4', auth });
    }

    async writeSurveyAnswers(user: User, answers: string[]) {
        const spreadsheetId = '1jFSbwCRhA5XRcUAuka6aoWSOuV_FrnnAACggPB-Zhyc';

        // Декодуємо вибрані функції
        const featureMap = {
            f1: 'Збереження рецептів',
            f2: 'Генерація списку покупок',
            f3: 'Тижневе меню',
            f4: 'Підрахунок макронутрієнтів',
            f5: 'Відгуки та рейтинг страв',
            f6: 'Нагадування про прийом їжі',
            f7: 'Інтеграція з фітнес-трекерами',
        };

        const formatMap = {
            m1: 'Текстове меню в чаті',
            m2: 'PDF-файл',
            m3: 'Google Sheets',
            m4: 'Telegram-повідомлення з кнопками',
            m5: 'Інтерактивне меню в боті',
        };

        const formatSelections = (answer: string, map: Record<string, string>, noSelectionMessage: string): string =>
            answer?.length > 0
                ? answer
                      .split(',')
                      .map((code) => map[code.trim()] || code.trim())
                      .join(', ')
                : noSelectionMessage;

        const selectedFeatures = formatSelections(answers[4], featureMap, 'No features selected');
        const selectedFormats = formatSelections(answers[5], formatMap, 'No formats selected');

        const row = [
            new Date().toISOString(),
            user.chatId,
            user.username || '',
            user.sex ? 'Чоловік' : 'Жінка',
            user.age ?? '',
            answers[0], // Розрахунок калорій
            answers[1], // Денне меню
            answers[2], // Рецепти
            answers[3], // Улюблені продукти
            selectedFeatures,
            selectedFormats,
            answers[6], // Труднощі
        ];

        await this.sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Survey1!A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [row] },
        });
    }
}
