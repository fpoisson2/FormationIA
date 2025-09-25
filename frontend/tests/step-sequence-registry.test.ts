import { describe, expect, it } from "vitest";

import { STEP_COMPONENT_REGISTRY } from "../src/modules/step-sequence";
import "../src/modules/step-sequence/modules";

describe("step sequence registry", () => {
  it("expose le module Explorateur IA", () => {
    expect(STEP_COMPONENT_REGISTRY["explorateur-world"]).toBeDefined();
  });
});
