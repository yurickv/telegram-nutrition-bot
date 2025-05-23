import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TelegramService } from '../telegram/telegram.service';
import { GoogleSheetService } from '../googleServices/google-sheet.service';
import { User, UserDocument } from '../user/user.schema';
import TelegramBot from 'node-telegram-bot-api';
import * as dayjs from 'dayjs';
import * as cron from 'node-cron';
import * as tz from 'dayjs/plugin/timezone';
import * as utc from 'dayjs/plugin/utc';
import { UserService } from 'src/user/user.service';

dayjs.extend(utc);
dayjs.extend(tz);

interface SurveySession {
    stepIndex: number;
    answers: string[];
    collected: Record<string, string[]>;
    user: UserDocument;
    onMessage: (msg: TelegramBot.Message) => void;
    onCallback: (query: TelegramBot.CallbackQuery) => void;
    createdAt: number;
    timeout: NodeJS.Timeout;
}

@Injectable()
export class SurveyService {
    private sessions = new Map<number, SurveySession>();
    private MAX_SESSIONS = 1000;

    constructor(
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        private readonly telegramService: TelegramService,
        private readonly googleSheetService: GoogleSheetService,
        private userService: UserService,
    ) {}

    // cron.schedule('* * * * *', () => this.checkAndSendSurveys());
    async onModuleInit() {
        // this.setupSessionCleanup();
        // cron.schedule('0 */5 * * *', () => this.checkAndSendSurveys());
        // const data = await this.userService.findByChatId(7456685492);
        // console.log(data);
        // if (data) this.startSurveySession(data);
    }

    private cleanOldestSessionIfLimitExceeded() {
        if (this.sessions.size >= this.MAX_SESSIONS) {
            const firstKey = this.sessions.keys().next().value;
            const session = this.sessions.get(firstKey);
            if (session) {
                clearTimeout(session.timeout);
                this.sessions.delete(firstKey);
            }
        }
    }
    private setupSessionCleanup() {
        cron.schedule('*/50 * * * *', () => {
            const now = Date.now();
            const TTL = 10 * 60 * 1000;

            for (const [chatId, session] of this.sessions.entries()) {
                const age = now - session.createdAt;

                if (age > TTL) {
                    console.log(`⚠️ Видалення завислої сесії: chatId=${chatId}`);
                    clearTimeout(session.timeout);
                    this.sessions.delete(chatId);
                }
            }
        });
    }

    async checkAndSendSurveys() {
        const nowKyiv = dayjs().tz('Europe/Kyiv');
        const hour = nowKyiv.hour();
        if (hour < 8 || hour >= 20) return;
        const users = await this.userModel.find({
            firstInit: { $exists: true },
            $or: [{ surveyCompleted: { $exists: false } }, { 'surveyCompleted.survey1': { $ne: true } }],
        });
        for (const user of users) {
            const daysPassed = dayjs().diff(dayjs(user.firstInit), 'day');
            if (daysPassed >= 2 && !this.sessions.has(user.chatId)) {
                this.startSurveySession(user);
            }
        }
    }

    async startSurveySession(user: UserDocument) {
        this.cleanOldestSessionIfLimitExceeded();
        const bot = this.telegramService.getBot();
        const chatId = user.chatId;
        const steps = [
            {
                key: 'rateCalories',
                question: `Допоможіть покращити цей сервіс!
                Пройдіть коротке опитування

                1️⃣ Оцініть "Розрахунок калорій"`,
                options: ['1', '2', '3', '4', '5'],
            },
            {
                key: 'rateMenu',
                question: '2️⃣ Оцініть "Складання денного меню"',
                options: ['1', '2', '3', '4', '5'],
            },
            {
                key: 'rateRecipes',
                question: '3️⃣ Оцініть "Рецепти приготування"',
                options: ['1', '2', '3', '4', '5'],
            },
            {
                key: 'ratePrefs',
                question: '4️⃣ Оцініть "Улюблені/небажані продукти"',
                options: ['1', '2', '3', '4', '5'],
            },
            {
                key: 'functions',
                question: '5️⃣ Які функції ви хотіли б бачити? (Оберіть до 3)',
                options: [
                    { label: 'Збереження рецептів', value: 'f1' },
                    { label: 'Список покупок', value: 'f2' },
                    { label: 'Тижневе меню', value: 'f3' },
                    { label: 'Макронутрієнти', value: 'f4' },
                    { label: 'Рейтинг страв', value: 'f5' },
                    { label: 'Нагадування про їжу', value: 'f6' },
                    { label: 'Фітнес-трекери', value: 'f7' },
                ],
                multiple: true,
            },
            {
                key: 'formats',
                question: '6️⃣ Найзручніший формат меню? (Обрати кілька)',
                options: [
                    { label: 'Текст у чаті', value: 'm1' },
                    { label: 'PDF-файл', value: 'm2' },
                    { label: 'Google Sheets', value: 'm3' },
                    { label: 'Кнопки в чаті', value: 'm4' },
                    { label: 'Інтерактивне меню', value: 'm5' },
                ],
                multiple: true,
            },
            {
                key: 'difficulties',
                question: '7️⃣ З якими труднощами ви зіткнулись при харчуванні по меню?',
                open: true,
            },
        ];

        const session: SurveySession = {
            stepIndex: 0,
            answers: [],
            collected: { functions: [], formats: [] },
            user,
            onMessage: () => {},
            onCallback: () => {},
            createdAt: Date.now(),
            timeout: setTimeout(() => this.forceFinishSurvey(session), 40 * 60 * 1000),
        };

        const sendStep = async () => {
            const step = steps[session.stepIndex];
            if (!step) return;

            if (step.open) {
                await bot.sendMessage(chatId, step.question);
                return;
            }

            const buttons = (step.options || []).map((opt) => {
                const label = typeof opt === 'string' ? opt : opt.label;
                const value = typeof opt === 'string' ? opt : opt.value;
                return [{ text: label, callback_data: `survey:${chatId}:${session.stepIndex}:${value}` }];
            });

            if (step.multiple) {
                buttons.push([{ text: '✅ Готово', callback_data: `survey:${chatId}:${session.stepIndex}:done` }]);
            }

            await bot.sendMessage(chatId, step.question, {
                reply_markup: { inline_keyboard: buttons },
            });
        };

        session.onCallback = async (query) => {
            if (query.from.id !== chatId) return;
            const data = query.data;
            if (!data?.startsWith('survey:')) return;

            const [, idStr, stepStr, value] = data.split(':');
            if (+idStr !== chatId || +stepStr !== session.stepIndex) return;

            const step = steps[session.stepIndex];
            const isMultiple = step.multiple ?? false;

            if (isMultiple) {
                if (value === 'done') {
                    session.answers.push((session.collected[step.key] || []).join(', '));
                    session.stepIndex++;

                    await sendStep();
                } else {
                    if (!session.collected[step.key].includes(value)) {
                        session.collected[step.key].push(value);
                        await bot.answerCallbackQuery(query.id, { text: '✅ Обрано' });
                    }
                }
            } else {
                session.answers.push(value);
                session.stepIndex++;
                await bot.answerCallbackQuery(query.id, { text: '✅ Прийнято' });
                await sendStep();
            }

            if (session.stepIndex >= steps.length) {
                this.finishSurvey(session);
            }
        };

        session.onMessage = async (msg) => {
            if (msg.chat.id !== chatId) return;
            const step = steps[session.stepIndex];
            if (!step?.open) return;

            session.answers.push(msg.text);
            session.stepIndex++;

            await sendStep();

            if (session.stepIndex >= steps.length) {
                this.finishSurvey(session);
            }
        };

        this.sessions.set(chatId, session);
        bot.on('callback_query', session.onCallback);
        bot.on('message', session.onMessage);

        await sendStep();
    }

    private async finishSurvey(session: SurveySession) {
        const { user, answers, onMessage, onCallback, timeout } = session;
        const bot = this.telegramService.getBot();

        clearTimeout(timeout);
        bot.removeListener('callback_query', onCallback);
        bot.removeListener('message', onMessage);
        this.sessions.delete(user.chatId);

        await this.googleSheetService.writeSurveyAnswers(user, answers);
        user.surveyCompleted = { ...(user.surveyCompleted || {}), survey1: true };
        await user.save();

        await bot.sendMessage(user.chatId, '✅ Дякуємо! Опитування завершено.', {
            reply_markup: {
                remove_keyboard: true,
            },
        });
    }

    private async forceFinishSurvey(session: SurveySession) {
        const { user, answers, onMessage, onCallback, timeout } = session;
        const bot = this.telegramService.getBot();
        clearTimeout(timeout);
        bot.removeListener('callback_query', onCallback);
        bot.removeListener('message', onMessage);
        this.sessions.delete(user.chatId);

        await this.googleSheetService.writeSurveyAnswers(user, answers);
        user.surveyCompleted = { ...(user.surveyCompleted || {}), survey1: false };
        await user.save();

        await bot.sendMessage(user.chatId, '⌛️ Час на опитування вийшов. Збережено надані відповіді.', {
            reply_markup: {
                remove_keyboard: true,
            },
        });
    }
}
