export const normalizeOnefitText = (value) => value
  .toLocaleLowerCase("ru-RU")
  .replace(/ё/g, "е")
  .replace(/[–—-]/g, " ")
  .replace(/[^a-zа-я0-9]+/gi, " ")
  .trim()
  .replace(/\s+/g, " ");

const classAliases = new Map([
  ["йога для здоровья позвоночника спины", "йога для спины позвоночника"],
  ["айенгар йога", "йога айенгара"],
  ["аштанга", "йога аштанга"],
  ["стретчинг", "растяжка"],
  ["хатха", "йога хатха"],
  ["хатха виньяса", "йога хатха виньяса"],
]);

export const normalizeOnefitClassName = (value) => {
  const normalized = normalizeOnefitText(value)
  .split(" ")
  .filter((token) => token && token !== "и")
  .join(" ");
  return classAliases.get(normalized) || normalized;
};

export function parseVisitSnapshot(snapshot, status = "queued") {
  if (!snapshot?.todayVisible || !Number.isInteger(snapshot.declared)) {
    throw new Error("OneFit today section is incomplete");
  }
  if (!Array.isArray(snapshot.cards) || snapshot.cards.length !== snapshot.declared) {
    throw new Error(`OneFit snapshot incomplete: declared ${snapshot.declared}, parsed ${snapshot.cards?.length ?? 0}`);
  }
  const occurrences = new Map();
  return snapshot.cards.map((fields) => {
    if (!Array.isArray(fields) || fields.length !== 3) throw new Error("OneFit booking card structure changed");
    const timeMatch = fields[0].match(/^(\d{2}:\d{2})\s*[-–—]\s*\d{2}:\d{2}$/);
    if (!timeMatch || !fields[1] || !fields[2]) throw new Error("OneFit booking card is incomplete");
    const tuple = [timeMatch[1], normalizeOnefitText(fields[1]), normalizeOnefitText(fields[2])].join("|");
    const occurrence = (occurrences.get(tuple) || 0) + 1;
    occurrences.set(tuple, occurrence);
    return { time: timeMatch[1], className: fields[1], clientName: fields[2], status, occurrence };
  });
}

export const parseQueuedSnapshot = (snapshot) => parseVisitSnapshot(snapshot, "queued");
