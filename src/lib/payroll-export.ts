import type { PayrollAnalytics } from "@/lib/payroll-analytics";

export const exportPayrollAnalyticsToExcel = async ({
  analytics,
  periodLabel,
  filenamePeriod,
}: {
  analytics: PayrollAnalytics;
  periodLabel: string;
  filenamePeriod: string;
}) => {
  const xlsxModule = await import("xlsx-js-style");
  const XLSX = "utils" in xlsxModule
    ? xlsxModule
    : (xlsxModule as unknown as { default: typeof xlsxModule }).default;

  const rows: Array<Array<string | number>> = [
    [`АНАЛИТИКА ПРЕПОДАВАТЕЛЕЙ · ${periodLabel.toLocaleUpperCase("ru-RU")}`],
    ["Показатели накопительным итогом за выбранный период"],
    [
      "Место",
      "Имя и фамилия",
      "Проведено занятий",
      "Посещения всего",
      "По абонементам (CRM)",
      "OneFit",
      "Новые пробные (★)",
      "Купили после занятия",
      "Среднее на занятие",
      "Конверсия",
      "К выплате",
    ],
    ...analytics.rows.map((row, index) => [
      index + 1,
      row.name,
      row.sessionCount,
      row.totalVisits,
      row.crmVisits,
      row.onefitVisits,
      row.trialStars,
      row.purchasesAfterTrial,
      row.averageVisits,
      row.conversionRate / 100,
      row.payment,
    ]),
    [
      "",
      "ИТОГО",
      analytics.totals.sessionCount,
      analytics.totals.totalVisits,
      analytics.totals.crmVisits,
      analytics.totals.onefitVisits,
      analytics.totals.trialStars,
      analytics.totals.purchasesAfterTrial,
      analytics.totals.averageVisits,
      analytics.totals.conversionRate / 100,
      analytics.totals.payment,
    ],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
  ];
  worksheet["!cols"] = [
    { wch: 8 }, { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 21 }, { wch: 12 },
    { wch: 19 }, { wch: 22 }, { wch: 19 }, { wch: 13 }, { wch: 16 },
  ];
  worksheet["!rows"] = [{ hpt: 28 }, { hpt: 18 }, { hpt: 34 }, ...analytics.rows.map(() => ({ hpt: 24 })), { hpt: 26 }];
  worksheet["!margins"] = { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0, footer: 0 };
  (worksheet as typeof worksheet & { "!pageSetup"?: Record<string, unknown> })["!pageSetup"] = {
    orientation: "landscape",
    paperSize: 9,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  const thinBorder = {
    top: { style: "thin", color: { rgb: "D8DDD8" } },
    bottom: { style: "thin", color: { rgb: "D8DDD8" } },
    left: { style: "thin", color: { rgb: "D8DDD8" } },
    right: { style: "thin", color: { rgb: "D8DDD8" } },
  };
  const lastRow = rows.length - 1;
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < 11; column += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (!cell) continue;
      if (row === 0) {
        cell.s = { font: { bold: true, sz: 15, color: { rgb: "294B3D" } }, alignment: { horizontal: "center", vertical: "center" } };
      } else if (row === 1) {
        cell.s = { font: { italic: true, sz: 9, color: { rgb: "6B726E" } }, alignment: { horizontal: "center", vertical: "center" } };
      } else if (row === 2) {
        cell.s = { font: { bold: true, sz: 9, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "527866" } }, border: thinBorder, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
      } else {
        const total = row === lastRow;
        const topThree = row >= 3 && row <= 5;
        cell.s = {
          font: { bold: total || (topThree && column <= 1), sz: 9, color: { rgb: "222824" } },
          fill: { fgColor: { rgb: total ? "E5ECE7" : topThree ? "FBF7E8" : "FFFFFF" } },
          border: thinBorder,
          alignment: { horizontal: column === 1 ? "left" : "center", vertical: "center", wrapText: true },
        };
        if (column === 8) cell.z = "0.0";
        if (column === 9) cell.z = "0%";
        if (column === 10) cell.z = '#,##0 "₸"';
      }
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Преподаватели");
  XLSX.writeFile(workbook, `Расчёт_преподавателей_${filenamePeriod}.xlsx`, { bookType: "xlsx", compression: true });
};
