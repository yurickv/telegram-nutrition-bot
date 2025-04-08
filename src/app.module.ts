import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram/telegram.service';
import { OpenAIService } from './openai/openai.service';
import { DatabaseModule } from './database/database.module';
import { UserModule } from './user/user.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
    imports: [ConfigModule.forRoot(), DatabaseModule, UserModule, TelegramModule],
    providers: [OpenAIService],
})
export class AppModule {}
