import { Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { TelegramService } from './telegram.service';

@Controller('bot')
export class TelegramController {
    constructor(private readonly telegramService: TelegramService) {}

    @Post()
    async handleUpdate(@Req() req: Request) {
        await this.telegramService.getBot().processUpdate(req.body);
        return '';
    }
}
