export function getImportedWorkoutTitle(title, importedAt = new Date()) {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  if (normalizedTitle && normalizedTitle.toLocaleUpperCase("es-ES") !== "NUEVO WOD") return normalizedTitle;
  const timestamp = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(importedAt);
  return "NUEVO WOD · " + timestamp;
}
