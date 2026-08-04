import { describe, expect, it } from "vitest";
import { formatResponsibleShortName } from "@/lib/person-name";

describe("formatResponsibleShortName", () => {
  it("formats normally stored names as name and surname initial", () => {
    expect(formatResponsibleShortName({ first_name: "Мария", last_name: "Иванова" })).toBe("Мария И.");
  });

  it("repairs imported surname/name/patronymic field order", () => {
    expect(formatResponsibleShortName({ first_name: "Рабаева", last_name: "Аида Ерлановна" })).toBe("Аида Р.");
  });

  it("keeps a single available name", () => {
    expect(formatResponsibleShortName({ first_name: "Admin", last_name: null })).toBe("Admin");
  });
});
