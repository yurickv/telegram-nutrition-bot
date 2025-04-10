import { User } from 'src/user/user.schema';

export function isUserDataValid(user: User): boolean {
    return (
        user &&
        typeof user.weight === 'number' &&
        user.weight >= 40 &&
        user.weight <= 150 &&
        typeof user.height === 'number' &&
        user.height >= 100 &&
        user.height <= 220 &&
        typeof user.age === 'number' &&
        user.age >= 14 &&
        user.age <= 130
    );
}
