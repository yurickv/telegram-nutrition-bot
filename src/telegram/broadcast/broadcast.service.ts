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
}
