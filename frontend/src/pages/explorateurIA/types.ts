export const DEFAULT_QUARTER_IDS = [
  "clarte",
  "creation",
  "decision",
  "ethique",
  "mairie",
] as const;

export type QuarterId = string;

const QUARTER_ID_MAX_LENGTH = 48;
const QUARTER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function normalizeDiacritics(source: string): string {
  return source.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeQuarterId(value: unknown): QuarterId | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .slice(0, QUARTER_ID_MAX_LENGTH);
  if (!normalized || !QUARTER_ID_PATTERN.test(normalized)) {
    return null;
  }
  return normalized as QuarterId;
}

export function isQuarterId(value: unknown): value is QuarterId {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return QUARTER_ID_PATTERN.test(trimmed);
}
