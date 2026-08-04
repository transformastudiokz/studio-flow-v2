import { format, parseISO } from "date-fns";
import { AlertTriangle, CircleSlash2, LockKeyhole, Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatCoachShortName,
  normalizeRoom,
  sessionBookingCount,
  type ScheduleSession,
} from "@/lib/schedule";

type Props = {
  session: ScheduleSession;
  compact?: boolean;
  hasConflict?: boolean;
  weekCard?: boolean;
  onOpen: (session: ScheduleSession) => void;
};

export function ScheduleSessionCard({ session, compact = false, hasConflict = false, weekCard = false, onOpen }: Props) {
  const booked = sessionBookingCount(session);
  const isFull = booked >= session.capacity;
  const isCancelled = session.booking_status === "cancelled";
  const isClosed = session.booking_status === "closed";
  const color = session.class_type?.color || "#5D806D";
  const room = normalizeRoom(session.room);
  const title = [
    `${format(parseISO(session.start_time), "HH:mm")}–${format(parseISO(session.end_time), "HH:mm")}`,
    session.class_type?.name || "Занятие",
    session.coach?.name || "Без тренера",
    room,
    `${booked}/${session.capacity} мест`,
    session.booking_closed_reason || "",
  ].filter(Boolean).join(" · ");

  if (weekCard) {
    return (
      <button
        type="button"
        title={title}
        aria-label={`Открыть занятие: ${title}`}
        onClick={() => onOpen(session)}
        className={cn(
          "group relative flex h-full w-full flex-col justify-center overflow-hidden rounded-lg border bg-white py-1.5 pl-2.5 pr-1.5 text-left shadow-sm transition hover:z-20 hover:border-primary/30 hover:shadow-md focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          isClosed && "bg-slate-50 text-slate-700",
          isCancelled && "border-red-200 bg-slate-200/90 text-slate-600",
          hasConflict && "border-red-400 ring-1 ring-red-300",
        )}
        style={{ backgroundImage: `linear-gradient(90deg, ${color}14, transparent 55%)` }}
      >
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color }} aria-hidden="true" />
        <div className="flex h-4 min-w-0 items-center justify-between gap-1">
          <span className="shrink-0 whitespace-nowrap text-[10px] font-bold tabular-nums text-foreground/75">
            {format(parseISO(session.start_time), "HH:mm")}–{format(parseISO(session.end_time), "HH:mm")}
          </span>
          <span className="flex min-w-0 shrink items-center justify-end gap-0.5">
            {hasConflict && !isClosed && !isCancelled ? <AlertTriangle className="h-3 w-3 shrink-0 text-red-500" aria-label="Конфликт времени" /> : null}
            {isCancelled ? <CircleSlash2 className="h-3 w-3 shrink-0 text-red-600" aria-label="Отменено" /> : isClosed ? <LockKeyhole className="h-3 w-3 shrink-0 text-slate-600" aria-label="Запись закрыта" /> : null}
            {(session.firstBookingCount || 0) > 0 ? (
              <span className="inline-flex shrink-0 items-center gap-px text-[9px] font-semibold text-amber-700" title={`Впервые записаны: ${session.firstBookingCount}`}>
                <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-500" />{session.firstBookingCount}
              </span>
            ) : null}
            <span className={cn("inline-flex shrink-0 items-center text-[9px] font-bold tabular-nums", isFull ? "text-red-700" : booked / Math.max(session.capacity, 1) >= 0.75 ? "text-amber-700" : "text-emerald-700")} title={`${booked} из ${session.capacity} мест занято`}>
              {booked}/{session.capacity}
            </span>
          </span>
        </div>
        <div className="h-4 truncate text-[11px] font-semibold leading-4 text-foreground">
          {session.class_type?.name || "Занятие"}
        </div>
        <div className="flex h-3.5 min-w-0 items-center text-[9px] leading-3.5 text-muted-foreground">
          <span className="min-w-0 truncate" title={session.coach?.name || "Без тренера"}>{formatCoachShortName(session.coach?.name)}</span>
          <span className="mx-1 shrink-0">•</span>
          <span className="shrink-0">{room}</span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={`Открыть занятие: ${title}`}
      onClick={() => onOpen(session)}
      className={cn(
        "group relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-white p-2 text-left shadow-sm transition hover:z-20 hover:border-primary/30 hover:shadow-md focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isClosed && "bg-slate-50 text-slate-700",
        isCancelled && "border-red-200 bg-slate-200/90 text-slate-600",
        hasConflict && "border-red-400 ring-1 ring-red-300",
      )}
      style={{ backgroundImage: `linear-gradient(90deg, ${color}14, transparent 55%)` }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="flex w-full items-center justify-between gap-1 pl-1">
        <span className={cn("tabular-nums font-bold text-foreground/75", weekCard ? "text-[11px]" : "text-[10px]")}>
          {format(parseISO(session.start_time), "HH:mm")}–{format(parseISO(session.end_time), "HH:mm")}
        </span>
        <span className="flex items-center gap-1">
          {hasConflict ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label="Конфликт времени" /> : null}
        </span>
      </div>
      <div className="mt-0.5 line-clamp-2 pl-1 text-[12px] font-semibold leading-tight text-foreground">
        {session.class_type?.name || "Занятие"}
      </div>
      {!compact ? (
        <>
          <div className={cn("mt-1 pl-1 text-muted-foreground", weekCard ? "truncate text-[10px] leading-tight" : "truncate text-[10px]")} title={session.coach?.name || "Без тренера"}>
            {session.coach?.name || "Без тренера"}
          </div>
          {!weekCard ? <div className="truncate pl-1 text-[10px] text-muted-foreground">{room}</div> : null}
        </>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-1 pl-1 pt-1">
        <span className="flex min-w-0 items-center gap-1">
          {(session.firstBookingCount || 0) > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1 py-0.5 text-[9px] font-semibold text-amber-700" title={`Впервые записаны: ${session.firstBookingCount}`}>
              <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-500" /> {session.firstBookingCount}
            </span>
          ) : null}
          {isClosed || isCancelled ? (
            <span className={cn("inline-flex items-center gap-0.5 truncate text-[9px] font-semibold", isCancelled ? "text-red-700" : "text-slate-600")}>
              {isCancelled ? <CircleSlash2 className="h-2.5 w-2.5" /> : <LockKeyhole className="h-2.5 w-2.5" />}
              {compact ? null : isCancelled ? "Отменено" : "Запись закрыта"}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1 py-0.5 text-[9px] font-bold tabular-nums",
            isFull ? "bg-red-100 text-red-700" : booked / Math.max(session.capacity, 1) >= 0.75 ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700",
          )}
          title={isFull ? "Мест нет" : `${booked} из ${session.capacity} мест занято`}
        >
          <Users className="h-2.5 w-2.5" /> {booked}/{session.capacity}
        </span>
      </div>
      {!compact && !weekCard && (isClosed || isCancelled) && session.booking_closed_reason ? (
        <div className={cn("mt-1 line-clamp-1 pl-1 text-[9px]", isCancelled ? "text-red-700" : "text-slate-600")}>
          {session.booking_closed_reason}
        </div>
      ) : null}
    </button>
  );
}
