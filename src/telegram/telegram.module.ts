// import { Module } from '@nestjs/common';
// import { TelegramService } from './telegram.service';
// import { TelegramController } from './telegram.controller';
// import { ConfigModule } from '@nestjs/config';
// import { OpenAIService } from 'src/openai/openai.service';
// import { UserModule } from 'src/user/user.module';

// @Module({
//     imports: [ConfigModule.forRoot(), UserModule],
//     providers: [TelegramService, OpenAIService],
//     controllers: [TelegramController],
//     exports: [TelegramService],
// })

// export class TelegramModule {}

import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { ConfigModule } from '@nestjs/config';
import { UserModule } from 'src/user/user.module';
import { OpenAIService } from 'src/openai/openai.service';
import { FoodPreferenceService } from './food/food-preference.service';
import { FoodInputService } from './food/food-input.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { ConfirmationService } from './confirmation/confirmation.service';

@Module({
    imports: [ConfigModule, UserModule],
    providers: [
        TelegramService,
        FoodPreferenceService,
        FoodInputService,
        OpenAIService,
        OnboardingService,
        ConfirmationService,
    ],
    exports: [TelegramService],
})
export class TelegramModule {}
