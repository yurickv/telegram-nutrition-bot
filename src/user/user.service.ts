import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './user.schema';

@Injectable()
export class UserService {
    constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

    async findByChatId(chatId: number): Promise<UserDocument | null> {
        return this.userModel.findOne({ chatId }).exec();
    }

    async createOrUpdateUser(chatId: number, userData: Partial<User>): Promise<UserDocument> {
        return this.userModel
            .findOneAndUpdate({ chatId }, userData, { upsert: true, new: true, setDefaultsOnInsert: true })
            .exec();
    }

    async updateUser(chatId: number, updates: Partial<User>): Promise<UserDocument | null> {
        return this.userModel.findOneAndUpdate({ chatId }, { $set: updates }, { new: true }).exec();
    }

    async addFavoriteFoods(chatId: number, foods: string[]): Promise<UserDocument | null> {
        return this.userModel
            .findOneAndUpdate({ chatId }, { $addToSet: { favoriteFoods: { $each: foods } } }, { new: true })
            .exec();
    }

    async addDislikedFoods(chatId: number, foods: string[]): Promise<UserDocument | null> {
        return this.userModel
            .findOneAndUpdate({ chatId }, { $addToSet: { dislikedFoods: { $each: foods } } }, { new: true })
            .exec();
    }
    async removeFavoriteFood(chatId: number, food: string) {
        await this.userModel.findOneAndUpdate({ chatId }, { $pull: { favoriteFoods: food } }, { new: true }).exec();
    }

    async removeDislikedFood(chatId: number, food: string) {
        await this.userModel.findOneAndUpdate({ chatId }, { $pull: { dislikedFoods: food } }, { new: true }).exec();
    }

    async findAllPaginated(
        page = 1,
        limit = 10,
    ): Promise<{
        data: UserDocument[];
        total: number;
        page: number;
        limit: number;
    }> {
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            this.userModel.find().skip(skip).limit(limit).exec(),
            this.userModel.countDocuments(),
        ]);

        return {
            data,
            total,
            page,
            limit,
        };
    }
    async deleteUser(chatId: number): Promise<{ deleted: boolean }> {
        const result = await this.userModel.deleteOne({ chatId }).exec();
        return { deleted: result.deletedCount === 1 };
    }
}
