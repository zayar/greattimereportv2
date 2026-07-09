export function isBirthdayCustomerQuestion(message: string): boolean {
  return (
    /\bbirthdays?\b/i.test(message) ||
    /\bbirthday\s+customers?\b/i.test(message) ||
    /\bupcoming\s+birthdays?\b/i.test(message) ||
    /\bwhose\s+birthday\b/i.test(message) ||
    /မွေးနေ့/i.test(message) ||
    /birthday\s*customers?/i.test(message) ||
    /ဒီ\s*လ[\s\S]{0,60}birthday/i.test(message) ||
    /နောက်\s*(?:30|60|90)\s*ရက်[\s\S]{0,60}birthday/i.test(message) ||
    /birthday[\s\S]{0,60}တွေ/i.test(message)
  );
}

export function extractBirthdayWindowDays(message: string): 30 | 60 | 90 | null {
  if (/(?:next|in|within)\s*90\s*days?|90\s*days?|နောက်\s*90\s*ရက်|ရက်\s*90/i.test(message)) {
    return 90;
  }
  if (/(?:next|in|within)\s*60\s*days?|60\s*days?|နောက်\s*60\s*ရက်|ရက်\s*60/i.test(message)) {
    return 60;
  }
  if (/(?:next|in|within)\s*30\s*days?|30\s*days?|နောက်\s*30\s*ရက်|ရက်\s*30/i.test(message)) {
    return 30;
  }

  return null;
}
