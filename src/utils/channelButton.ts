import TelegramBot from 'node-telegram-bot-api';
import { appButton } from './appButton';

export const CHANNEL_URL = 'https://t.me/sytno_app';

export function channelButton(): TelegramBot.InlineKeyboardMarkup {
    return {
        inline_keyboard: [[{ text: '📣 Канал Sytno', url: CHANNEL_URL }]],
    };
}

export function appAndChannelButtons(): TelegramBot.InlineKeyboardMarkup {
    return {
        inline_keyboard: [...appButton('cta').inline_keyboard, ...channelButton().inline_keyboard],
    };
}
