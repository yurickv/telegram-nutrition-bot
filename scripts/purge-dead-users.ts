/**
 * Разове очищення бази від "мертвих" користувачів.
 *
 * Видаляються:
 *   1. Користувачі без жодного згенерованого меню (amountMenu відсутній, null або 0).
 *   2. Користувачі з меню, яких уже позначено isBlocked: true.
 *   3. Користувачі з меню, які заблокували бота, але ще не позначені.
 *      Виявляються через sendChatAction('typing'): заблоковані повертають 403,
 *      живі користувачі нічого не отримують.
 *
 * Адмін (ADMIN_CHAT_ID) ніколи не видаляється.
 *
 * Запуск:
 *   npm run purge:dead               — dry-run, лише звіт
 *   npm run purge:dead -- --apply    — записує бекап у backups/ і видаляє
 *   npm run purge:dead -- --no-probe — без перевірки через Telegram (лише 1 і 2)
 *   npm run purge:dead -- --recent-days=N — не чіпати новачків без меню молодших за N днів (за замовчуванням 7)
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as mongoose from 'mongoose';
import TelegramBot = require('node-telegram-bot-api');
import { UserSchema } from '../src/user/user.schema';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const PROBE = !process.argv.includes('--no-probe');
const PROBE_DELAY_MS = 40;
const recentArg = process.argv.find((a) => a.startsWith('--recent-days='));
const RECENT_DAYS = recentArg ? Number(recentArg.split('=')[1]) : 7;

type Reason = 'no_menu' | 'flagged_blocked' | 'probed_blocked';

interface Candidate {
    _id: mongoose.Types.ObjectId;
    chatId: number;
    username?: string;
    reason: Reason;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tgError(err: unknown): { code?: number; description?: string; retryAfter?: number } {
    const body = (err as any)?.response?.body;
    return {
        code: body?.error_code,
        description: body?.description,
        retryAfter: body?.parameters?.retry_after,
    };
}

function isBlockedError(err: unknown): boolean {
    const { code, description } = tgError(err);
    if (code === 403) return true;
    return code === 400 && /chat not found/i.test(description ?? '');
}

async function probeBlocked(bot: TelegramBot, chatId: number): Promise<'alive' | 'blocked' | 'error'> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await bot.sendChatAction(chatId, 'typing');
            return 'alive';
        } catch (err) {
            if (isBlockedError(err)) return 'blocked';
            const { code, retryAfter } = tgError(err);
            if (code === 429 && attempt === 0) {
                await sleep((retryAfter ?? 1) * 1000);
                continue;
            }
            console.error(`  probe error for ${chatId}:`, tgError(err));
            return 'error';
        }
    }
    return 'error';
}

async function main() {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) throw new Error('MONGO_URI is not defined');
    const adminChatId = Number(process.env.ADMIN_CHAT_ID);
    if (!adminChatId) throw new Error('ADMIN_CHAT_ID is not defined');

    console.log(`Mode: ${APPLY ? 'APPLY (буде видалено)' : 'DRY-RUN (лише звіт)'}; probe: ${PROBE ? 'on' : 'off'}`);
    await mongoose.connect(mongoUri);
    const UserModel = mongoose.model('User', UserSchema);

    const total = await UserModel.countDocuments();
    const notAdmin = { chatId: { $ne: adminChatId } };
    const candidates: Candidate[] = [];

    // 1. Без жодного меню (крім новачків, які ще можуть бути посеред онбордингу)
    const recentCutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const noMenuFilter = {
        ...notAdmin,
        $or: [{ amountMenu: { $exists: false } }, { amountMenu: null }, { amountMenu: { $lte: 0 } }],
    };
    const noMenu = await UserModel.find(noMenuFilter, { chatId: 1, username: 1, firstInit: 1 }).lean();
    let recentSkipped = 0;
    for (const u of noMenu) {
        if (RECENT_DAYS > 0 && u.firstInit && new Date(u.firstInit) >= recentCutoff) {
            recentSkipped++;
            continue;
        }
        candidates.push({ _id: u._id, chatId: u.chatId, username: u.username, reason: 'no_menu' });
    }

    // 2. З меню, вже позначені як заблоковані
    const flagged = await UserModel.find(
        { ...notAdmin, amountMenu: { $gt: 0 }, isBlocked: true },
        { chatId: 1, username: 1 },
    ).lean();
    for (const u of flagged)
        candidates.push({ _id: u._id, chatId: u.chatId, username: u.username, reason: 'flagged_blocked' });

    // 3. З меню, не позначені: перевіряємо через Telegram
    let probed = 0;
    let probeErrors = 0;
    if (PROBE) {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not defined (або запустіть з --no-probe)');
        const bot = new TelegramBot(token);
        const toProbe = await UserModel.find(
            { ...notAdmin, amountMenu: { $gt: 0 }, isBlocked: { $ne: true } },
            { chatId: 1, username: 1 },
        ).lean();
        console.log(`Перевіряю ${toProbe.length} користувачів через sendChatAction...`);
        for (const u of toProbe) {
            const status = await probeBlocked(bot, u.chatId);
            probed++;
            if (status === 'blocked')
                candidates.push({ _id: u._id, chatId: u.chatId, username: u.username, reason: 'probed_blocked' });
            if (status === 'error') probeErrors++;
            if (probed % 100 === 0) console.log(`  ${probed}/${toProbe.length}`);
            await sleep(PROBE_DELAY_MS);
        }
    }

    const count = (r: Reason) => candidates.filter((c) => c.reason === r).length;
    console.log('\n===== Звіт =====');
    console.log(`Всього в базі:                  ${total}`);
    console.log(`Без жодного меню:               ${count('no_menu')}`);
    console.log(`Новачки без меню (< ${RECENT_DAYS} дн., лишаємо): ${recentSkipped}`);
    console.log(`З меню, позначені isBlocked:    ${count('flagged_blocked')}`);
    console.log(`З меню, заблокували (probe):    ${count('probed_blocked')}`);
    console.log(`Помилок перевірки (не чіпаємо): ${probeErrors}`);
    console.log(`До видалення:                   ${candidates.length}`);
    console.log(`Залишиться:                     ${total - candidates.length}`);

    if (!APPLY) {
        console.log('\nDry-run. Для видалення запустіть з --apply.');
        await mongoose.disconnect();
        return;
    }

    if (candidates.length === 0) {
        console.log('\nНема кого видаляти.');
        await mongoose.disconnect();
        return;
    }

    // Бекап повних документів перед видаленням
    const ids = candidates.map((c) => c._id);
    const docs = await UserModel.find({ _id: { $in: ids } }).lean();
    const reasonById = new Map(candidates.map((c) => [String(c._id), c.reason]));
    const backupDir = path.resolve(__dirname, '..', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `purge-dead-users-${stamp}.json`);
    fs.writeFileSync(
        backupFile,
        JSON.stringify(
            docs.map((d) => ({ ...d, _purgeReason: reasonById.get(String(d._id)) })),
            null,
            2,
        ),
    );
    console.log(`\nБекап записано: ${backupFile} (${docs.length} документів)`);

    const result = await UserModel.deleteMany({ _id: { $in: ids }, chatId: { $ne: adminChatId } });
    console.log(`Видалено: ${result.deletedCount}`);
    console.log(`Залишилось у базі: ${await UserModel.countDocuments()}`);

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Purge failed:', err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
