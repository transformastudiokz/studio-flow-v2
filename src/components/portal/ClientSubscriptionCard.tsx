import { format, parseISO } from "date-fns";
import { CalendarDays, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";

type ClientSubscriptionCardProps = {
  subscription: any;
  compact?: boolean;
};

export const ClientSubscriptionCard = ({ subscription, compact = false }: ClientSubscriptionCardProps) => {
  const total = subscription.visits_total;
  const remaining = subscription.visits_remaining;
  const progress = total ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 100;
  const isEnding = (remaining !== null && remaining <= 2) || (subscription.end_date && new Date(subscription.end_date).getTime() - Date.now() <= 7 * 86400000);

  return (
    <article className={`relative overflow-hidden rounded-[22px] border border-white/20 bg-gradient-to-br from-[#566b5c] to-[#708273] text-[#fffdf7] shadow-[0_12px_32px_rgba(64,83,70,.18)] ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/65">Абонемент</p>
          <h3 className="mt-1 truncate text-xl font-bold">{subscription.plan?.name || "Абонемент"}</h3>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isEnding ? "bg-[#fbf1df] text-[#8a5a1d]" : "bg-white/15 text-white"}`}>
          {isEnding ? "Заканчивается" : "Активен"}
        </span>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-white/65">Осталось</p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums">
            {remaining ?? "∞"}{total ? <span className="text-base font-medium text-white/60"> из {total}</span> : null}
          </p>
        </div>
        <div className="text-right text-sm">
          {subscription.end_date ? (
            <><p className="text-xs text-white/65">Действует включительно</p><p className="mt-1 flex items-center justify-end gap-1.5 font-semibold"><CalendarDays className="h-4 w-4" />{format(parseISO(subscription.end_date), "dd.MM.yyyy")}</p></>
          ) : (
            <><p className="text-xs text-white/65">Срок</p><p className="mt-1 flex items-center justify-end gap-1.5 font-semibold"><Sparkles className="h-4 w-4" />Активируется при первом посещении</p></>
          )}
        </div>
      </div>
      {total ? <Progress value={progress} className="mt-4 h-1.5 bg-white/20 [&>div]:bg-[#fffdf7]" /> : null}
    </article>
  );
};
