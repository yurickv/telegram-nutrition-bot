import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { UserService } from 'src/user/user.service';
import { appButton } from 'src/utils/appButton';

type DraftState = 'awaiting_content' | 'awaiting_confirm' | 'sending';

interface BroadcastDraft {
    state: DraftState;
    text?: string;
    photoFileId?: string;
    caption?: string;
    createdAt: number;
    timeout: NodeJS.Timeout;
}

const TEXT_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const DRAFT_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class BroadcastService {
    private drafts = new Map<number, BroadcastDraft>();
    private readonly adminChatId: number;
    private throttleMs = 40;

    constructor(
        private userService: UserService,
        configService: ConfigService,
    ) {
        this.adminChatId = Number(configService.get<string>('ADMIN_CHAT_ID'));
    }

    isAwaitingContent(chatId: number): boolean {
        return this.drafts.get(chatId)?.state === 'awaiting_content';
    }

    async start(bot: TelegramBot, chatId: number): Promise<void> {
        if (chatId !== this.adminChatId) return;

        const existing = this.drafts.get(chatId);
        if (existing?.state === 'sending') {
            await bot.sendMessage(chatId, '⏳ Розсилка вже виконується. Зачекайте завершення.');
            return;
        }
        if (existing) {
            clearTimeout(existing.timeout);
            this.drafts.delete(chatId);
        }

        const draft: BroadcastDraft = {
            state: 'awaiting_content',
            createdAt: Date.now(),
            timeout: setTimeout(() => this.expire(bot, chatId), DRAFT_TTL_MS),
        };
        draft.timeout.unref?.();
        this.drafts.set(chatId, draft);

        await bot.sendMessage(
            chatId,
            '📢 Надішліть контент розсилки: текст (до 4096) або фото з підписом (до 1024).',
        );
    }

    async handleContent(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
        const chatId = msg.chat.id;
        const draft = this.drafts.get(chatId);
        if (!draft || draft.state !== 'awaiting_content') return;

        if (msg.photo?.length) {
            const caption = msg.caption ?? '';
            if (caption.length > CAPTION_LIMIT) {
                await bot.sendMessage(chatId, `⚠️ Підпис задовгий (>${CAPTION_LIMIT}). Скоротіть і надішліть ще раз.`);
                return;
            }
            draft.photoFileId = msg.photo[msg.photo.length - 1].file_id;
            draft.caption = caption;
        } else if (msg.text) {
            if (msg.text.length > TEXT_LIMIT) {
                await bot.sendMessage(chatId, `⚠️ Текст задовгий (>${TEXT_LIMIT}). Скоротіть і надішліть ще раз.`);
                return;
            }
            draft.text = msg.text;
        } else {
            await bot.sendMessage(chatId, '⚠️ Надішліть текст або фото з підписом. Відео/файли не підтримуються.');
            return;
        }

        draft.state = 'awaiting_confirm';
        await this.sendPreview(bot, chatId, draft);
    }

    async handleCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<void> {
        const chatId = query.message!.chat.id;
        await bot.answerCallbackQuery(query.id);

        const draft = this.drafts.get(chatId);
        if (!draft) return;

        if (query.data === 'broadcast:cancel') {
            this.discard(chatId);
            await bot.sendMessage(chatId, '❌ Розсилку скасовано.');
            return;
        }

        if (query.data === 'broadcast:confirm') {
            if (draft.state !== 'awaiting_confirm') return; // ignore double-tap / mid-send
            draft.state = 'sending';
            clearTimeout(draft.timeout);

            const n = await this.userService.countActiveForBroadcast();
            await bot.sendMessage(chatId, `🚀 Розсилку почато (${n})...`);

            // fire-and-forget
            void this.runBroadcast(bot, chatId, draft).finally(() => this.drafts.delete(chatId));
        }
    }

    cancelPending(bot: TelegramBot, chatId: number): void {
        const draft = this.drafts.get(chatId);
        if (draft && draft.state !== 'sending') {
            clearTimeout(draft.timeout);
            this.drafts.delete(chatId);
            void bot.sendMessage(chatId, '❌ Чернетку розсилки скасовано.');
        }
    }

    private async sendPreview(bot: TelegramBot, chatId: number, draft: BroadcastDraft): Promise<void> {
        // 1) exact copy as users will see it
        if (draft.photoFileId) {
            await bot.sendPhoto(chatId, draft.photoFileId, {
                caption: draft.caption,
                reply_markup: appButton('invite'),
            });
        } else {
            await bot.sendMessage(chatId, draft.text!, { reply_markup: appButton('invite') });
        }

        // 2) control message with audience count
        const n = await this.userService.countActiveForBroadcast();
        if (n === 0) {
            this.discard(chatId);
            await bot.sendMessage(chatId, 'ℹ️ Немає активних користувачів для розсилки.');
            return;
        }
        await bot.sendMessage(chatId, `Надіслати ${n} активним користувачам?`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Підтвердити', callback_data: 'broadcast:confirm' },
                        { text: '❌ Скасувати', callback_data: 'broadcast:cancel' },
                    ],
                ],
            },
        });
    }

    private discard(chatId: number): void {
        const draft = this.drafts.get(chatId);
        if (draft) {
            clearTimeout(draft.timeout);
            this.drafts.delete(chatId);
        }
    }

    private async expire(bot: TelegramBot, chatId: number): Promise<void> {
        const draft = this.drafts.get(chatId);
        if (!draft || draft.state === 'sending') return;
        this.drafts.delete(chatId);
        await bot.sendMessage(chatId, '⌛️ Час на підготовку розсилки вийшов. Чернетку скасовано.');
    }

    private async runBroadcast(
        bot: TelegramBot,
        chatId: number,
        draft: BroadcastDraft,
    ): Promise<{ total: number; sent: number; blocked: number; failed: number; durationMs: number }> {
        const started = Date.now();
        const users = await this.userService.findActiveForBroadcast();
        const report = { total: users.length, sent: 0, blocked: 0, failed: 0, durationMs: 0 };

        for (const user of users) {
            try {
                await this.sendOne(bot, user.chatId, draft);
                report.sent++;
            } catch (err) {
                const retryAfter = this.retryAfterSeconds(err);
                if (retryAfter !== null) {
                    await this.sleep(retryAfter * 1000);
                    try {
                        await this.sendOne(bot, user.chatId, draft);
                        report.sent++;
                    } catch (retryErr) {
                        await this.classifyFailure(retryErr, user.chatId, report);
                    }
                } else {
                    await this.classifyFailure(err, user.chatId, report);
                }
            }
            await this.sleep(this.throttleMs);
        }

        report.durationMs = Date.now() - started;

        await bot.sendMessage(
            chatId,
            `📊 Розсилку завершено\n` +
                `Всього: ${report.total}\n` +
                `✅ Надіслано: ${report.sent}\n` +
                `🚫 Заблоковано: ${report.blocked}\n` +
                `⚠️ Помилок: ${report.failed}\n` +
                `⏱ Тривалість: ${Math.round(report.durationMs / 1000)}с`,
        );

        return report;
    }

    private async sendOne(bot: TelegramBot, targetChatId: number, draft: BroadcastDraft): Promise<void> {
        if (draft.photoFileId) {
            await bot.sendPhoto(targetChatId, draft.photoFileId, {
                caption: draft.caption,
                reply_markup: appButton('invite'),
            });
        } else {
            await bot.sendMessage(targetChatId, draft.text!, { reply_markup: appButton('invite') });
        }
    }

    private async classifyFailure(
        err: unknown,
        targetChatId: number,
        report: { blocked: number; failed: number },
    ): Promise<void> {
        if (this.isBlockedError(err)) {
            await this.userService.markBlocked(targetChatId);
            report.blocked++;
        } else {
            report.failed++;
            console.error(`Broadcast send failed for ${targetChatId}:`, err);
        }
    }

    private isBlockedError(err: unknown): boolean {
        const body = (err as any)?.response?.body;
        if (!body) return false;
        if (body.error_code === 403) return true;
        return body.error_code === 400 && /chat not found/i.test(body.description ?? '');
    }

    private retryAfterSeconds(err: unknown): number | null {
        const body = (err as any)?.response?.body;
        if (body?.error_code === 429) return body.parameters?.retry_after ?? 1;
        return null;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
