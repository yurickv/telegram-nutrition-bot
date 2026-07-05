import { appButton, APP_URL_CTA, APP_URL_INVITE } from './appButton';

describe('appButton', () => {
    it('builds a cta button by default', () => {
        const kb = appButton();
        expect(kb.inline_keyboard[0][0].text).toBe('🥗 Відкрити Nutriday');
        expect(kb.inline_keyboard[0][0].url).toBe(APP_URL_CTA);
    });

    it('builds an invite button when asked', () => {
        expect(appButton('invite').inline_keyboard[0][0].url).toBe(APP_URL_INVITE);
    });

    it('cta url carries the cta-button utm_content, invite does not', () => {
        expect(APP_URL_CTA).toContain('utm_content=cta-button');
        expect(APP_URL_INVITE).not.toContain('utm_content');
    });
});
