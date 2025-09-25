export const DEFAULT_QUARTER_IDS = [
  "clarte",
  "creation",
  "decision",
  "ethique",
  "mairie",
] as const;

export type QuarterId = (typeof DEFAULT_QUARTER_IDS)[number];

export function isQuarterId(value: unknown): value is QuarterId {
  return (
    typeof value === "string" &&
    (DEFAULT_QUARTER_IDS as readonly string[]).includes(value)
  );
}
