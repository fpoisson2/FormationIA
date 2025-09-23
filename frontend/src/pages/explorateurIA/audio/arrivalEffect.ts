export interface ArrivalEffect {
  readonly isSupported: boolean;
  play(): Promise<void>;
  dispose(): void;
}

const createNoopEffect = (): ArrivalEffect => ({
  isSupported: false,
  play: async () => {
    /* noop */
  },
  dispose: () => {
    /* noop */
  },
});

export function createArrivalEffect(): ArrivalEffect {
  if (typeof window === "undefined") {
    return createNoopEffect();
  }
  const AudioContextConstructor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextConstructor) {
    return createNoopEffect();
  }

  const context = new AudioContextConstructor();
  const masterGain = context.createGain();
  masterGain.gain.value = 0.4;
  masterGain.connect(context.destination);

  let disposed = false;

  const play = async () => {
    if (disposed) {
      return;
    }
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch (error) {
        return;
      }
    }

    const now = context.currentTime;

    const sweepGain = context.createGain();
    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.55, now + 0.05);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);

    const sweep = context.createOscillator();
    sweep.type = "sine";
    sweep.frequency.setValueAtTime(880, now);
    sweep.frequency.exponentialRampToValueAtTime(220, now + 1);
    sweep.connect(sweepGain);
    sweepGain.connect(masterGain);
    sweep.start(now);
    sweep.stop(now + 1.1);

    const blipGain = context.createGain();
    blipGain.gain.setValueAtTime(0.0001, now + 0.3);
    blipGain.gain.exponentialRampToValueAtTime(0.35, now + 0.36);
    blipGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);

    const blip = context.createOscillator();
    blip.type = "triangle";
    blip.frequency.setValueAtTime(1320, now + 0.3);
    blip.frequency.exponentialRampToValueAtTime(440, now + 0.65);
    blip.connect(blipGain);
    blipGain.connect(masterGain);
    blip.start(now + 0.3);
    blip.stop(now + 0.75);

    return new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 1100);
      sweep.onended = () => {
        window.clearTimeout(timeout);
        resolve();
      };
    });
  };

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    masterGain.disconnect();
    void context.close();
  };

  return {
    isSupported: true,
    play,
    dispose,
  };
}
