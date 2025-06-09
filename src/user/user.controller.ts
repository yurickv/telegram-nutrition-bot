import { Controller, Get, Post, Put, Delete, Query, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './user.schema';

@Controller('users')
export class UserController {
    constructor(private readonly userService: UserService) {}

    // 🔍 Отримати всіх користувачів з пагінацією
    @Get()
    async findAll(@Query('page') page = 1, @Query('limit') limit = 10) {
        return this.userService.findAllPaginated(+page, +limit);
    }

    // 🔍 Знайти по chatId
    @Get('chat/:chatId')
    async findByChatId(@Param('chatId') chatId: number) {
        const user = await this.userService.findByChatId(chatId);
        if (!user) {
            throw new HttpException('Користувача не знайдено', HttpStatus.NOT_FOUND);
        }
        return user;
    }

    // ➕ Створити або оновити користувача
    @Post()
    async createOrUpdate(@Body('chatId') chatId: number, @Body() userData: Partial<User>) {
        return this.userService.createOrUpdateUser(chatId, userData);
    }

    // 🔁 Оновити конкретні поля
    @Put(':chatId')
    async updateUser(@Param('chatId') chatId: number, @Body() updates: Partial<User>) {
        const updated = await this.userService.updateUser(chatId, updates);
        if (!updated) {
            throw new HttpException('Користувача не знайдено', HttpStatus.NOT_FOUND);
        }
        return updated;
    }
    @Delete(':chatId')
    async deleteUser(@Param('chatId') chatId: number) {
        const result = await this.userService.deleteUser(chatId);
        if (!result.deleted) {
            throw new HttpException('Користувача не знайдено', HttpStatus.NOT_FOUND);
        }
        return { message: 'Користувача видалено успішно' };
    }

    // 🍎 Додати улюблені страви
    @Put(':chatId/favorite')
    async addFavoriteFoods(@Param('chatId') chatId: number, @Body('foods') foods: string[]) {
        return this.userService.addFavoriteFoods(chatId, foods);
    }

    // 🍎 Видалити улюблену страву
    @Delete(':chatId/favorite')
    async removeFavoriteFood(@Param('chatId') chatId: number, @Query('food') food: string) {
        return this.userService.removeFavoriteFood(chatId, food);
    }

    // 🍋 Додати неулюблені страви
    @Put(':chatId/disliked')
    async addDislikedFoods(@Param('chatId') chatId: number, @Body('foods') foods: string[]) {
        return this.userService.addDislikedFoods(chatId, foods);
    }

    // 🍋 Видалити неулюблену страву
    @Delete(':chatId/disliked')
    async removeDislikedFood(@Param('chatId') chatId: number, @Query('food') food: string) {
        return this.userService.removeDislikedFood(chatId, food);
    }
}
