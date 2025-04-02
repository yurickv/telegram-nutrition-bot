import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram/telegram.service';
import { OpenAIService } from './openai/openai.service';

@Module({
    imports: [ConfigModule.forRoot()], // Додаємо підтримку .env
    providers: [TelegramService, OpenAIService],
})
export class AppModule {}
