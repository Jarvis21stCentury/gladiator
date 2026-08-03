/** Shared display formatting. No "server-only" — client components need these too. */

/** Minutes as `4h 20m`. Kept short: these sit in tight docket columns. */
export function minutesLabel(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;

  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function gradeLabel(percent: number | null): string {
  return percent === null ? "—" : `${percent.toFixed(1)}%`;
}

/** `03` — the serial format used by every section head and margin numeral. */
export function serial(index: number): string {
  return String(index).padStart(2, "0");
}
