import { supabase } from "@/lib/supabase";

export async function updateBookingStatus(bookingId: string, status: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
    body: JSON.stringify({ action: "set-booking-status", bookingId, status }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Не удалось сохранить статус посещения");
  return result;
}
