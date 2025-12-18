import * as dotenv from 'dotenv';
import * as mongoose from 'mongoose';
import { User, UserSchema } from '../src/user/user.schema';

// Завантажуємо змінні середовища
dotenv.config();

async function migrateFirstInit() {
    try {
        // Підключаємось до MongoDB
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGO_URI is not defined in .env file');
        }

        console.log('Connecting to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('Connected to MongoDB successfully');

        // Створюємо модель
        const UserModel = mongoose.model('User', UserSchema);

        // Знаходимо всіх користувачів без firstInit
        const usersWithoutFirstInit = await UserModel.find({
            $or: [{ firstInit: { $exists: false } }, { firstInit: null }],
        }).exec();

        console.log(`Found ${usersWithoutFirstInit.length} users without firstInit`);

        if (usersWithoutFirstInit.length === 0) {
            console.log('No users to migrate. Exiting...');
            await mongoose.disconnect();
            return;
        }

        // Оновлюємо кожного користувача
        let updatedCount = 0;
        for (const user of usersWithoutFirstInit) {
            // Витягуємо timestamp з ObjectId
            const createdAt = (user._id as mongoose.Types.ObjectId).getTimestamp();

            await UserModel.updateOne({ _id: user._id }, { $set: { firstInit: createdAt } });

            updatedCount++;

            if (updatedCount % 100 === 0) {
                console.log(`Updated ${updatedCount}/${usersWithoutFirstInit.length} users...`);
            }
        }

        console.log(`\nMigration completed successfully!`);
        console.log(`Total users updated: ${updatedCount}`);

        // Відключаємось від бази
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    } catch (error) {
        console.error('Migration failed:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
}

// Запускаємо міграцію
migrateFirstInit();
