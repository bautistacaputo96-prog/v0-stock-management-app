export function formatDateForDisplay(dateString: string, format: "short" | "long" = "short"): string {
  if (!dateString) return "N/A"

  // Parse YYYY-MM-DD without creating a Date object to avoid timezone issues
  const [year, month, day] = dateString.split("-").map(Number)

  if (format === "short") {
    // Format as DD/MM/YY
    const shortYear = year.toString().slice(-2)
    return `${day.toString().padStart(2, "0")}/${month.toString().padStart(2, "0")}/${shortYear}`
  } else {
    // Format as long date in Spanish
    const date = new Date(year, month - 1, day) // Use local timezone constructor
    return date.toLocaleDateString("es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }
}
