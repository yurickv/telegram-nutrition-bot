import { channelButton, appAndChannelButtons, CHANNEL_URL } from './channelButton';
import { APP_URL_CTA } from './appButton';

describe('channelButton', () => {
    it('points to the Sytno channel', () => {
        expect(CHANNEL_URL).toBe('https://t.me/sytno_app');
        const kb = channelButton();
        expect(kb.inline_keyboard[0][0].text).toBe('📣 Канал Sytno');
        expect(kb.inline_keyboard[0][0].url).toBe(CHANNEL_URL);
    });

    it('combines app cta and channel buttons in two rows', () => {
        const kb = appAndChannelButtons();
        expect(kb.inline_keyboard).toHaveLength(2);
        expect(kb.inline_keyboard[0][0].url).toBe(APP_URL_CTA);
        expect(kb.inline_keyboard[1][0].url).toBe(CHANNEL_URL);
    });
});
