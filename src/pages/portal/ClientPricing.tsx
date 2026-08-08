import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Check, Loader2, ChevronLeft, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const ClientPricing = () => {
  const navigate = useNavigate();

  const { data: plans, isLoading } = useQuery({
    queryKey: ["public_plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("is_active", true)
        .eq("is_visible_in_client_portal", true)
        .order("price");
      if (error) throw error;
      return data;
    },
  });

  const { data: adminPhone } = useQuery({
    queryKey: ['studio_phone'],
    queryFn: async () => {
      const { data } = await supabase.from('studio_info').select('value').eq('key', 'phone').single();
      return data?.value || '';
    }
  });

  const buyViaWhatsApp = (planName: string) => {
    if (!adminPhone) return;
    const text = `Здравствуйте! Хочу купить абонемент "${planName}".`;
    window.open(`https://wa.me/${adminPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
      <div className="client-page">
        {/* Header с кнопкой назад */}
        <div className="flex items-center gap-2 pt-4 mb-4">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate(-1)}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <h1 className="client-page-title">Тарифы</h1>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary" /></div>
        ) : plans?.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {plans?.map((plan: any) => (
              <div key={plan.id} className="client-surface overflow-hidden">
                {/* Верхняя часть */}
                <div className="flex items-start justify-between p-4 pb-3">
                  <div>
                    <h3 className="text-base font-bold leading-tight">{plan.name}</h3>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-extrabold text-[var(--client-sage-deep)]">{plan.price.toLocaleString()}</span>
                      <span className="text-sm font-medium text-[var(--client-sage-deep)]">₸</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-lg font-bold text-gray-800">
                      {plan.visits_count ? plan.visits_count : "∞"}
                    </div>
                    <div className="text-xs text-gray-400">занятий</div>
                  </div>
                </div>

                {/* Разделитель */}
                <div className="mx-4 border-t border-gray-100" />

                {/* Детали */}
                <div className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center text-sm text-gray-600">
                    <Check className="h-3.5 w-3.5 mr-2 text-green-500 shrink-0" />
                    Срок действия {plan.duration_days} дней
                  </div>
                  {plan.description?.split('\n').filter(Boolean).map((line: string, i: number) => (
                    <div key={i} className="flex items-start text-sm text-gray-600">
                      <Check className="h-3.5 w-3.5 mr-2 text-green-500 mt-0.5 shrink-0" />
                      <span>{line.replace(/^-\s*/, '')}</span>
                    </div>
                  ))}
                </div>

                {/* Кнопка */}
                <div className="px-4 pb-4">
                  <Button
                    className="client-primary w-full rounded-xl h-11 gap-2"
                    onClick={() => buyViaWhatsApp(plan.name)}
                    disabled={!adminPhone}
                  >
                    <MessageCircle className="w-4 h-4" />
                    Купить через WhatsApp
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="client-surface px-5 py-8 text-center text-sm text-muted-foreground">
            Сейчас нет доступных для покупки тарифов. Напишите администратору — мы поможем подобрать абонемент.
          </div>
        )}
      </div>
  );
};

export default ClientPricing;
