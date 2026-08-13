export type CashLedgerRow = {
  id: string;
  operation_type: string;
  notes?: string | null;
  related_transaction_id?: string | null;
};

const CORRECTION_REVERSAL_PREFIX = "сторно перед корректировкой:";

export function isTechnicalCorrectionReversal(row: CashLedgerRow) {
  return row.operation_type === "rental_refund"
    && Boolean(row.related_transaction_id)
    && (row.notes || "").trim().toLocaleLowerCase("ru-RU").startsWith(CORRECTION_REVERSAL_PREFIX);
}

/**
 * The immutable ledger keeps an original payment and a reversing entry when a
 * payment is corrected. Neither is a real cash movement for the operational
 * report; the replacement payment is the only row that should be shown there.
 */
export function excludeTechnicalCorrectionPairs<T extends CashLedgerRow>(
  rows: T[],
  knownCorrectionReversals: CashLedgerRow[] = rows,
) {
  const hiddenIds = new Set<string>();

  knownCorrectionReversals.forEach((row) => {
    if (!isTechnicalCorrectionReversal(row)) return;
    hiddenIds.add(row.id);
    if (row.related_transaction_id) hiddenIds.add(row.related_transaction_id);
  });

  return rows.filter((row) => !hiddenIds.has(row.id));
}
