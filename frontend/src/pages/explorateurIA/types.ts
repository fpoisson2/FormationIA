export type QuarterId = "clarte" | "creation" | "decision" | "ethique" | "mairie";

export const QUARTER_ORDER: QuarterId[] = [
  "clarte",
  "creation",
  "decision",
  "ethique",
  "mairie",
];

export function isQuarterId(value: unknown): value is QuarterId {
  return typeof value === "string" && (QUARTER_ORDER as string[]).includes(value);
}
