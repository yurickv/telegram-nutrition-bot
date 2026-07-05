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
