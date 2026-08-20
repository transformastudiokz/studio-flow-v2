import { formatCoachShortName, normalizeRoom, type ScheduleSession } from "@/lib/schedule";

const ALMATY_TIME_ZONE = "Asia/Almaty";
const WEEKDAYS = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const EXCLUDED_CLASS_PATTERN = /индивидуал/i;
const WORKSHOP_PATTERN = /мастер[\s-]*класс/i;
const YOGA_PATTERN = /йог|хатх|виньяс|аштанг|fly yoga/i;

type AlmatyParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  dateKey: string;
};

const almatyParts = (value: string | Date): AlmatyParts => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ALMATY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(item.year);
  const month = Number(item.month);
  const day = Number(item.day);
  return {
    year,
    month,
    day,
    hour: Number(item.hour),
    minute: Number(item.minute),
    weekday: item.weekday,
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
};

const timeLabel = (value: string) => {
  const parts = almatyParts(value);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
};

export const isGroupSessionForExport = (session: ScheduleSession) => {
  const name = session.class_type?.name || "";
  return !EXCLUDED_CLASS_PATTERN.test(name);
};

const isCancelledSession = (session: ScheduleSession) =>
  session.is_cancelled === true || session.booking_status === "cancelled";

export const formatSessionTextForExport = (session: ScheduleSession) => {
  const coach = formatCoachShortName(session.coach?.name);
  const labels = [
    ...(isCancelledSession(session) ? ["ОТМЕНЕНО"] : session.booking_status === "closed" ? ["ЗАПИСЬ ЗАКРЫТА"] : []),
    ...(WORKSHOP_PATTERN.test(session.class_type?.name || "") ? ["МАСТЕР-КЛАСС"] : []),
  ];
  return [
    ...labels,
    `${timeLabel(session.start_time)}–${timeLabel(session.end_time)}`,
    session.class_type?.name || "Занятие",
    `${coach} · ${normalizeRoom(session.room)}`,
  ].join("\n");
};

export type ScheduleExportModel = {
  title: string;
  subtitle: string;
  filename: string;
  dayKeys: string[];
  dayLabels: string[];
  hours: number[];
  cells: Map<string, ScheduleSession[]>;
};

export const buildScheduleExportModel = (
  sessions: ScheduleSession[],
  weekStart: Date,
  weekEnd: Date,
): ScheduleExportModel => {
  const groupSessions = sessions.filter(isGroupSessionForExport).sort((left, right) =>
    new Date(left.start_time).getTime() - new Date(right.start_time).getTime());

  const dayDates = Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * 86_400_000));
  const dayParts = dayDates.map(almatyParts);
  const dayKeys = dayParts.map((parts) => parts.dateKey);
  const dayLabels = dayParts.map((parts) => `${WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()]} ${String(parts.day).padStart(2, "0")}.${String(parts.month).padStart(2, "0")}`);
  const hours = [...new Set(groupSessions.map((session) => almatyParts(session.start_time).hour))].sort((a, b) => a - b);
  const cells = new Map<string, ScheduleSession[]>();

  for (const session of groupSessions) {
    const start = almatyParts(session.start_time);
    const key = `${start.dateKey}:${start.hour}`;
    cells.set(key, [...(cells.get(key) || []), session]);
  }

  const start = almatyParts(weekStart);
  const end = almatyParts(weekEnd);
  const sameMonth = start.month === end.month && start.year === end.year;
  const titleRange = sameMonth
    ? `${start.day}–${end.day} ${MONTHS_GENITIVE[start.month - 1]} ${start.year}`
    : `${start.day} ${MONTHS_GENITIVE[start.month - 1]} — ${end.day} ${MONTHS_GENITIVE[end.month - 1]} ${end.year}`;
  const fileDate = (parts: AlmatyParts) => `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;

  return {
    title: `РАСПИСАНИЕ BALANCE STUDIO · ${titleRange.toLocaleUpperCase("ru-RU")}`,
    subtitle: "Расписание студии · без индивидуальных занятий · время Казахстана",
    filename: `Расписание_Balance_Studio_${fileDate(start)}_${fileDate(end)}.xlsx`,
    dayKeys,
    dayLabels,
    hours,
    cells,
  };
};

const thinBorder = {
  top: { style: "thin", color: { rgb: "B8B8B2" } },
  bottom: { style: "thin", color: { rgb: "B8B8B2" } },
  left: { style: "thin", color: { rgb: "B8B8B2" } },
  right: { style: "thin", color: { rgb: "B8B8B2" } },
};

export const exportScheduleWeekToExcel = async (
  sessions: ScheduleSession[],
  weekStart: Date,
  weekEnd: Date,
) => {
  const xlsxModule = await import("xlsx-js-style");
  const XLSX = "utils" in xlsxModule
    ? xlsxModule
    : (xlsxModule as unknown as { default: typeof xlsxModule }).default;
  const model = buildScheduleExportModel(sessions, weekStart, weekEnd);
  if (model.hours.length === 0) throw new Error("На этой неделе нет групповых занятий для выгрузки");

  const rows: string[][] = [
    [model.title, "", "", "", "", "", "", ""],
    [model.subtitle, "", "", "", "", "", "", ""],
    ["ВРЕМЯ", ...model.dayLabels],
  ];

  for (const hour of model.hours) {
    rows.push([
      `${String(hour).padStart(2, "0")}:00`,
      ...model.dayKeys.map((dayKey) => (model.cells.get(`${dayKey}:${hour}`) || []).map(formatSessionTextForExport).join("\n────────\n")),
    ]);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
  ];
  worksheet["!cols"] = [{ wch: 8 }, ...Array.from({ length: 7 }, () => ({ wch: 28.5 }))];
  worksheet["!rows"] = [
    { hpt: 28 },
    { hpt: 17 },
    { hpt: 25 },
    ...model.hours.map((hour) => {
      const maximumLines = Math.max(0, ...model.dayKeys.map((key) => {
        const items = model.cells.get(`${key}:${hour}`) || [];
        return items.reduce((total, item, index) => total + formatSessionTextForExport(item).split("\n").length + (index > 0 ? 1 : 0), 0);
      }));
      return { hpt: Math.max(58, maximumLines * 12 + 12) };
    }),
  ];
  worksheet["!margins"] = { left: 0.1, right: 0.1, top: 0.15, bottom: 0.15, header: 0, footer: 0 };
  (worksheet as typeof worksheet & { "!pageSetup"?: Record<string, unknown>; "!printArea"?: string })["!pageSetup"] = {
    orientation: "landscape",
    paperSize: 9,
    fitToWidth: 1,
    fitToHeight: 1,
  };
  (worksheet as typeof worksheet & { "!printArea"?: string })["!printArea"] = `A1:H${rows.length}`;

  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = worksheet[address];
      if (!cell) continue;
      if (row === 0) {
        cell.s = { font: { bold: true, sz: 15, color: { rgb: "294B3D" } }, alignment: { horizontal: "center", vertical: "center" } };
      } else if (row === 1) {
        cell.s = { font: { italic: true, sz: 9, color: { rgb: "666666" } }, alignment: { horizontal: "center", vertical: "center" } };
      } else if (row === 2) {
        cell.s = { font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "527866" } }, border: thinBorder, alignment: { horizontal: "center", vertical: "center" } };
      } else if (column === 0) {
        cell.s = { font: { bold: true, sz: 10, color: { rgb: "294B3D" } }, fill: { fgColor: { rgb: "ECEDE8" } }, border: thinBorder, alignment: { horizontal: "center", vertical: "top" } };
      } else {
        const cellSessions = model.cells.get(`${model.dayKeys[column - 1]}:${model.hours[row - 3]}`) || [];
        const sessionNames = cellSessions.map((session) => session.class_type?.name || "");
        const yogaOnly = sessionNames.length > 0 && sessionNames.every((name) => YOGA_PATTERN.test(name));
        const hasWorkshop = sessionNames.some((name) => WORKSHOP_PATTERN.test(name));
        const cancelledOnly = cellSessions.length > 0 && cellSessions.every(isCancelledSession);
        cell.s = {
          font: { bold: hasWorkshop, sz: 9, color: { rgb: cancelledOnly ? "6A6A6A" : "222222" } },
          fill: { fgColor: { rgb: hasWorkshop ? "D1D2CD" : cancelledOnly ? "EEEEEA" : yogaOnly ? "E4E5E1" : "FFFFFF" } },
          border: thinBorder,
          alignment: { horizontal: "left", vertical: "top", wrapText: true },
        };
      }
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Расписание");
  workbook.Workbook = { Views: [{ RTL: false }] };
  XLSX.writeFile(workbook, model.filename, { bookType: "xlsx", compression: true });
};
