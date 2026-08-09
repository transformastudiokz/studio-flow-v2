import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "staff-token" } },
      }),
    },
  },
}));

import { updateBookingStatus } from "./booking-status";
import { supabase } from "@/lib/supabase";

describe("updateBookingStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the shared attendance request and returns the confirmation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ bookingId: "booking-1", subscriptionId: null }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    await expect(updateBookingStatus("booking-1", "absent")).resolves.toEqual({
      bookingId: "booking-1",
      subscriptionId: null,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/schedule", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ action: "set-booking-status", bookingId: "booking-1", status: "absent" }),
    }));
  });

  it("shows the server reason instead of leaving the selector pending", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ error: "Статус записи уже изменился. Обнови окно." }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ));

    await expect(updateBookingStatus("booking-1", "completed"))
      .rejects.toThrow("Статус записи уже изменился. Обнови окно.");
  });

  it("handles a malformed server response as a visible error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

    await expect(updateBookingStatus("booking-1", "absent"))
      .rejects.toThrow("Сервер не подтвердил сохранение статуса");
  });

  it("releases the interface when even session lookup never answers", async () => {
    vi.useFakeTimers();
    vi.mocked(supabase.auth.getSession).mockReturnValueOnce(new Promise(() => undefined));

    const request = updateBookingStatus("booking-1", "absent");
    const expectation = expect(request).rejects.toThrow("Сервер слишком долго сохраняет статус");
    await vi.advanceTimersByTimeAsync(15_000);

    await expectation;
  });
});
