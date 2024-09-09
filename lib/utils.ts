export function convertToDynamicType(value: string) {
    // Check for boolean values
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Check for null
    if (value.toLowerCase() === 'null') return null;

    // Try to convert to a number
    const num = Number(value);
    if (!isNaN(num)) return num;

    // If none of the above conversions work, return as string
    try {
        return JSON.parse(value);
    } catch (e) {
        return value
    }
}