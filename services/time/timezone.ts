const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(date: Date) {
  const values = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return values as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Returns the UTC instant for midnight in the operational Bangladesh timezone. */
export function startOfDhakaDay(date = new Date()) {
  const value = zonedParts(date);
  const guess = Date.UTC(value.year, value.month - 1, value.day);
  const observed = zonedParts(new Date(guess));
  const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
  return new Date(guess - (observedAsUtc - guess));
}

export function startOfDhakaMonth(date = new Date()) {
  const value = zonedParts(date);
  const firstDay = new Date(Date.UTC(value.year, value.month - 1, 1, 0, 0, 0));
  const observed = zonedParts(firstDay);
  const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
  return new Date(firstDay.getTime() - (observedAsUtc - firstDay.getTime()));
}

export function dhakaDateKey(date: Date) {
  const value = zonedParts(date);
  return `${value.year.toString().padStart(4, "0")}-${value.month.toString().padStart(2, "0")}-${value.day.toString().padStart(2, "0")}`;
}
