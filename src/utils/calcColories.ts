interface CaloriesProps {
    weight: number;
    height: number;
    age: number;
    sex: boolean;
    activity: number;
    goal: string;
}

export function calculateCalories({ weight, height, age, sex, activity, goal }: CaloriesProps): number {
    const baseCalories = 10 * weight + 6.25 * height - 5 * age + (sex ? 5 : -161);
    let dailyCalories = baseCalories * activity;

    if (goal === 'lose_weight') dailyCalories *= 0.85; // Мінус 15% для схуднення
    if (goal === 'gain_weight') dailyCalories *= 1.15; // Плюс 15% для набору ваги

    return Math.round(dailyCalories);
}
