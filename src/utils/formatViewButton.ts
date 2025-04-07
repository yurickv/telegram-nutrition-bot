export const padRight = (text: string, totalWidth = 50, paddingLeft = 2, paddingRight = 2) => {
    const paddedText = ' '.repeat(paddingLeft) + text;
    const spaces = Math.max(0, totalWidth - paddedText.length - paddingRight - 1); // 1 for ❌
    return paddedText + '\u00A0'.repeat(spaces) + '❌' + ' '.repeat(paddingRight);
};
