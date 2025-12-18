import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema()
export class User {
    @Prop({ required: true, unique: true })
    chatId: number;
    @Prop()
    username: string;

    @Prop()
    weight: number;

    @Prop()
    height: number;

    @Prop()
    age: number;

    @Prop()
    sex: boolean;

    @Prop()
    activity: number;

    @Prop()
    goal: string;

    @Prop({ type: [String], default: [] })
    favoriteFoods: string[];

    @Prop({ type: [String], default: [] })
    dislikedFoods: string[];

    @Prop({ default: Date.now })
    firstInit: Date;

    @Prop({ type: Object, default: {} })
    surveyCompleted: { [key: string]: boolean };

    @Prop()
    amountMenu: number;
    @Prop()
    amountMenuToday: number;
    @Prop()
    lastMenuRequest: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
