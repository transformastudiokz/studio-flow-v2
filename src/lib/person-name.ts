type PersonName = {
  first_name?: string | null;
  last_name?: string | null;
};

export const formatResponsibleShortName = (person?: PersonName | null) => {
  if (!person) return "Импортировано";

  const firstParts = (person.first_name || "").trim().split(/\s+/).filter(Boolean);
  const lastParts = (person.last_name || "").trim().split(/\s+/).filter(Boolean);

  // Some legacy employees were imported as: first_name=surname,
  // last_name="given name patronymic". Normalize that layout for display.
  if (firstParts.length === 1 && lastParts.length >= 2) {
    return `${lastParts[0]} ${firstParts[0].slice(0, 1).toLocaleUpperCase("ru-RU")}.`;
  }

  const firstName = firstParts.join(" ");
  const surnameInitial = lastParts[0]?.slice(0, 1).toLocaleUpperCase("ru-RU");
  return [firstName, surnameInitial ? `${surnameInitial}.` : ""].filter(Boolean).join(" ") || "Сотрудник";
};
