# App Link Button + Broadcast Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline URL button to the Nutriday web app across several bot touchpoints, and build a reusable admin `/broadcast` mechanism that sends text/photo announcements to active users with throttling, blocked-user marking, and a delivery report.

**Architecture:** A shared `appButton()` helper produces the inline URL keyboard. A new `BroadcastService` (in the telegram module) encapsulates the admin draft→preview→confirm→send flow; it receives the `bot` instance as a method parameter (matching the existing `OnboardingService`/`FoodInputService` pattern) so there is no circular dependency with `TelegramService`. `TelegramService` delegates to it from its single `message`/`callback_query` handlers — no new global `bot.on(...)` listeners (unlike `SurveyService`). The `User` schema gains an `isBlocked` flag driving audience filtering.

**Tech Stack:** NestJS 11, node-telegram-bot-api 0.66, Mongoose 8, Jest 29 (ts-jest).

## Global Constraints

- Admin is identified by `ADMIN_CHAT_ID` from `.env`, read via `ConfigService`. The existing hardcoded feedback recipient `7456685492` must migrate to this single source.
- "Active user" = `amountMenu > 0` AND `isBlocked !== true`. Exact query: `{ amountMenu: { $gt: 0 }, isBlocked: { $ne: true } }`.
- Broadcast content: plain text (no `parse_mode`), max 4096 chars for text, max 1024 chars for photo caption. Only text OR a single photo+caption — reject video/documents/albums.
- App button label: `🥗 Відкрити Nutriday`. Reply-keyboard button label: `🥗 Застосунок`.
- URLs (exact, verbatim):
  - CTA: `https://nutriday.com.ua/?utm_source=telegram&utm_medium=referral&utm_campaign=miniapp&utm_content=cta-button`
  - Invite: `https://nutriday.com.ua/?utm_source=telegram&utm_medium=referral&utm_campaign=miniapp`
- Send throttle ≈ 25/s (40 ms pause per message). Broadcast runs fire-and-forget (not awaited).
- Error handling: `error_code` 403 or (400 with description matching `chat not found`) → mark `isBlocked`; 429 → wait `parameters.retry_after` seconds and retry once; anything else → count as failed, do not mark.
- Follow existing code style: 4-space indent, single quotes, `import TelegramBot from 'node-telegram-bot-api';` (default import, as in `food-input.service.ts`).
- Commit after every task.

---

### Task 1: `appButton` helper + URL constants

**Files:**
- Create: `src/utils/appButton.ts`
- Test: `src/utils/appButton.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `APP_URL_CTA: string`, `APP_URL_INVITE: string`
  - `appButton(variant?: 'cta' | 'invite'): TelegramBot.InlineKeyboardMarkup` — returns `{ inline_keyboard: [[{ text: '🥗 Відкрити Nutriday', url }]] }`. Default variant is `'cta'`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/appButton.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- appButton`
Expected: FAIL — `Cannot find module './appButton'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/appButton.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- appButton`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/appButton.ts src/utils/appButton.spec.ts
git commit -m "feat: add appButton helper with cta/invite url variants"
```

---

### Task 2: `ADMIN_CHAT_ID` config + migrate feedback recipient

**Files:**
- Modify: `.env` (add one line — environment-local; not necessarily committed)
- Modify: `src/telegram/telegram.service.ts` (add `adminChatId` field, set it in `onModuleInit`, replace hardcoded `7456685492` in the feedback handler)

**Interfaces:**
- Consumes: `ConfigService` (already injected into `TelegramService`).
- Produces: `private adminChatId: number` on `TelegramService`, available to later wiring.

- [ ] **Step 1: Add the env var**

Add this line to `.env`:

```
ADMIN_CHAT_ID=7456685492
```

> Note: `.env` is environment-local. Also set `ADMIN_CHAT_ID` in the Render dashboard for production. Do not rely on committing `.env`.

- [ ] **Step 2: Add the field and initialize it in `onModuleInit`**

In `src/telegram/telegram.service.ts`, add a field next to the other private fields (near line 16-18):

```typescript
    private adminChatId: number;
```

At the very start of `onModuleInit()` (before reading the token), add:

```typescript
        this.adminChatId = Number(this.configService.get<string>('ADMIN_CHAT_ID'));
```

- [ ] **Step 3: Replace the hardcoded feedback recipient**

In the `waiting_for_feedback` branch of the `message` handler, change:

```typescript
                    await this.bot.sendMessage(
                        7456685492,
                        `📨 Новий фідбек від @${msg.from?.username || 'невідомо'}:\n\n${feedback}`,
                    );
```

to:

```typescript
                    await this.bot.sendMessage(
                        this.adminChatId,
                        `📨 Новий фідбек від @${msg.from?.username || 'невідомо'}:\n\n${feedback}`,
                    );
```

- [ ] **Step 4: Verify the project still builds**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/telegram.service.ts
git commit -m "refactor: read admin chat id from ADMIN_CHAT_ID env for feedback routing"
```

---

### Task 3: `isBlocked` schema field + `UserService` audience/block methods

**Files:**
- Modify: `src/user/user.schema.ts` (add `isBlocked`, `blockedAt`)
- Modify: `src/user/user.service.ts` (add four methods)
- Test: `src/user/user.service.spec.ts` (create)

**Interfaces:**
- Consumes: existing `User`/`UserDocument`, injected `userModel`.
- Produces on `UserService`:
  - `findActiveForBroadcast(): Promise<UserDocument[]>`
  - `countActiveForBroadcast(): Promise<number>`
  - `markBlocked(chatId: number): Promise<void>`
  - `resetBlockedIfFlagged(chatId: number): Promise<void>`

- [ ] **Step 1: Add schema fields**

In `src/user/user.schema.ts`, add these props inside the `User` class (after `lastMenuRequest`):

```typescript
    @Prop({ default: false })
    isBlocked: boolean;

    @Prop()
    blockedAt: Date;
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/user/user.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UserService } from './user.service';
import { User } from './user.schema';

describe('UserService broadcast helpers', () => {
    let service: UserService;
    let model: any;

    beforeEach(async () => {
        model = {
            find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ chatId: 1 }]) }),
            countDocuments: jest.fn().mockResolvedValue(7),
            updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
        };
        const moduleRef = await Test.createTestingModule({
            providers: [UserService, { provide: getModelToken(User.name), useValue: model }],
        }).compile();
        service = moduleRef.get(UserService);
    });

    it('findActiveForBroadcast filters by amountMenu>0 and not blocked', async () => {
        await service.findActiveForBroadcast();
        expect(model.find).toHaveBeenCalledWith({ amountMenu: { $gt: 0 }, isBlocked: { $ne: true } });
    });

    it('countActiveForBroadcast counts the same filter', async () => {
        const n = await service.countActiveForBroadcast();
        expect(model.countDocuments).toHaveBeenCalledWith({ amountMenu: { $gt: 0 }, isBlocked: { $ne: true } });
        expect(n).toBe(7);
    });

    it('markBlocked sets isBlocked and blockedAt for the chat', async () => {
        await service.markBlocked(5);
        expect(model.updateOne).toHaveBeenCalledWith(
            { chatId: 5 },
            { $set: { isBlocked: true, blockedAt: expect.any(Date) } },
        );
    });

    it('resetBlockedIfFlagged only touches users currently blocked', async () => {
        await service.resetBlockedIfFlagged(5);
        expect(model.updateOne).toHaveBeenCalledWith(
            { chatId: 5, isBlocked: true },
            { $set: { isBlocked: false } },
        );
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- user.service`
Expected: FAIL — `service.findActiveForBroadcast is not a function`.

- [ ] **Step 4: Implement the methods**

In `src/user/user.service.ts`, add these methods inside the `UserService` class (e.g. after `removeDislikedFood`):

```typescript
    async findActiveForBroadcast(): Promise<UserDocument[]> {
        return this.userModel.find({ amountMenu: { $gt: 0 }, isBlocked: { $ne: true } }).exec();
    }

    async countActiveForBroadcast(): Promise<number> {
        return this.userModel.countDocuments({ amountMenu: { $gt: 0 }, isBlocked: { $ne: true } });
    }

    async markBlocked(chatId: number): Promise<void> {
        await this.userModel.updateOne({ chatId }, { $set: { isBlocked: true, blockedAt: new Date() } }).exec();
    }

    async resetBlockedIfFlagged(chatId: number): Promise<void> {
        await this.userModel.updateOne({ chatId, isBlocked: true }, { $set: { isBlocked: false } }).exec();
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- user.service`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/user/user.schema.ts src/user/user.service.ts src/user/user.service.spec.ts
git commit -m "feat: add isBlocked field and broadcast audience/block queries"
```

---

### Task 4: `BroadcastService` — draft start + content capture/validation + preview

**Files:**
- Create: `src/telegram/broadcast/broadcast.service.ts`
- Test: `src/telegram/broadcast/broadcast.service.spec.ts`

**Interfaces:**
- Consumes: `UserService.countActiveForBroadcast`, `ConfigService`, `appButton`.
- Produces on `BroadcastService`:
  - `start(bot: TelegramBot, chatId: number): Promise<void>`
  - `isAwaitingContent(chatId: number): boolean`
  - `handleContent(bot: TelegramBot, msg: TelegramBot.Message): Promise<void>`
  - internal `drafts: Map<number, BroadcastDraft>` where `BroadcastDraft = { state: 'awaiting_content' | 'awaiting_confirm' | 'sending'; text?: string; photoFileId?: string; caption?: string; createdAt: number; timeout: NodeJS.Timeout }`
  - `private readonly adminChatId: number`, `private throttleMs = 40`
  - private helpers `sendPreview`, `discard`, `expire`

- [ ] **Step 1: Write the failing test**

```typescript
// src/telegram/broadcast/broadcast.service.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- broadcast.service`
Expected: FAIL — `Cannot find module './broadcast.service'`.

- [ ] **Step 3: Implement `BroadcastService` (start/content/preview)**

```typescript
// src/telegram/broadcast/broadcast.service.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- broadcast.service`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/telegram/broadcast/broadcast.service.ts src/telegram/broadcast/broadcast.service.spec.ts
git commit -m "feat: broadcast draft start, content capture, validation and preview"
```

---

### Task 5: `BroadcastService` — `runBroadcast` throttle, errors, report

**Files:**
- Modify: `src/telegram/broadcast/broadcast.service.ts` (add `runBroadcast` + private helpers)
- Modify: `src/telegram/broadcast/broadcast.service.spec.ts` (add send-loop tests)

**Interfaces:**
- Consumes: `UserService.findActiveForBroadcast`, `UserService.markBlocked`, `appButton('invite')`.
- Produces on `BroadcastService`:
  - `private runBroadcast(bot, chatId, draft): Promise<{ total: number; sent: number; blocked: number; failed: number; durationMs: number }>` — sends the draft to every active user, classifies errors, posts a report to the admin, and returns the tally. Called by the confirm handler in Task 6.
  - private helpers `sendOne`, `classifyFailure`, `isBlockedError`, `retryAfterSeconds`, `sleep`.

- [ ] **Step 1: Write the failing tests (append to the spec file — the `ADMIN`/`makeBot`/`makeService` helpers from Task 4 are already in scope)**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- broadcast.service`
Expected: FAIL — `service.runBroadcast is not a function`.

- [ ] **Step 3: Implement `runBroadcast` and helpers**

Add these methods to `BroadcastService` (after `expire`):

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- broadcast.service`
Expected: PASS (Task 4 tests + 5 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/telegram/broadcast/broadcast.service.ts src/telegram/broadcast/broadcast.service.spec.ts
git commit -m "feat: broadcast send loop with throttling, error classification and report"
```

---

### Task 6: `BroadcastService` — confirm/cancel/guards lifecycle

**Files:**
- Modify: `src/telegram/broadcast/broadcast.service.ts` (add `handleCallback`, `cancelPending`)
- Modify: `src/telegram/broadcast/broadcast.service.spec.ts` (add lifecycle tests)

**Interfaces:**
- Consumes: `runBroadcast` (Task 5), `UserService.countActiveForBroadcast`, `discard` (Task 4).
- Produces on `BroadcastService`:
  - `handleCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<void>` — handles `broadcast:confirm` / `broadcast:cancel`.
  - `cancelPending(bot: TelegramBot, chatId: number): void` — cancels a non-sending draft (used when the admin issues another command).

- [ ] **Step 1: Write the failing tests (append to the spec file)**

```typescript
describe('BroadcastService lifecycle', () => {
    it('cancel discards the draft and confirms to admin', async () => {
        const { service } = makeService();
        const bot = makeBot();
        await service.start(bot, ADMIN);
        await service.handleContent(bot, { chat: { id: ADMIN }, text: 'hi' } as any);
        await service.handleCallback(bot, { id: 'q', message: { chat: { id: ADMIN } }, data: 'broadcast:cancel' } as any);
        expect((service as any).drafts.has(ADMIN)).toBe(false);
        expect(bot.answerCallbackQuery).toHaveBeenCalledWith('q');
        expect(bot.sendMessage).toHaveBeenLastCalledWith(ADMIN, expect.stringContaining('скасовано'));
    });

    it('confirm sets sending state and acks start', async () => {
        const { service, userService } = makeService();
        userService.findActiveForBroadcast.mockResolvedValue([]); // empty => run finishes immediately
        const bot = makeBot();
        await service.start(bot, ADMIN);
        await service.handleContent(bot, { chat: { id: ADMIN }, text: 'hi' } as any);
        await service.handleCallback(bot, { id: 'q', message: { chat: { id: ADMIN } }, data: 'broadcast:confirm' } as any);
        expect(bot.sendMessage).toHaveBeenCalledWith(ADMIN, expect.stringContaining('Розсилку почато'));
    });

    it('a second confirm while sending is ignored', async () => {
        const { service } = makeService();
        const bot = makeBot();
        (service as any).drafts.set(ADMIN, { state: 'sending', createdAt: Date.now(), timeout: setTimeout(() => {}, 0) });
        await service.handleCallback(bot, { id: 'q', message: { chat: { id: ADMIN } }, data: 'broadcast:confirm' } as any);
        expect(bot.sendMessage).not.toHaveBeenCalledWith(ADMIN, expect.stringContaining('Розсилку почато'));
    });

    it('start while sending tells admin to wait', async () => {
        const { service } = makeService();
        const bot = makeBot();
        (service as any).drafts.set(ADMIN, { state: 'sending', createdAt: Date.now(), timeout: setTimeout(() => {}, 0) });
        await service.start(bot, ADMIN);
        expect(bot.sendMessage).toHaveBeenCalledWith(ADMIN, expect.stringContaining('вже виконується'));
    });

    it('cancelPending drops a non-sending draft', () => {
        const { service } = makeService();
        const bot = makeBot();
        (service as any).drafts.set(ADMIN, { state: 'awaiting_content', createdAt: Date.now(), timeout: setTimeout(() => {}, 0) });
        service.cancelPending(bot, ADMIN);
        expect((service as any).drafts.has(ADMIN)).toBe(false);
        expect(bot.sendMessage).toHaveBeenCalledWith(ADMIN, expect.stringContaining('скасовано'));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- broadcast.service`
Expected: FAIL — `service.handleCallback is not a function`.

- [ ] **Step 3: Implement `handleCallback` and `cancelPending`**

Add these methods to `BroadcastService` (after `handleContent`):

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- broadcast.service`
Expected: PASS (all broadcast tests).

- [ ] **Step 5: Commit**

```bash
git add src/telegram/broadcast/broadcast.service.ts src/telegram/broadcast/broadcast.service.spec.ts
git commit -m "feat: broadcast confirm/cancel handling and draft guards"
```

---

### Task 7: Wire everything into `TelegramService` + fix the telegram spec

**Files:**
- Modify: `src/telegram/telegram.module.ts` (register `BroadcastService`)
- Modify: `src/telegram/telegram.service.ts` (inject `BroadcastService`; app button in keyboard/menu/start/help; `/broadcast` command; delegation; callback routing; guarded `isBlocked` reset)
- Modify: `src/telegram/telegram.service.spec.ts` (provide mocked deps so it compiles/passes)

**Interfaces:**
- Consumes: `BroadcastService` (Tasks 4-6), `appButton` (Task 1), `UserService.resetBlockedIfFlagged` (Task 3), `adminChatId` (Task 2).
- Produces: fully wired bot behavior.

- [ ] **Step 1: Register `BroadcastService` in the telegram module**

In `src/telegram/telegram.module.ts`, add the import:

```typescript
import { BroadcastService } from './broadcast/broadcast.service';
```

Add `BroadcastService` to the `providers` array (after `FoodPreferenceService`).

- [ ] **Step 2: Inject `BroadcastService` and import `appButton` in `TelegramService`**

In `src/telegram/telegram.service.ts`, add the imports:

```typescript
import { BroadcastService } from './broadcast/broadcast.service';
import { appButton } from 'src/utils/appButton';
```

Add a constructor parameter (after `foodInput`):

```typescript
        private broadcast: BroadcastService,
```

- [ ] **Step 3: Add the app button to the reply keyboard**

Change `mainKeyboard` (lines 20-24) to add a second row:

```typescript
    private mainKeyboard: TelegramBot.ReplyKeyboardMarkup = {
        keyboard: [[{ text: '📋 Меню' }, { text: 'ℹ️ Допомога' }], [{ text: '🥗 Застосунок' }]],
        resize_keyboard: true,
        one_time_keyboard: false,
    };
```

- [ ] **Step 4: Register the `/broadcast` command (raw, admin-only inside the service)**

Inside `onModuleInit`, after the existing `commandHandler(/\/feedback/, ...)` block, add a raw handler (NOT via `commandHandler`, so it does not pre-cancel its own draft). Note: do NOT add `/broadcast` to `setMyCommands` — it stays hidden from regular users:

```typescript
        this.bot.onText(/\/broadcast/, (msg) => this.broadcast.start(this.bot, msg.chat.id));
```

- [ ] **Step 5: Make other commands cancel a pending broadcast draft**

In the `commandHandler` helper (lines 55-60), add a `cancelPending` call so any standard command drops a half-built draft:

```typescript
        const commandHandler = (regex: RegExp, handler: (msg: TelegramBot.Message) => void) => {
            this.bot.onText(regex, (msg) => {
                this.clearUserState(msg.chat.id);
                this.broadcast.cancelPending(this.bot, msg.chat.id);
                handler(msg);
            });
        };
```

- [ ] **Step 6: Delegate content + reset isBlocked at the top of the `message` handler**

At the very start of the `this.bot.on('message', async (msg) => { ... })` callback (right after `const chatId = msg.chat.id;` and `const text = msg.text?.trim();` and `const state = this.userStates.get(chatId);`), add:

```typescript
            void this.userService.resetBlockedIfFlagged(chatId);

            const isCommand = !!msg.text?.startsWith('/');
            if (!isCommand && this.broadcast.isAwaitingContent(chatId)) {
                return this.broadcast.handleContent(this.bot, msg);
            }
```

- [ ] **Step 7: Add the `🥗 Застосунок` keyboard-button response**

In the same `message` handler, next to the other keyboard-button checks (after the `ℹ️ Допомога` block), add:

```typescript
            if (text === '🥗 Застосунок') {
                return this.bot.sendMessage(
                    chatId,
                    '🥗 Новий застосунок Nutriday: меню на тиждень, заміна страв, список покупок, підрахунок БЖВ.',
                    { reply_markup: appButton('cta') },
                );
            }
```

- [ ] **Step 8: Attach the app button under every generated menu**

In `sendMenu`, update the `editMessageText` call (lines 296-299) to include the button:

```typescript
            this.bot.editMessageText(`Ваше меню на день:\n${mealPlan}`, {
                chat_id: chatId,
                message_id: loading.message_id,
                reply_markup: appButton('cta'),
            });
```

- [ ] **Step 9: Add the app button to help and to /start (returning user)**

Replace the `ℹ️ Допомога` handler so it sends help (with the reply keyboard) then a follow-up message with the inline app button:

```typescript
            if (text === 'ℹ️ Допомога') {
                await this.bot.sendMessage(
                    chatId,
                    `📊 Врахування калорійності❗— це ключ🔧 до ефективного схуднення або набору ваги.

🥗 Меню складається з урахуванням принципів:
✅ Здорового 🧠 харчування  
✅ Балансу макроелементів  
✅ Рекомендацій МОЗ України 🇺🇦

💡 Хочете улюблену страву в меню?
➕ Додате її назву до списку *улюблених продуктів* через команду /add\\_favorite

🚫 Не хочете бачити певні страви?
➖ Вкажіть їх у списку *небажаних продуктів* через /del\\_food

📌 *Доступні команди:*
_Перевірити свої дані_ /start
_Змінити дані_ /edit
_Отримати нове меню_ /menu
_Додати улюблені продукти / страви в меню_ /add\\_favorite
_Виключити продукти / страви з меню_  /del\\_food
Відгук або побажання /feedback
`,
                    { parse_mode: 'Markdown', reply_markup: this.mainKeyboard },
                );
                return this.bot.sendMessage(chatId, '🥗 Більше можливостей у застосунку Nutriday:', {
                    reply_markup: appButton('cta'),
                });
            }
```

In the `/start` handler's **existing-user** branch (the `else` at lines 93-106), after the `setTimeout(... 'Оберіть дію нижче:' ...)` block, add a follow-up app-button message:

```typescript
                setTimeout(
                    () =>
                        this.bot.sendMessage(chatId, '🥗 Спробуйте застосунок Nutriday:', {
                            reply_markup: appButton('cta'),
                        }),
                    1500,
                );
```

- [ ] **Step 10: Route broadcast callbacks in the `callback_query` handler**

At the start of the `this.bot.on('callback_query', async (query) => { ... })` callback (after `const chatId = query.message.chat.id;` and `const data = query.data;`), add:

```typescript
            void this.userService.resetBlockedIfFlagged(chatId);

            if (data === 'broadcast:confirm' || data === 'broadcast:cancel') {
                return this.broadcast.handleCallback(this.bot, query);
            }
```

- [ ] **Step 11: Fix `telegram.service.spec.ts` so DI resolves**

Replace the whole file with a version that provides mocks for every dependency:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { UserService } from 'src/user/user.service';
import { OpenAIService } from 'src/openai/openai.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { ConfirmationService } from './confirmation/confirmation.service';
import { FoodPreferenceService } from './food/food-preference.service';
import { FoodInputService } from './food/food-input.service';
import { BroadcastService } from './broadcast/broadcast.service';

describe('TelegramService', () => {
    let service: TelegramService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TelegramService,
                { provide: ConfigService, useValue: { get: () => undefined } },
                { provide: UserService, useValue: {} },
                { provide: OpenAIService, useValue: {} },
                { provide: OnboardingService, useValue: {} },
                { provide: ConfirmationService, useValue: {} },
                { provide: FoodPreferenceService, useValue: {} },
                { provide: FoodInputService, useValue: {} },
                { provide: BroadcastService, useValue: {} },
            ],
        }).compile();

        service = module.get<TelegramService>(TelegramService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
```

- [ ] **Step 12: Run the full test suite and build**

Run: `npm test`
Expected: PASS — all suites (appButton, user.service, broadcast.service, telegram.service).

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 13: Commit**

```bash
git add src/telegram/telegram.module.ts src/telegram/telegram.service.ts src/telegram/telegram.service.spec.ts
git commit -m "feat: wire app button touchpoints and /broadcast command into the bot"
```

---

## Manual Verification (after Task 7)

Run the bot locally (`npm run start:dev`, `NODE_ENV=development` uses polling) and confirm:

1. Reply keyboard shows `🥗 Застосунок`; tapping it sends a promo message with an inline `🥗 Відкрити Nutriday` button opening the CTA URL.
2. `/menu` output has the app button underneath.
3. `/start` (as a returning user) and `ℹ️ Допомога` each show the app button.
4. As the admin (`ADMIN_CHAT_ID`): `/broadcast` → send text → preview + "Надіслати N…" → Confirm → start ack + final report. Repeat with a photo+caption.
5. As a non-admin: `/broadcast` does nothing.
6. Block the bot from a test account that has `amountMenu > 0`, run a broadcast, confirm that account gets marked `isBlocked` and is skipped next run; then `/start` from it and confirm the flag clears.
```
