const CLASS_TYPE_IMAGE_BY_NAME: Record<string, string> = {
  "здоровая спина": "/class-types/01-zdorovaya-spina.jpg",
  "йога: айенгара": "/class-types/02-yoga-iyengar.jpg",
  "йога айенгара": "/class-types/02-yoga-iyengar.jpg",
  "йога: антистресс": "/class-types/03-yoga-antistress.jpg",
  "йога антистресс": "/class-types/03-yoga-antistress.jpg",
  "йога: аштанга": "/class-types/04-yoga-ashtanga.jpg",
  "йога аштанга": "/class-types/04-yoga-ashtanga.jpg",
  "йога: виньяса": "/class-types/05-yoga-vinyasa.jpg",
  "йога виньяса": "/class-types/05-yoga-vinyasa.jpg",
  "виньяса": "/class-types/05-yoga-vinyasa.jpg",
  "йога: для беременных": "/class-types/06-yoga-prenatal.jpg",
  "йога для беременных": "/class-types/06-yoga-prenatal.jpg",
  "йога: для спины и позвоночника": "/class-types/07-yoga-spina-pozvonochnik.jpg",
  "йога для спины и позвоночника": "/class-types/07-yoga-spina-pozvonochnik.jpg",
  "йога: сила, гибкость и баланс": "/class-types/08-yoga-sila-gibkost-balans.jpg",
  "йога сила гибкость и баланс": "/class-types/08-yoga-sila-gibkost-balans.jpg",
  "йога: терапия в гамаке": "/class-types/09-yoga-terapiya-v-gamake.jpg",
  "йога терапия в гамаке": "/class-types/09-yoga-terapiya-v-gamake.jpg",
  "йога: хатха": "/class-types/10-yoga-hatha.jpg",
  "йога хатха": "/class-types/10-yoga-hatha.jpg",
  "йога: хатха-виньяса": "/class-types/11-yoga-hatha-vinyasa.jpg",
  "йога хатха-виньяса": "/class-types/11-yoga-hatha-vinyasa.jpg",
  "йога хатха виньяса": "/class-types/11-yoga-hatha-vinyasa.jpg",
  "йога: fly yoga": "/class-types/12-yoga-fly-yoga.jpg",
  "йога fly yoga": "/class-types/12-yoga-fly-yoga.jpg",
  "fly yoga": "/class-types/12-yoga-fly-yoga.jpg",
  "пилатес": "/class-types/13-pilates.jpg",
  "растяжка (stretching)": "/class-types/14-stretching.jpg",
  "растяжка": "/class-types/14-stretching.jpg",
  "stretching": "/class-types/14-stretching.jpg",
  "растяжка в гамаках": "/class-types/15-rastyazhka-v-gamakah.jpg",
  "full body": "/class-types/16-full-body.jpg",
};

const normalizeClassTypeName = (name?: string | null) =>
  (name || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-");

export const getClassTypeImageUrl = (name?: string | null) => {
  const normalized = normalizeClassTypeName(name);
  return CLASS_TYPE_IMAGE_BY_NAME[normalized] || null;
};
