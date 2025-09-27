export interface ChiptuneTheme {
  readonly isSupported: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
}

const DEFAULT_VOLUME = 0.18;
const TEMPO = 76;
const BEAT_DURATION = 60 / TEMPO;
const LOOP_BEATS = 8;
const LOOKAHEAD_SECONDS = 0.25;
const SCHEDULER_INTERVAL_MS = 90;
const ATTACK = 0.04;
const RELEASE = 0.4;
const MELODY_VELOCITY_SCALE = 0.65;
const BASS_VELOCITY_SCALE = 0.55;
const NOISE_VELOCITY_SCALE = 0.35;

const NOTE_REGEX = /^(?<note>[A-Ga-g])(?<accidental>#|b)?(?<octave>-?\d)$/;
const NOTE_OFFSETS: Record<string, number> = {
  C: -9,
  D: -7,
  E: -5,
  F: -4,
  G: -2,
  A: 0,
  B: 2,
};

type PatternNote = {
  time: number;
  duration: number;
  frequency: number;
  velocity: number;
  waveform?: OscillatorType;
  periodicWave?: PeriodicWave;
};

type ScheduledSource = {
  oscillator: OscillatorNode;
  envelope: GainNode;
};

const createNoopTheme = (): ChiptuneTheme => ({
  isSupported: false,
  start: async () => {
    /* noop */
  },
  stop: async () => {
    /* noop */
  },
  dispose: () => {
    /* noop */
  },
});

function noteToFrequency(note: string): number {
  const match = NOTE_REGEX.exec(note.trim());
  if (!match || !match.groups) {
    return 440;
  }
  const base = match.groups.note.toUpperCase();
  const accidental = match.groups.accidental ?? "";
  const octave = Number(match.groups.octave);
  const semitoneOffset =
    (octave - 4) * 12 +
    NOTE_OFFSETS[base] +
    (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
  return 440 * Math.pow(2, semitoneOffset / 12);
}

function createNoiseWave(context: AudioContext): PeriodicWave {
  const size = 32;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let i = 1; i < size; i += 1) {
    // Valeurs pseudo-aléatoires déterministes pour un bruit léger.
    const seed = Math.sin(i * 43758.5453) * 1_0000;
    const value = (seed - Math.floor(seed)) * 2 - 1;
    const softened = value * 0.45;
    real[i] = softened;
    imag[i] = softened * 0.6;
  }
  return context.createPeriodicWave(real, imag, { disableNormalization: true });
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const jitterValue = (value: number, amount: number) =>
  value + (Math.random() * 2 - 1) * amount;

const pickVariantIndex = (
  variantCount: number,
  previousIndex: number
) => {
  if (variantCount <= 1) {
    return 0;
  }
  let index = Math.floor(Math.random() * variantCount);
  if (index === previousIndex) {
    index = (index + 1 + Math.floor(Math.random() * (variantCount - 1))) % variantCount;
  }
  return index;
};

type MelodySequenceEntry = [number, number, string, number?];
type BassSequenceEntry = [number, number, string, number?, OscillatorType?];
type NoiseSequenceEntry = [number, number, number?];

const MELODY_VARIANTS: MelodySequenceEntry[][] = [
  [
    [0, 0.5, "C5"],
    [0.5, 0.5, "E5"],
    [1, 0.5, "G5"],
    [1.5, 0.5, "E5"],
    [2, 0.5, "F5"],
    [2.5, 0.5, "A5"],
    [3, 1, "G5", 0.85],
    [4, 0.5, "C5"],
    [4.5, 0.5, "E5"],
    [5, 0.5, "A5"],
    [5.5, 0.5, "G5"],
    [6, 1, "F5", 0.8],
    [7, 1, "E5", 0.7],
  ],
  [
    [0, 0.5, "C5"],
    [0.5, 0.5, "D5", 0.9],
    [1, 0.5, "E5", 0.95],
    [1.5, 0.5, "G5"],
    [2, 0.5, "A5"],
    [2.5, 0.5, "G5", 0.85],
    [3, 1, "E5", 0.9],
    [4, 0.5, "D5"],
    [4.5, 0.5, "F5"],
    [5, 0.5, "A5"],
    [5.5, 0.5, "G5"],
    [6, 0.5, "F5", 0.85],
    [6.5, 0.5, "D5", 0.9],
    [7, 1, "G5", 0.75],
  ],
  [
    [0, 0.5, "C5"],
    [0.5, 0.5, "G5", 0.85],
    [1, 0.5, "A5"],
    [1.5, 0.5, "G5"],
    [2, 0.5, "F5"],
    [2.5, 0.5, "D5"],
    [3, 0.5, "E5", 0.9],
    [3.5, 0.5, "C5"],
    [4, 0.5, "E5"],
    [4.5, 0.5, "G5"],
    [5, 0.5, "B5", 0.85],
    [5.5, 0.5, "A5"],
    [6, 1, "F5", 0.8],
    [7, 1, "E5", 0.75],
  ],
  [
    [0, 0.5, "E5"],
    [0.5, 0.5, "G5"],
    [1, 0.5, "C6", 0.9],
    [1.5, 0.5, "B5"],
    [2, 0.5, "A5"],
    [2.5, 0.5, "F5"],
    [3, 0.5, "G5", 0.85],
    [3.5, 0.5, "E5"],
    [4, 0.5, "C5"],
    [4.5, 0.5, "D5"],
    [5, 0.5, "F5"],
    [5.5, 0.5, "E5"],
    [6, 0.5, "D5", 0.85],
    [6.5, 0.5, "F5", 0.9],
    [7, 1, "G5", 0.8],
  ],
];

const BASS_VARIANTS: BassSequenceEntry[][] = [
  [
    [0, 1, "C3", 0.8],
    [1, 1, "C2", 0.6],
    [2, 1, "F2", 0.8],
    [3, 1, "G2", 0.7],
    [4, 1, "C3", 0.8],
    [5, 1, "C2", 0.6],
    [6, 1, "F2", 0.8],
    [7, 1, "G2", 0.7],
  ],
  [
    [0, 0.5, "C2", 0.7, "square"],
    [0.5, 0.5, "G2", 0.7, "square"],
    [1, 0.5, "C3", 0.85, "square"],
    [1.5, 0.5, "E3", 0.75, "triangle"],
    [2, 0.5, "F2", 0.8, "square"],
    [2.5, 0.5, "C3", 0.75, "triangle"],
    [3, 1, "G2", 0.8, "square"],
    [4, 0.5, "C2", 0.7, "square"],
    [4.5, 0.5, "G2", 0.7, "square"],
    [5, 0.5, "C3", 0.85, "square"],
    [5.5, 0.5, "E3", 0.75, "triangle"],
    [6, 0.5, "F2", 0.8, "square"],
    [6.5, 0.5, "C3", 0.75, "triangle"],
    [7, 1, "G2", 0.8, "square"],
  ],
  [
    [0, 1, "C2", 0.75, "triangle"],
    [1, 0.5, "E2", 0.7, "triangle"],
    [1.5, 0.5, "G2", 0.7, "square"],
    [2, 1, "F2", 0.85, "square"],
    [3, 0.5, "E2", 0.7, "triangle"],
    [3.5, 0.5, "G2", 0.8, "square"],
    [4, 1, "C2", 0.8, "triangle"],
    [5, 0.5, "E2", 0.7, "triangle"],
    [5.5, 0.5, "G2", 0.7, "square"],
    [6, 1, "F2", 0.85, "square"],
    [7, 1, "G2", 0.8, "square"],
  ],
];

const NOISE_VARIANTS: NoiseSequenceEntry[][] = [
  [
    [0, 0.25, 0.7],
    [0.5, 0.25, 0.5],
    [1, 0.25, 0.6],
    [1.5, 0.25, 0.5],
    [2, 0.25, 0.7],
    [2.5, 0.25, 0.5],
    [3, 0.25, 0.8],
    [3.5, 0.25, 0.5],
    [4, 0.25, 0.7],
    [4.5, 0.25, 0.5],
    [5, 0.25, 0.6],
    [5.5, 0.25, 0.5],
    [6, 0.25, 0.7],
    [6.5, 0.25, 0.5],
    [7, 0.25, 0.8],
    [7.5, 0.25, 0.5],
  ],
  [
    [0, 0.2, 0.65],
    [0.5, 0.3, 0.55],
    [1, 0.2, 0.6],
    [1.5, 0.3, 0.5],
    [2, 0.2, 0.7],
    [2.5, 0.2, 0.55],
    [3, 0.3, 0.75],
    [3.5, 0.2, 0.55],
    [4, 0.2, 0.7],
    [4.5, 0.2, 0.55],
    [5, 0.3, 0.6],
    [5.5, 0.2, 0.55],
    [6, 0.2, 0.72],
    [6.5, 0.2, 0.55],
    [7, 0.3, 0.85],
    [7.5, 0.2, 0.55],
  ],
  [
    [0, 0.15, 0.6],
    [0.25, 0.15, 0.5],
    [0.5, 0.15, 0.65],
    [0.75, 0.15, 0.5],
    [1, 0.15, 0.6],
    [1.5, 0.15, 0.55],
    [2, 0.25, 0.7],
    [2.5, 0.15, 0.55],
    [3, 0.25, 0.8],
    [3.75, 0.15, 0.55],
    [4, 0.15, 0.65],
    [4.5, 0.15, 0.55],
    [5, 0.2, 0.6],
    [5.5, 0.15, 0.55],
    [6, 0.2, 0.7],
    [6.5, 0.15, 0.55],
    [7, 0.25, 0.85],
    [7.5, 0.15, 0.55],
  ],
];

export function createChiptuneTheme(): ChiptuneTheme {
  if (typeof window === "undefined") {
    return createNoopTheme();
  }
  const AudioContextConstructor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return createNoopTheme();
  }

  const context = new AudioContextConstructor();
  const masterGain = context.createGain();
  masterGain.gain.value = DEFAULT_VOLUME;
  masterGain.connect(context.destination);

  const melodyGain = context.createGain();
  melodyGain.gain.value = 0.55;
  melodyGain.connect(masterGain);

  const bassGain = context.createGain();
  bassGain.gain.value = 0.38;
  bassGain.connect(masterGain);

  const noiseGain = context.createGain();
  noiseGain.gain.value = 0.12;
  noiseGain.connect(masterGain);

  const noiseWave = createNoiseWave(context);

  let lastMelodyVariantIndex = -1;
  let lastBassVariantIndex = -1;
  let lastNoiseVariantIndex = -1;

  const createMelodyPattern = (): PatternNote[] => {
    const variantIndex = pickVariantIndex(
      MELODY_VARIANTS.length,
      lastMelodyVariantIndex
    );
    lastMelodyVariantIndex = variantIndex;
    const sequence = MELODY_VARIANTS[variantIndex];
    const velocityJitter = 0.05;
    return sequence.map(([time, duration, note, baseVelocity = 1]) => ({
      time,
      duration,
      velocity: clamp(
        jitterValue(baseVelocity * MELODY_VELOCITY_SCALE, velocityJitter),
        0.05,
        0.7
      ),
      frequency: noteToFrequency(note),
      waveform: "triangle",
    }));
  };

  const createBassPattern = (): PatternNote[] => {
    const variantIndex = pickVariantIndex(
      BASS_VARIANTS.length,
      lastBassVariantIndex
    );
    lastBassVariantIndex = variantIndex;
    const sequence = BASS_VARIANTS[variantIndex];
    const velocityJitter = 0.05;
    return sequence.map(
      ([time, duration, note, baseVelocity = 0.8, waveform = "square"]) => ({
        time,
        duration,
        velocity: clamp(
          jitterValue(baseVelocity * BASS_VELOCITY_SCALE, velocityJitter),
          0.04,
          0.6
        ),
        frequency: noteToFrequency(note),
        waveform: waveform === "square" ? "sine" : waveform,
      })
    );
  };

  const createNoisePattern = (): PatternNote[] => {
    const variantIndex = pickVariantIndex(
      NOISE_VARIANTS.length,
      lastNoiseVariantIndex
    );
    lastNoiseVariantIndex = variantIndex;
    const sequence = NOISE_VARIANTS[variantIndex];
    const velocityJitter = 0.04;
    return sequence.map(([time, baseDuration, baseVelocity = 0.6]) => ({
      time,
      duration: clamp(
        jitterValue(baseDuration, baseDuration * 0.1),
        baseDuration * 0.7,
        baseDuration * 1.3
      ),
      velocity: clamp(
        jitterValue(baseVelocity * NOISE_VELOCITY_SCALE, velocityJitter),
        0.02,
        0.45
      ),
      frequency: 180,
      waveform: "custom",
      periodicWave: noiseWave,
    }));
  };

  let isPlaying = false;
  let disposed = false;
  let nextLoopTime = 0;
  let schedulerId: number | null = null;
  const scheduledSources = new Set<ScheduledSource>();

  const stopScheduler = () => {
    if (schedulerId !== null) {
      window.clearTimeout(schedulerId);
      schedulerId = null;
    }
  };

  const cleanupSources = () => {
    for (const source of Array.from(scheduledSources)) {
      try {
        source.oscillator.stop();
      } catch (error) {
        // Ignorer les oscillateurs déjà arrêtés.
      }
      try {
        source.envelope.disconnect();
      } catch (error) {
        /* noop */
      }
      scheduledSources.delete(source);
    }
  };

  const scheduleNote = (
    pattern: PatternNote[],
    gainNode: GainNode,
    loopStart: number
  ) => {
    for (const note of pattern) {
      const startTime = loopStart + note.time * BEAT_DURATION;
      const durationSeconds = Math.max(0.05, note.duration * BEAT_DURATION);
      const attackTime = Math.min(ATTACK, durationSeconds / 2);
      const releaseTime = Math.min(RELEASE, durationSeconds / 2);
      const peakTime = startTime + attackTime;
      const releaseStart = startTime + durationSeconds - releaseTime;
      const stopTime = startTime + durationSeconds + 0.02;

      const oscillator = context.createOscillator();
      if (note.periodicWave) {
        oscillator.setPeriodicWave(note.periodicWave);
      } else if (note.waveform) {
        oscillator.type = note.waveform;
      }
      oscillator.frequency.setValueAtTime(note.frequency, startTime);

      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, startTime);
      envelope.gain.linearRampToValueAtTime(note.velocity, peakTime);
      envelope.gain.setValueAtTime(note.velocity, releaseStart);
      envelope.gain.linearRampToValueAtTime(0.0001, startTime + durationSeconds);

      oscillator.connect(envelope);
      envelope.connect(gainNode);

      const scheduled: ScheduledSource = { oscillator, envelope };
      scheduledSources.add(scheduled);

      oscillator.onended = () => {
        try {
          envelope.disconnect();
        } catch (error) {
          /* noop */
        }
        scheduledSources.delete(scheduled);
      };

      oscillator.start(startTime);
      oscillator.stop(stopTime);
    }
  };

  const scheduleLoop = (loopStart: number) => {
    scheduleNote(createMelodyPattern(), melodyGain, loopStart);
    scheduleNote(createBassPattern(), bassGain, loopStart);
    scheduleNote(createNoisePattern(), noiseGain, loopStart);
  };

  const scheduler = () => {
    if (!isPlaying || disposed) {
      return;
    }
    const currentTime = context.currentTime;
    while (nextLoopTime < currentTime + LOOKAHEAD_SECONDS) {
      scheduleLoop(nextLoopTime);
      nextLoopTime += LOOP_BEATS * BEAT_DURATION;
    }
    schedulerId = window.setTimeout(scheduler, SCHEDULER_INTERVAL_MS);
  };

  const start = async () => {
    if (disposed || isPlaying) {
      return;
    }
    try {
      await context.resume();
    } catch (error) {
      return;
    }
    isPlaying = true;
    nextLoopTime = context.currentTime + 0.05;
    scheduleLoop(nextLoopTime);
    nextLoopTime += LOOP_BEATS * BEAT_DURATION;
    schedulerId = window.setTimeout(scheduler, SCHEDULER_INTERVAL_MS);
  };

  const stop = async () => {
    if (!isPlaying || disposed) {
      return;
    }
    isPlaying = false;
    stopScheduler();
    cleanupSources();
    try {
      if (context.state !== "suspended") {
        await context.suspend();
      }
    } catch (error) {
      /* noop */
    }
  };

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    stopScheduler();
    cleanupSources();
    melodyGain.disconnect();
    bassGain.disconnect();
    noiseGain.disconnect();
    masterGain.disconnect();
    void context.close().catch(() => {
      /* noop */
    });
  };

  return {
    isSupported: true,
    start,
    stop,
    dispose,
  };
}
