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
