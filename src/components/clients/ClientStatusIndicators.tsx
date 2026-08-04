import { Star } from "lucide-react";
import type { ClientStatus } from "@/lib/client-status";
import { cn } from "@/lib/utils";

const membershipConfig = {
  active: {
    label: "Есть действующий абонемент",
    className: "bg-emerald-500",
  },
  ending: {
    label: "В обычном абонементе осталось 1–2 занятия",
    className: "bg-amber-500",
  },
  inactive: {
    label: "Нет действующего абонемента",
    className: "bg-red-500",
  },
} as const;

export const ClientStatusIndicators = ({
  status,
  className,
  reserveSpace = false,
}: {
  status?: ClientStatus | null;
  className?: string;
  reserveSpace?: boolean;
}) => {
  if (!status && !reserveSpace) return null;

  const membership = status ? membershipConfig[status.membership] : null;

  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5", reserveSpace && "w-10", className)}>
      {status?.isFirstVisit ? (
      <Star
          className="h-4 w-4 fill-amber-400 text-amber-500"
          aria-label="Первая запись клиента"
        >
          <title>Первая запись клиента</title>
        </Star>
      ) : reserveSpace ? <span className="h-4 w-4" aria-hidden="true" /> : null}
      {membership ? (
        <span
          className={cn("h-2.5 w-2.5 rounded-full ring-2 ring-white", membership.className)}
          aria-label={membership.label}
          title={membership.label}
        />
      ) : reserveSpace ? <span className="h-2.5 w-2.5" aria-hidden="true" /> : null}
    </span>
  );
};

export const ClientStatusLegend = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
      className,
    )}
  >
    <span className="inline-flex items-center gap-1">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" /> Первая запись
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Абонемент действует
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Осталось 1–2 занятия
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Нет абонемента
    </span>
  </div>
);
