import { BroadcastService } from './broadcast.service';

const ADMIN = 999;

function makeBot() {
    return {
        sendMessage: jest.fn().mockResolvedValue({}),
        sendPhoto: jest.fn().mockResolvedValue({}),
        answerCallbackQuery: jest.fn().mockResolvedValue({}),
    } as any;
}

function makeService(overrides: Partial<any> = {}) {
    const userService = {
        countActiveForBroadcast: jest.fn().mockResolvedValue(5),
        findActiveForBroadcast: jest.fn().mockResolvedValue([]),
        markBlocked: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
    const configService = { get: jest.fn().mockReturnValue(String(ADMIN)) };
    const service = new BroadcastService(userService as any, configService as any);
    (service as any).throttleMs = 0;
    return { service, userService };
}

describe('BroadcastService content capture', () => {
    it('ignores /broadcast from a non-admin', async () => {
        const { service } = makeService();
        const bot = makeBot();
        await service.start(bot, 111);
        expect(service.isAwaitingContent(111)).toBe(false);
        expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    it('starts a draft for the admin and awaits content', async () => {
        const { service } = makeService();
        const bot = makeBot();
        await service.start(bot, ADMIN);
        expect(service.isAwaitingContent(ADMIN)).toBe(true);
        expect(bot.sendMessage).toHaveBeenCalledWith(ADMIN, expect.stringContaining('Надішліть контент'));
    });

    it('accepts text and moves to preview + confirm control', async () => {
        const { service, userService } = makeService();
        const bot = makeBot();
        await service.start(bot, ADMIN);
        await service.handleContent(bot, { chat: { id: ADMIN }, text: 'Новина!' } as any);
        expect(service.isAwaitingContent(ADMIN)).toBe(false);
        expect(userService.countActiveForBroadcast).toHaveBeenCalled();
        expect(bot.sendMessage).toHaveBeenCalledWith(ADMIN, 'Новина!', expect.objectContaining({ reply_markup: expect.anything() }));
        expect(bot.sendMessage).toHaveBeenCalledWith(ADMIN, expect.stringContaining('Надіслати 5'), expect.anything());
    });

    it('accepts a photo with caption (largest file_id)', async () => {
        const { service } = makeService();
        const bot = makeBot();
        await service.start(bot, ADMIN);
        await service.handleContent(bot, {
            chat: { id: ADMIN },
            photo: [{ file_id: 'small' }, { file_id: 'big' }],
            caption: 'Дивись!',
        } as any);
        expect(bot.sendPhoto).toHaveBeenCalledWith(ADMIN, 'big', expect.objectContaining({ caption: 'Дивись!' }));
    });

    it('rejects an over-long caption and stays awaiting content', async () => {
        const { service } = makeService();
        const bot = makeBot();
        await service.start(bot, ADMIN);
        await service.handleContent(bot, {
            chat: { id: ADMIN },
            photo: [{ file_id: 'big' }],
            caption: 'x'.repeat(1025),
        } as any);
        expect(service.isAwaitingContent(ADMIN)).toBe(true);
        expect(bot.sendMessage).toHaveBeenLastCalledWith(ADMIN, expect.stringContaining('задовгий'));
    });

    it('rejects unsupported message types', async () => {
        const { service } = makeService();
        const bot = makeBot();
        await service.start(bot, ADMIN);
        await service.handleContent(bot, { chat: { id: ADMIN } } as any); // no text, no photo
        expect(service.isAwaitingContent(ADMIN)).toBe(true);
        expect(bot.sendMessage).toHaveBeenLastCalledWith(ADMIN, expect.stringContaining('текст або фото'));
    });

    it('reports zero-audience and cancels the draft', async () => {
        const { service } = makeService({ countActiveForBroadcast: jest.fn().mockResolvedValue(0) });
        const bot = makeBot();
        await service.start(bot, ADMIN);
        await service.handleContent(bot, { chat: { id: ADMIN }, text: 'hi' } as any);
        expect(bot.sendMessage).toHaveBeenLastCalledWith(ADMIN, expect.stringContaining('Немає активних'));
        expect(service.isAwaitingContent(ADMIN)).toBe(false);
        expect((service as any).drafts.has(ADMIN)).toBe(false);
    });
});
