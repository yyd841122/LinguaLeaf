// The bookmark faces' shared view fact (tickets 10 and 03): the
// planted-at stamp — month-day + hour:minute — reads the same on both
// faces because it is defined once here. Two marks in one chapter (or on
// one page) differ by when, not by where their invisible target sits.
export const formatPlantedAt = (iso: string): string => {
  const t = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${t.getMonth() + 1}-${t.getDate()} ${pad(t.getHours())}:${pad(
    t.getMinutes()
  )}`;
};
