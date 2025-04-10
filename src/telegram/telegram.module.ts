import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { ConfigModule } from '@nestjs/config';
import { UserModule } from 'src/user/user.module';
import { OpenAIService } from 'src/openai/openai.service';
import { FoodPreferenceService } from './food/food-preference.service';
import { FoodInputService } from './food/food-input.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { ConfirmationService } from './confirmation/confirmation.service';
import { TelegramController } from './telegram.controller';

@Module({
    imports: [ConfigModule, UserModule],
    providers: [
        OpenAIService,
        TelegramService,
        FoodInputService,
        OnboardingService,
        ConfirmationService,
        FoodPreferenceService,
    ],
    controllers: [TelegramController],
    exports: [TelegramService],
})
export class TelegramModule {}
