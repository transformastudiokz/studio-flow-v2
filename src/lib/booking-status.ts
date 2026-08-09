import { supabase } from "@/lib/supabase";

const STATUS_UPDATE_TIMEOUT_MS = 15_000;

export async function updateBookingStatus(bookingId: string, status: string) {
  const controller = new AbortController();
  let rejectOnTimeout: (reason: Error) => void = () => undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectOnTimeout = reject;
  });
  const timeout = window.setTimeout(() => {
    controller.abort();
    rejectOnTimeout(new DOMException("Status update timed out", "AbortError"));
  }, STATUS_UPDATE_TIMEOUT_MS);

  try {
    return await Promise.race([
      (async () => {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
          body: JSON.stringify({ action: "set-booking-status", bookingId, status }),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || "Не удалось сохранить статус посещения");
        if (!result) throw new Error("Сервер не подтвердил сохранение статуса");
        return result;
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
      throw new Error("Сервер слишком долго сохраняет статус. Повтори действие — другие строки не заблокированы.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
