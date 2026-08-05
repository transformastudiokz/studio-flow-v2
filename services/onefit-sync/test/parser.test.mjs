import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOnefitClassName, parseQueuedSnapshot, parseVisitSnapshot } from "../src/parser.mjs";

test("parses complete booking cards", () => {
  const result = parseQueuedSnapshot({ todayVisible: true, declared: 2, cards: [
    ["19:00-20:00", "Здоровая спина", "Шынар Мусина"],
    ["20:00–21:00", "Пилатес", "Айжан Успанова"],
  ] });
  assert.deepEqual(result.map(({ time, className, clientName }) => ({ time, className, clientName })), [
    { time: "19:00", className: "Здоровая спина", clientName: "Шынар Мусина" },
    { time: "20:00", className: "Пилатес", clientName: "Айжан Успанова" },
  ]);
});

test("supports confirmed zero count", () => {
  assert.deepEqual(parseQueuedSnapshot({ todayVisible: true, declared: 0, cards: [] }), []);
});

test("preserves confirmed OneFit status", () => {
  const result = parseVisitSnapshot({ todayVisible: true, declared: 1, cards: [
    ["19:00-20:00", "Здоровая спина", "Шынар Мусина"],
  ] }, "confirmed");
  assert.equal(result[0].status, "confirmed");
});

test("matches harmless punctuation and conjunction differences in class names", () => {
  assert.equal(
    normalizeOnefitClassName("Йога: сила, гибкость, баланс"),
    normalizeOnefitClassName("Йога: сила, гибкость и баланс"),
  );
});

test("matches confirmed OneFit and CRM class aliases", () => {
  const pairs = [
    ["Йога для здоровья позвоночника и спины", "Йога для спины и позвоночника"],
    ["Айенгар йога", "Йога Айенгара"],
    ["Аштанга", "Йога Аштанга"],
    ["Стретчинг", "Растяжка"],
    ["Хатха", "Йога Хатха"],
    ["Хатха-виньяса", "Йога Хатха - Виньяса"],
  ];
  for (const [onefit, crm] of pairs) {
    assert.equal(normalizeOnefitClassName(onefit), normalizeOnefitClassName(crm));
  }
});

test("rejects partial page instead of cancelling data", () => {
  assert.throws(() => parseQueuedSnapshot({ todayVisible: true, declared: 2, cards: [["19:00-20:00", "Йога", "Клиент"]] }), /incomplete/);
});

test("keeps two same-name visitors separate", () => {
  const result = parseQueuedSnapshot({ todayVisible: true, declared: 2, cards: [
    ["19:00-20:00", "Йога", "Алия Ким"], ["19:00-20:00", "Йога", "Алия Ким"],
  ] });
  assert.deepEqual(result.map((row) => row.occurrence), [1, 2]);
});

test("rejects changed card structure", () => {
  assert.throws(() => parseQueuedSnapshot({ todayVisible: true, declared: 1, cards: [["19:00-20:00", "Йога", "Клиент", "лишнее"]] }), /structure changed/);
});
