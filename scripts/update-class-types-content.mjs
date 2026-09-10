import { createClient } from "@supabase/supabase-js";

const classTypes = [
  {
    name: "Здоровая спина",
    duration_min: 55,
    description:
      "Мягкое занятие для подвижности спины, плеч, шеи и поясницы. В спокойном темпе работаем с осанкой, дыханием, вытяжением и контролем корпуса, без резких движений и перегруза. После тренировки обычно появляется ощущение легкости, собранности и более свободного движения.",
  },
  {
    name: "Йога: Айенгара",
    aliases: ["Йога Айенгара"],
    duration_min: 60,
    description:
      "Точная и спокойная практика йоги с вниманием к положению тела, дыханию и качеству каждой позы. Опоры помогают безопасно выстроить асаны и лучше почувствовать работу мышц. Результат занятия - ясность в теле, аккуратная осанка и уверенное понимание техники.",
  },
  {
    name: "Йога: Антистресс",
    aliases: ["Йога Антистресс"],
    duration_min: 60,
    description:
      "Спокойная йога с мягким движением, дыханием и расслаблением. Практика помогает переключиться с напряжения на ощущение тела, замедлиться и восстановить внутренний ритм. После занятия человек уходит более спокойным, ровным и расслабленным.",
  },
  {
    name: "Йога: Аштанга",
    aliases: ["Йога Аштанга"],
    duration_min: 60,
    description:
      "Динамичная и дисциплинированная практика с последовательными асанами, дыханием и устойчивым темпом. Занятие развивает силу, выносливость, гибкость и концентрацию. После тренировки остается ощущение собранности, тонуса и хорошо проделанной работы.",
  },
  {
    name: "Йога: Виньяса",
    aliases: ["Виньяса", "Йога Виньяса"],
    duration_min: 60,
    description:
      "Плавная динамичная йога, где движение связано с дыханием. Практика мягко разогревает тело, развивает подвижность, баланс и силу без жесткого силового формата. Результат - ощущение потока, легкости и живого тонуса.",
  },
  {
    name: "Йога: Для беременных",
    aliases: ["Йога для беременных"],
    duration_min: 60,
    description:
      "Бережная йога с учетом периода беременности, самочувствия и безопасной амплитуды движений. На занятии используются мягкая мобилизация, дыхание, расслабление и комфортные положения с опорами. Цель - поддержать тело, снизить лишнее напряжение и дать ощущение спокойствия.",
  },
  {
    name: "Йога: Для спины и позвоночника",
    aliases: ["Йога для спины и позвоночника"],
    duration_min: 60,
    description:
      "Йога с акцентом на мягкую подвижность позвоночника, вытяжение, осанку и снятие лишнего напряжения в спине. Практика сочетает спокойные асаны, дыхание и контроль положения тела. После занятия легче держать корпус и свободнее двигаться.",
  },
  {
    name: "Йога: Сила, гибкость и баланс",
    duration_min: 60,
    description:
      "Практика соединяет укрепление мышц, развитие гибкости и работу с устойчивостью. В занятии есть статические удержания, плавные переходы и упражнения на баланс. Результат - более сильное, подвижное и собранное тело.",
  },
  {
    name: "Йога: Терапия в гамаке",
    duration_min: 60,
    description:
      "Мягкая практика с поддержкой гамака, где тело получает ощущение разгрузки, плавности и безопасности. Занятие строится вокруг расслабления, мягкой подвижности и комфортного вытяжения. После класса обычно остается ощущение легкости и глубокого выдоха.",
  },
  {
    name: "Йога: Хатха",
    aliases: ["Йога Хатха"],
    duration_min: 60,
    description:
      "Базовая универсальная йога в спокойном темпе: асаны, дыхание, внимание к телу и понятная техника. Занятие помогает развивать гибкость, устойчивость, мягкую силу и концентрацию. После практики тело ощущается более ровным, спокойным и собранным.",
  },
  {
    name: "Йога: Хатха-виньяса",
    aliases: ["Йога Хатха - Виньяса", "Йога Хатха-Виньяса"],
    duration_min: 60,
    description:
      "Формат соединяет понятные базовые асаны хатхи и плавные динамичные переходы виньясы. Тренировка дает мягкий тонус, подвижность, координацию и ощущение движения в ритме дыхания. Это баланс между спокойной техникой и живой динамикой.",
  },
  {
    name: "Йога: Fly Yoga",
    aliases: ["Fly Yoga"],
    duration_min: 60,
    description:
      "Йога в гамаке с поддержкой тела, балансом и элементами воздушной практики. Гамак помогает мягче входить в положения, развивать координацию и по-новому почувствовать тело. После занятия остается ощущение легкости, интереса и приятной свободы движения.",
  },
  {
    name: "Пилатес",
    duration_min: 55,
    description:
      "Контролируемая тренировка для глубоких мышц, кора, осанки и точного движения. В спокойном темпе работаем над стабильностью, силой, мобильностью и качеством техники. Результат - более собранное тело, лучшее ощущение центра и аккуратный тонус без резкой нагрузки.",
  },
  {
    name: "Растяжка (Stretching)",
    aliases: ["Растяжка", "Stretching"],
    duration_min: 55,
    description:
      "Занятие на гибкость, мобильность и мягкое расслабление мышечного напряжения. Работаем постепенно: разогрев, безопасная амплитуда, дыхание и комфортное удержание положений. После тренировки тело ощущается легче, свободнее и мягче.",
  },
  {
    name: "Растяжка в гамаках",
    duration_min: 60,
    description:
      "Растяжка с поддержкой гамака, где легче расслабиться и мягко войти в амплитуду. Гамак помогает снять часть веса тела, лучше почувствовать положение и сделать практику более плавной. Результат - ощущение вытяжения, легкости и нового контакта с телом.",
  },
  {
    name: "Full Body",
    duration_min: 55,
    description:
      "Силовая тренировка на все тело: ноги, ягодицы, спина, руки и пресс. Работаем с собственным весом, гантелями и резинками, без прыжков и хаотичной нагрузки. Результат - тонус, сила, выносливость и ощущение хорошо проработанного тела.",
  },
];

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;
const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Set SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  global: supabaseAccessToken
    ? { headers: { Authorization: `Bearer ${supabaseAccessToken}` } }
    : undefined,
});

const { data: existing, error: readError } = await supabase
  .from("class_types")
  .select("id,name,description,duration_min");

if (readError) throw readError;

const byNormalizedName = new Map(
  (existing || []).map((item) => [item.name.trim().toLocaleLowerCase("ru-RU"), item]),
);

const results = [];

for (const classType of classTypes) {
  const candidateNames = [...(classType.aliases || []), classType.name];
  const existingClassType = candidateNames
    .map((name) => byNormalizedName.get(name.trim().toLocaleLowerCase("ru-RU")))
    .find(Boolean);

  if (existingClassType) {
    const { error } = await supabase
      .from("class_types")
      .update({
        description: classType.description,
        duration_min: classType.duration_min,
      })
      .eq("id", existingClassType.id);

    if (error) throw error;
    results.push({ action: "updated", name: classType.name });
  } else {
    const { error } = await supabase
      .from("class_types")
      .insert({
        name: classType.name,
        description: classType.description,
        duration_min: classType.duration_min,
        color: "#8A9B8C",
      });

    if (error) throw error;
    results.push({ action: "created", name: classType.name });
  }
}

for (const result of results) {
  console.log(`${result.action}: ${result.name}`);
}
