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

    const flightDuration = 2.4;
    const engineDuration = flightDuration + 0.18;
    const landingChimeStart = flightDuration - 0.55;
    const landingChimeEnd = landingChimeStart + 0.55;

    const sweepGain = context.createGain();
    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.6, now + 0.1);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + flightDuration);

    const sweep = context.createOscillator();
    sweep.type = "sine";
    sweep.frequency.setValueAtTime(880, now);
    sweep.frequency.exponentialRampToValueAtTime(240, now + flightDuration - 0.1);
    sweep.connect(sweepGain);
    sweepGain.connect(masterGain);
    sweep.start(now);
    sweep.stop(now + flightDuration + 0.08);

    const engineGain = context.createGain();
    engineGain.gain.setValueAtTime(0.0001, now);
    engineGain.gain.exponentialRampToValueAtTime(0.24, now + 0.18);
    engineGain.gain.exponentialRampToValueAtTime(0.0001, now + engineDuration);

    const engine = context.createOscillator();
    engine.type = "sawtooth";
    engine.frequency.setValueAtTime(180, now);
    engine.frequency.exponentialRampToValueAtTime(70, now + engineDuration);
    engine.connect(engineGain);
    engineGain.connect(masterGain);
    engine.start(now);
    engine.stop(now + engineDuration + 0.08);

    const blipGain = context.createGain();
    blipGain.gain.setValueAtTime(0.0001, now + landingChimeStart);
    blipGain.gain.exponentialRampToValueAtTime(0.4, now + landingChimeStart + 0.06);
    blipGain.gain.exponentialRampToValueAtTime(0.0001, now + landingChimeEnd);

    const blip = context.createOscillator();
    blip.type = "triangle";
    blip.frequency.setValueAtTime(1320, now + landingChimeStart);
    blip.frequency.exponentialRampToValueAtTime(420, now + landingChimeEnd - 0.08);
    blip.connect(blipGain);
    blipGain.connect(masterGain);
    blip.start(now + landingChimeStart);
    blip.stop(now + landingChimeEnd + 0.05);

    return new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolve();
      };
      const timeout = window.setTimeout(
        finish,
        Math.ceil((engineDuration + 0.12) * 1000)
      );
      engine.onended = () => {
        window.clearTimeout(timeout);
        finish();
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
