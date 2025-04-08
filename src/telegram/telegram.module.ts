import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { ConfigModule } from '@nestjs/config';
import { OpenAIService } from 'src/openai/openai.service';
import { UserModule } from 'src/user/user.module';

@Module({
    imports: [ConfigModule.forRoot(), UserModule],
    providers: [TelegramService, OpenAIService],
    controllers: [TelegramController],
    exports: [TelegramService],
})
export class TelegramModule {}
