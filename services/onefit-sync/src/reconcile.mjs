export function findMissingActiveKeys(activeRows, seenKeys) {
  if (!Array.isArray(activeRows) || !(seenKeys instanceof Set)) {
    throw new Error("OneFit reconciliation input is invalid");
  }
  return activeRows
    .map((row) => row?.external_key)
    .filter((key) => typeof key === "string" && key.length > 0 && !seenKeys.has(key));
}
