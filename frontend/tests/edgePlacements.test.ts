import { describe, expect, it } from "vitest";

import sample from "./fixtures/edge-placements.sample.json";
import { computeIslandEdgePlacements } from "../src/pages/ExplorateurIA";

type SamplePlacement = {
  orientation: string[];
  variant: "interior" | "exterior";
  touchesOutside: boolean;
};

describe("computeIslandEdgePlacements", () => {
  it("matches the reference output from the Python generator", () => {
    const island = new Set<string>();
    for (const [x, y] of sample.island) {
      island.add(`${x},${y}`);
    }

    const placements = computeIslandEdgePlacements(
      island,
      sample.width,
      sample.height
    );

    const expectedEntries = Object.entries(sample.placements as Record<string, SamplePlacement>);
    expect(placements.size).toBe(expectedEntries.length);

    for (const [key, expected] of expectedEntries) {
      const actual = placements.get(key);
      expect(actual).toBeDefined();
      if (!actual) continue;
      expect([...actual.orientation]).toEqual(expected.orientation);
      expect(actual.variant).toBe(expected.variant);
      expect(actual.touchesOutside).toBe(expected.touchesOutside);
    }
  });
});
