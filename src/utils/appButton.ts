import TelegramBot from 'node-telegram-bot-api';

const BASE_URL = 'https://nutriday.com.ua/?utm_source=telegram&utm_medium=referral&utm_campaign=miniapp';

export const APP_URL_INVITE = BASE_URL;
export const APP_URL_CTA = `${BASE_URL}&utm_content=cta-button`;

export function appButton(variant: 'cta' | 'invite' = 'cta'): TelegramBot.InlineKeyboardMarkup {
    const url = variant === 'cta' ? APP_URL_CTA : APP_URL_INVITE;
    return {
        inline_keyboard: [[{ text: '🥗 Відкрити Nutriday', url }]],
    };
}
