import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Save, Settings as SettingsIcon, Info } from "lucide-react";
import { toast } from "sonner";
import { parseCancellationMinutes } from "@/lib/cancellation";

const Settings = () => {
  const queryClient = useQueryClient();
  const [loadingStudio, setLoadingStudio] = useState(false);
  
  // Состояния
  const [minutes, setMinutes] = useState("");
  const [studioData, setStudioData] = useState({
    name: "",
    description: "",
    address: "",
    phone: "",
    instagram: ""
  });

  // 1. ЗАГРУЗКА: Настройки приложения (Берем из studio_info по ключу)
  const { data: cancelSetting } = useQuery({
    queryKey: ['studio_info', 'cancellation_minutes'],
    queryFn: async () => {
      const { data } = await supabase.from('studio_info').select('value').eq('key', 'cancellation_minutes').single();
      return parseCancellationMinutes(data?.value);
    }
  });

  // 2. ЗАГРУЗКА: Инфо о студии (Фильтруем по ключам)
  const { data: studioInfoRaw } = useQuery({
    queryKey: ['studio_info_all'],
    queryFn: async () => {
      const { data } = await supabase.from('studio_info').select('*');
      return data || [];
    }
  });

  // Синхронизация данных при загрузке
  useEffect(() => {
    if (cancelSetting !== undefined && cancelSetting !== null) {
      setMinutes(String(cancelSetting));
    }
    if (studioInfoRaw) {
        // Превращаем массив [{key: 'name', value: 'Yoga'}] в объект
        const infoMap: any = {};
        studioInfoRaw.forEach((item: any) => infoMap[item.key] = item.value);
        
        setStudioData({
            name: infoMap.name || "Balance Studio",
            description: infoMap.description || "",
            address: infoMap.address || "",
            phone: infoMap.phone || "",
            instagram: infoMap.instagram || ""
        });
    }
  }, [cancelSetting, studioInfoRaw]);

  // --- МУТАЦИЯ 1: Сохранить настройки отмены ---
  const updateSettingsMutation = useMutation({
    mutationFn: async () => {
       const normalizedMinutes = Number(minutes);
       if (!Number.isInteger(normalizedMinutes) || normalizedMinutes < 0) {
         throw new Error("Укажите целое количество минут — ноль или больше");
       }
       // Upsert = Вставить или Обновить
       const { error } = await supabase
         .from('studio_info')
         .upsert({ key: 'cancellation_minutes', value: String(normalizedMinutes) }, { onConflict: 'key' });
       if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Правила отмены сохранены");
      queryClient.invalidateQueries({ queryKey: ['studio_info', 'cancellation_minutes'] });
    },
    onError: (err) => toast.error(err.message)
  });

  // --- МУТАЦИЯ 2: Сохранить инфо о студии ---
  const updateStudioMutation = useMutation({
    mutationFn: async () => {
      setLoadingStudio(true);
      
      // Готовим массив для пакетного обновления
      const updates = Object.entries(studioData).map(([key, value]) => ({
          key,
          value
      }));

      const { error } = await supabase.from('studio_info').upsert(updates, { onConflict: 'key' });
      
      setLoadingStudio(false);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Информация о студии обновлена");
      queryClient.invalidateQueries({ queryKey: ['studio_info_all'] });
    },
    onError: (err) => {
        setLoadingStudio(false);
        toast.error(err.message);
    }
  });

  return (
    <div className="space-y-6 animate-in fade-in max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="w-8 h-8 text-gray-700" />
        <div>
            <h1 className="text-3xl font-bold">Настройки</h1>
            <p className="text-muted-foreground">Управление параметрами студии и приложения.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* КАРТОЧКА 1: Правила системы */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Правила записи и отмены</CardTitle>
              <CardDescription>
                Глобальные настройки для всех клиентов.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Запрет отмены за (минут)</Label>
                <div className="flex items-center gap-4">
                    <Input 
                        type="number" 
                        value={minutes} 
                        onChange={(e) => setMinutes(e.target.value)} 
                        className="max-w-[150px]"
                    />
                    <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
                        {Number.isFinite(Number(minutes)) && minutes !== "" ? `${(Number(minutes) / 60).toFixed(1)} ч.` : "—"}
                    </span>
                </div>
                <div className="text-xs text-gray-500 bg-blue-50 p-3 rounded-md flex gap-2 items-start mt-2">
                    <Info className="w-4 h-4 mt-0.5 text-blue-600" />
                    <p>Если до начала урока осталось меньше этого времени, клиент не сможет отменить запись в приложении.</p>
                </div>
              </div>
              
              <Button onClick={() => updateSettingsMutation.mutate()} disabled={updateSettingsMutation.isPending} className="w-full">
                {updateSettingsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Save className="mr-2 h-4 w-4" /> Сохранить правила
              </Button>
            </CardContent>
          </Card>

          {/* КАРТОЧКА 2: Информация о студии */}
          <Card>
            <CardHeader>
              <CardTitle>Информация о студии</CardTitle>
              <CardDescription>Отображается в мобильном приложении клиента.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Название</Label>
                <Input value={studioData.name} onChange={e => setStudioData({...studioData, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Описание</Label>
                <Textarea 
                  className="h-24" 
                  value={studioData.description} 
                  onChange={e => setStudioData({...studioData, description: e.target.value})} 
                  placeholder="О нас..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <Label>Адрес</Label>
                   <Input value={studioData.address} onChange={e => setStudioData({...studioData, address: e.target.value})} />
                 </div>
                 <div className="space-y-2">
                   <Label>Телефон</Label>
                   <Input value={studioData.phone} onChange={e => setStudioData({...studioData, phone: e.target.value})} />
                 </div>
              </div>
              <div className="space-y-2">
                <Label>Instagram</Label>
                <Input value={studioData.instagram} onChange={e => setStudioData({...studioData, instagram: e.target.value})} />
              </div>

              <Button onClick={() => updateStudioMutation.mutate()} disabled={loadingStudio} variant="outline" className="w-full">
                {loadingStudio && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Сохранить информацию
              </Button>
            </CardContent>
          </Card>
      </div>
    </div>
  );
};

export default Settings;
