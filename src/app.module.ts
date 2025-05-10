import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OpenAIService } from './openai/openai.service';
import { DatabaseModule } from './database/database.module';
import { UserModule } from './user/user.module';
import { TelegramModule } from './telegram/telegram.module';
import { SurveyService } from './services/survey.service';
import { GoogleSheetService } from './services/google-sheet.service';

@Module({
    imports: [ConfigModule.forRoot(), DatabaseModule, UserModule, TelegramModule],
    providers: [OpenAIService, SurveyService, GoogleSheetService],
})
export class AppModule {}
