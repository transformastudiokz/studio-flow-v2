import { describe, expect, it } from "vitest";
import {
  getClientLoginEmails,
  getClientLoginPhones,
  normalizeClientRegistrationPhone,
} from "@/lib/client-login";

describe("client login phone compatibility", () => {
  it("keeps a legacy 10 digit login and also tries the canonical Kazakhstan number", () => {
    expect(getClientLoginPhones("777 383 8357")).toEqual(["7773838357", "77773838357"]);
    expect(getClientLoginEmails("777 383 8357")).toContain("7773838357@balance.kz");
  });

  it("accepts 11 digit numbers entered with 7 or 8", () => {
    expect(getClientLoginPhones("+7 707 123 45 67")).toEqual(["77071234567", "7071234567"]);
    expect(getClientLoginPhones("8 707 123 45 67")).toEqual(["87071234567", "77071234567", "7071234567"]);
  });

  it("continues to normalize new registrations to 11 digits", () => {
    expect(normalizeClientRegistrationPhone("7071234567")).toBe("77071234567");
  });
});
