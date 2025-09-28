import { describe, expect, it } from "vitest";

import {
  createDefaultExplorateurIAConfig,
  sanitizeExplorateurIAConfig,
} from "../../src/pages/ExplorateurIA";
import { DEFAULT_EXPLORATEUR_QUARTERS } from "../../src/pages/explorateurIA/config";

describe("sanitizeExplorateurIAConfig", () => {
  it("retire les étapes personnalisées pour ne conserver que la séquence par défaut", () => {
    const defaultConfig = createDefaultExplorateurIAConfig();
    const dirtyConfig = {
      ...defaultConfig,
      steps: [
        {
          id: "custom:step",
          component: "rich-content",
          config: { title: "Titre personnalisé" },
        },
      ],
      quarterDesignerSteps: {
        clarte: [
          {
            id: "clarte:custom",
            component: "rich-content",
            config: { title: "Contenu inattendu" },
          },
        ],
      },
    };

    const sanitized = sanitizeExplorateurIAConfig(dirtyConfig);

    expect(sanitized.steps).toEqual(defaultConfig.steps);
    expect(sanitized.quarterDesignerSteps).toEqual(
      defaultConfig.quarterDesignerSteps
    );
  });

  it("préserve uniquement les inventaires lors de la sanitation des quartiers", () => {
    const defaultConfig = createDefaultExplorateurIAConfig();
    const dirtyConfig = {
      ...defaultConfig,
      quarters: defaultConfig.quarters.map((quarter) =>
        quarter.id === "clarte"
          ? {
              ...quarter,
              label: "Label modifié",
              color: "#000000",
              inventory: {
                ...quarter.inventory!,
                title: "Boussole revisitée",
              },
            }
          : quarter
      ),
    };

    const sanitized = sanitizeExplorateurIAConfig(dirtyConfig);
    const defaultClarte = DEFAULT_EXPLORATEUR_QUARTERS.find(
      (quarter) => quarter.id === "clarte"
    );
    const sanitizedClarte = sanitized.quarters.find(
      (quarter) => quarter.id === "clarte"
    );

    expect(defaultClarte).toBeDefined();
    expect(sanitizedClarte).toBeDefined();
    expect(sanitizedClarte?.label).toBe(defaultClarte?.label);
    expect(sanitizedClarte?.color).toBe(defaultClarte?.color);
    expect(sanitizedClarte?.inventory?.title).toBe("Boussole revisitée");
  });
});
