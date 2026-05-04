export function parseDriverPinMessage(text: string): string | null {
  const normalized = text.trim();
  return /^\d{4}$/.test(normalized) ? normalized : null;
}
