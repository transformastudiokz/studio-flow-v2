import { describe, expect, it } from "vitest";
import { isValidStaffPhone, normalizeStaffPhone } from "./staff-validation";

describe("staff phone validation", () => {
  it("accepts Kazakhstan phone formatting", () => {
    expect(isValidStaffPhone("+7 707 398 10 22")).toBe(true);
  });

  it("normalizes a local leading eight", () => {
    expect(normalizeStaffPhone("8 707 398 10 22")).toBe("77073981022");
  });

  it("rejects incomplete numbers", () => {
    expect(isValidStaffPhone("+7 707 398")).toBe(false);
  });
});
