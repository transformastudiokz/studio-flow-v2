import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getClassTypeImageUrl } from "@/lib/class-type-assets";

export default function ClassTypes() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingType, setEditingType] = useState<any>(null);
  const [formData, setFormData] = useState({ name: "", description: "", duration: "60", color: "#3b82f6" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Фильтры
  const [filterName, setFilterName] = useState("");
  const [filterMinDuration, setFilterMinDuration] = useState("");
  const [filterMaxDuration, setFilterMaxDuration] = useState("");

  const { data: classTypes = [], isLoading } = useQuery({
    queryKey: ['class_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_types')
        .select('*')
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('class_types').insert([{
        name: formData.name,
        description: formData.description,
        duration_min: parseInt(formData.duration),
        color: formData.color
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_types'] });
      setIsOpen(false);
      setFormData({ name: "", description: "", duration: "60", color: "#3b82f6" });
      toast({ title: "Успешно", description: "Тип занятия создан" });
    },
    onError: (error: any) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('class_types').update({
        name: formData.name,
        description: formData.description,
        duration_min: parseInt(formData.duration),
        color: formData.color
      }).eq('id', editingType.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_types'] });
      setIsOpen(false);
      setEditingType(null);
      setFormData({ name: "", description: "", duration: "60", color: "#3b82f6" });
      toast({ title: "Успешно", description: "Тип занятия обновлён" });
    },
    onError: (error: any) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    }
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Вы уверены?")) return;
    const { error } = await supabase.from('class_types').delete().eq('id', id);
    if (error) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ['class_types'] });
      toast({ title: "Удалено", description: "Тип занятия удален" });
    }
  };

  const openCreate = () => {
    setEditingType(null);
    setFormData({ name: "", description: "", duration: "60", color: "#3b82f6" });
    setIsOpen(true);
  };

  const openEdit = (type: any) => {
    setEditingType(type);
    setFormData({
      name: type.name,
      description: type.description || "",
      duration: type.duration_min?.toString() || "60",
      color: type.color || "#3b82f6"
    });
    setIsOpen(true);
  };

  const filteredTypes = classTypes.filter((type: any) => {
    if (filterName && !type.name.toLowerCase().includes(filterName.toLowerCase())) return false;
    if (filterMinDuration && type.duration_min < Number(filterMinDuration)) return false;
    if (filterMaxDuration && type.duration_min > Number(filterMaxDuration)) return false;
    return true;
  });

  const hasActiveFilters = filterName || filterMinDuration || filterMaxDuration;

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Типы занятий</h1>
          <p className="text-muted-foreground">Настройка видов тренировок</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Добавить тип
        </Button>
      </div>

      {/* ФИЛЬТРЫ */}
      <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Фильтры</span>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => {
              setFilterName(""); setFilterMinDuration(""); setFilterMaxDuration("");
            }}>
              Сбросить
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по названию"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
              className="h-8 text-sm pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Input placeholder="Длит. от (мин)" type="number" value={filterMinDuration} onChange={e => setFilterMinDuration(e.target.value)} className="h-8 text-sm" />
            <Input placeholder="до" type="number" value={filterMaxDuration} onChange={e => setFilterMaxDuration(e.target.value)} className="h-8 text-sm" />
          </div>
        </div>
        {hasActiveFilters && (
          <p className="text-xs text-muted-foreground">Найдено: {filteredTypes.length} из {classTypes.length}</p>
        )}
      </div>

      <div className="border rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Фото</TableHead>
              <TableHead>Описание</TableHead>
              <TableHead>Длительность</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTypes.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Нет типов занятий по выбранным фильтрам
                </TableCell>
              </TableRow>
            )}
            {filteredTypes.map((type: any) => {
              const imageUrl = getClassTypeImageUrl(type.name);
              return (
                <TableRow key={type.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: type.color }} />
                      {type.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    {imageUrl ? (
                      <img src={imageUrl} alt={type.name} className="h-12 w-16 rounded-md object-cover" />
                    ) : (
                      <span className="text-xs text-muted-foreground">Не задано</span>
                    )}
                  </TableCell>
                  <TableCell>{type.description}</TableCell>
                  <TableCell>{type.duration_min} мин</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(type)}>
                      <Edit className="h-4 w-4 text-blue-500" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(type.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setEditingType(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingType ? "Редактировать тип занятия" : "Новый тип занятия"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Input
                placeholder="Название (например, Йога)"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Textarea
                placeholder="Описание"
                value={formData.description}
                onChange={e => setFormData({...formData, description: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Input
                  type="number"
                  placeholder="Длительность (мин)"
                  value={formData.duration}
                  onChange={e => setFormData({...formData, duration: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Input
                  type="color"
                  className="h-10 px-2"
                  value={formData.color}
                  onChange={e => setFormData({...formData, color: e.target.value})}
                />
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => editingType ? updateMutation.mutate() : createMutation.mutate()}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
