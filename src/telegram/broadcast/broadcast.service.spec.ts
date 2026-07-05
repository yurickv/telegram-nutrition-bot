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

describe('BroadcastService runBroadcast', () => {
    const rejectWith = (code: number, extra: any = {}) => ({ response: { body: { error_code: code, ...extra } } });

    it('sends to all, marks 403 as blocked, retries 429, reports tallies', async () => {
        const { service, userService } = makeService();
        userService.findActiveForBroadcast.mockResolvedValue([{ chatId: 1 }, { chatId: 2 }, { chatId: 3 }]);
        const bot = makeBot();
        bot.sendMessage
            .mockResolvedValueOnce({}) // user 1 ok
            .mockRejectedValueOnce(rejectWith(403, { description: 'bot was blocked by the user' })) // user 2 blocked
            .mockRejectedValueOnce(rejectWith(429, { parameters: { retry_after: 0 } })) // user 3 rate-limited
            .mockResolvedValueOnce({}); // user 3 retry ok

        const draft = { state: 'sending', text: 'hi', createdAt: Date.now(), timeout: setTimeout(() => {}, 0) } as any;
        const report = await (service as any).runBroadcast(bot, ADMIN, draft);

        expect(report).toEqual(expect.objectContaining({ total: 3, sent: 2, blocked: 1, failed: 0 }));
        expect(userService.markBlocked).toHaveBeenCalledWith(2);
        expect(userService.markBlocked).toHaveBeenCalledTimes(1);
    });

    it('marks 400 chat-not-found as blocked', async () => {
        const { service, userService } = makeService();
        userService.findActiveForBroadcast.mockResolvedValue([{ chatId: 8 }]);
        const bot = makeBot();
        bot.sendMessage.mockRejectedValueOnce(rejectWith(400, { description: 'Bad Request: chat not found' }));

        const draft = { state: 'sending', text: 'hi', createdAt: Date.now(), timeout: setTimeout(() => {}, 0) } as any;
        const report = await (service as any).runBroadcast(bot, ADMIN, draft);

        expect(report.blocked).toBe(1);
        expect(userService.markBlocked).toHaveBeenCalledWith(8);
    });

    it('counts a 500 as failed without marking blocked', async () => {
        const { service, userService } = makeService();
        userService.findActiveForBroadcast.mockResolvedValue([{ chatId: 9 }]);
        const bot = makeBot();
        bot.sendMessage.mockRejectedValueOnce(rejectWith(500, { description: 'Internal Server Error' }));

        const draft = { state: 'sending', text: 'hi', createdAt: Date.now(), timeout: setTimeout(() => {}, 0) } as any;
        const report = await (service as any).runBroadcast(bot, ADMIN, draft);

        expect(report.failed).toBe(1);
        expect(userService.markBlocked).not.toHaveBeenCalled();
    });

    it('sends a photo broadcast when the draft has a photo', async () => {
        const { service, userService } = makeService();
        userService.findActiveForBroadcast.mockResolvedValue([{ chatId: 1 }]);
        const bot = makeBot();
        const draft = { state: 'sending', photoFileId: 'pic', caption: 'cap', createdAt: Date.now(), timeout: setTimeout(() => {}, 0) } as any;
        await (service as any).runBroadcast(bot, ADMIN, draft);
        expect(bot.sendPhoto).toHaveBeenCalledWith(1, 'pic', expect.objectContaining({ caption: 'cap' }));
    });

    it('posts a final report to the admin', async () => {
        const { service, userService } = makeService();
        userService.findActiveForBroadcast.mockResolvedValue([{ chatId: 1 }]);
        const bot = makeBot();
        const draft = { state: 'sending', text: 'hi', createdAt: Date.now(), timeout: setTimeout(() => {}, 0) } as any;
        await (service as any).runBroadcast(bot, ADMIN, draft);
        expect(bot.sendMessage).toHaveBeenLastCalledWith(ADMIN, expect.stringContaining('Розсилку завершено'));
    });
});
