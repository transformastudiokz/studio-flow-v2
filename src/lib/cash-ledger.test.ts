import { describe, expect, it } from "vitest";
import { excludeTechnicalCorrectionPairs, isTechnicalCorrectionReversal } from "./cash-ledger";

describe("operational cash ledger", () => {
  const original = { id: "original", operation_type: "rental_payment", notes: null, related_transaction_id: null };
  const technicalReversal = { id: "reversal", operation_type: "rental_refund", notes: "Сторно перед корректировкой: дата оплаты", related_transaction_id: "original" };
  const replacement = { id: "replacement", operation_type: "rental_payment", notes: "Корректировка: дата оплаты", related_transaction_id: null };

  it("hides the original payment and its technical reversal", () => {
    expect(excludeTechnicalCorrectionPairs([original, technicalReversal, replacement])).toEqual([replacement]);
  });

  it("hides a superseded original even when the reversal is outside the selected period", () => {
    expect(excludeTechnicalCorrectionPairs([original], [technicalReversal])).toEqual([]);
  });

  it("keeps a genuine client refund", () => {
    const refund = { id: "refund", operation_type: "rental_refund", notes: "Клиент отменил аренду", related_transaction_id: "original" };
    expect(isTechnicalCorrectionReversal(refund)).toBe(false);
    expect(excludeTechnicalCorrectionPairs([original, refund], [refund])).toEqual([original, refund]);
  });
});
