import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram/telegram.service';
import { OpenAIService } from './openai/openai.service';
import { DatabaseModule } from './database/database.module';
import { UserModule } from './user/user.module';

@Module({
    imports: [ConfigModule.forRoot(), DatabaseModule, UserModule], // Додаємо підтримку .env
    providers: [TelegramService, OpenAIService],
})
export class AppModule {}
