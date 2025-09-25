import { GRID_SIZE, START_POSITION } from "./constants";
import type { GridCoord } from "./types";

export const randomInt = (max: number): number => Math.floor(Math.random() * max);

export const gridKey = (coord: GridCoord): string => `${coord.x}-${coord.y}`;

export const createRunId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `run-${Math.random().toString(36).slice(2, 10)}`;
};

export const createRandomTarget = (current?: GridCoord): GridCoord => {
  let next = { x: randomInt(GRID_SIZE), y: randomInt(GRID_SIZE) };
  while (
    (next.x === START_POSITION.x && next.y === START_POSITION.y) ||
    (current && next.x === current.x && next.y === current.y)
  ) {
    next = { x: randomInt(GRID_SIZE), y: randomInt(GRID_SIZE) };
  }
  return next;
};

export const createRandomObstacles = (target: GridCoord, count = 6): GridCoord[] => {
  const set = new Set<string>();
  const obstacles: GridCoord[] = [];
  while (obstacles.length < Math.max(0, count)) {
    const candidate = { x: randomInt(GRID_SIZE), y: randomInt(GRID_SIZE) };
    const key = gridKey(candidate);
    if (
      set.has(key) ||
      (candidate.x === START_POSITION.x && candidate.y === START_POSITION.y) ||
      (candidate.x === target.x && candidate.y === target.y)
    ) {
      continue;
    }
    set.add(key);
    obstacles.push(candidate);
  }
  return obstacles;
};

export const formatDuration = (ms: number): string => {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)} s`;
  }
  return `${Math.round(seconds)} s`;
};
