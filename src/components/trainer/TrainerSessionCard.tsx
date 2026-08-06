import { format, parseISO } from "date-fns";
import { Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCoachShortName, normalizeRoom } from "@/lib/schedule";

export type TrainerScheduleSession = {
  id: string;
  start_time: string;
  end_time: string;
  capacity: number;
  room: string | null;
  booking_status: string;
  booking_closed_reason: string | null;
  class_name: string;
  class_color: string | null;
  coach_name: string;
  crm_booked_count: number;
  onefit_count: number;
  booked_count: number;
  first_booking_count: number;
  repeat_booking_count: number;
  completed_count: number;
};

const count = (value: number | string | null | undefined) => Number(value || 0);

export function TrainerSessionCard({ session }: { session: TrainerScheduleSession }) {
  const occupied = count(session.booked_count);
  const onefit = count(session.onefit_count);
  const first = count(session.first_booking_count);
  const repeat = count(session.repeat_booking_count);
  const ratio = occupied / Math.max(session.capacity, 1);
  const full = occupied >= session.capacity;
  const time = `${format(parseISO(session.start_time), "HH:mm")}–${format(parseISO(session.end_time), "HH:mm")}`;
  const coach = formatCoachShortName(session.coach_name);
  const room = normalizeRoom(session.room);
  const accessibleSummary = `${time}. ${session.class_name}. ${coach}. ${room}. ${occupied} из ${session.capacity} мест. OneFit: ${onefit}. Первые записи: ${first}. Повторные записи: ${repeat}.`;

  return (
    <article
      aria-label={accessibleSummary}
      className={cn(
        "relative min-w-0 overflow-hidden rounded-xl border bg-white px-3 py-1.5 shadow-sm",
        session.booking_status === "cancelled" && "border-red-200 bg-slate-100 opacity-70",
        session.booking_status === "closed" && "bg-slate-50",
      )}
      style={{ backgroundImage: `linear-gradient(90deg, ${session.class_color || "#5D806D"}12, transparent 58%)` }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: session.class_color || "#5D806D" }} aria-hidden="true" />
      <div className="flex min-w-0 items-center justify-between gap-2 pl-1">
        <time className="shrink-0 text-[12px] font-bold tabular-nums text-foreground/75" dateTime={session.start_time}>{time}</time>
        <div className="flex min-w-0 shrink items-center justify-end gap-1">
          {first > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-amber-700" title={`Первые записи: ${first}`}>
              <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-hidden="true" />{first}
            </span>
          ) : null}
          {repeat > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-slate-500" title={`Повторные записи: ${repeat}`}>
              <Star className="h-3 w-3 fill-slate-300 text-slate-400" aria-hidden="true" />{repeat}
            </span>
          ) : null}
          {onefit > 0 ? (
            <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-sky-100 px-1.5 text-[9px] font-extrabold tracking-tight text-sky-700" title={`OneFit: ${onefit}`}>
              <span className="sm:hidden">1F&nbsp;{onefit}</span><span className="hidden sm:inline">1FIT&nbsp;{onefit}</span>
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-extrabold tabular-nums",
              full ? "bg-red-100 text-red-700" : ratio >= 0.75 ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700",
            )}
            title={`${occupied} из ${session.capacity} мест занято`}
          >
            <Users className="h-3 w-3" aria-hidden="true" />{occupied}/{session.capacity}
          </span>
        </div>
      </div>
      <h3 className="mt-0.5 truncate pl-1 text-[13px] font-semibold leading-4" title={session.class_name}>{session.class_name}</h3>
      <p className="truncate pl-1 text-[10px] leading-3.5 text-muted-foreground" title={`${session.coach_name} · ${room}`}>
        {coach}<span className="mx-1">•</span>{room}
      </p>
      {session.booking_status !== "open" ? (
        <p className={cn("mt-1 truncate pl-1 text-[10px] font-medium", session.booking_status === "cancelled" ? "text-red-700" : "text-slate-600")}>
          {session.booking_status === "cancelled" ? "Занятие отменено" : "Запись закрыта"}{session.booking_closed_reason ? `: ${session.booking_closed_reason}` : ""}
        </p>
      ) : null}
    </article>
  );
}
