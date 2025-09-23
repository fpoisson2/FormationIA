import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  STEP_COMPONENT_REGISTRY,
  StepSequenceContext,
  type StepComponentProps,
} from "../../src/modules/step-sequence";
import {
  VideoStep,
  type VideoStepConfig,
} from "../../src/modules/step-sequence/modules";

function renderVideoStep(isEditMode: boolean, config: VideoStepConfig) {
  const onAdvance = vi.fn();
  const onUpdateConfig = vi.fn();

  const props: StepComponentProps = {
    definition: { id: "video-step", component: "video", config },
    config,
    payload: undefined,
    isActive: true,
    isEditMode,
    onAdvance,
    onUpdateConfig,
  };

  const view = render(
    <StepSequenceContext.Provider
      value={{
        stepIndex: 0,
        isEditMode,
        onAdvance,
        onUpdateConfig,
      }}
    >
      <VideoStep {...props} />
    </StepSequenceContext.Provider>
  );

  return { container: view.container, onAdvance, onUpdateConfig };
}

describe("VideoStep", () => {
  it("registers itself under the video key", () => {
    expect(STEP_COMPONENT_REGISTRY["video"]).toBe(VideoStep);
  });

  it("advances to the next step when the video ends and auto-advance is enabled", () => {
    const { container, onAdvance } = renderVideoStep(false, {
      sources: [{ type: "mp4", url: "https://cdn.example.com/video.mp4" }],
      autoAdvanceOnEnd: true,
    });

    const videoElement = container.querySelector("video");
    expect(videoElement).not.toBeNull();

    fireEvent.ended(videoElement!);

    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("shows a manual continue button when autoplay is blocked", async () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.reject(new Error("Autoplay blocked")));

    try {
      const { container, onAdvance } = renderVideoStep(false, {
        sources: [{ type: "mp4", url: "https://cdn.example.com/training.mp4" }],
        autoAdvanceOnEnd: true,
      });

      const videoElement = container.querySelector("video");
      expect(videoElement).not.toBeNull();

      fireEvent.loadedData(videoElement!);

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: "Continuer" })
        ).not.toBeNull();
      });

      const continueButton = screen.getByRole("button", { name: "Continuer" });
      fireEvent.click(continueButton);

      expect(onAdvance).toHaveBeenCalledTimes(1);
    } finally {
      playSpy.mockRestore();
    }
  });
});
