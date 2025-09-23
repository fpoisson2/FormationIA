export interface ChiptuneTheme {
  readonly isSupported: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
}

const DEFAULT_VOLUME = 0.35;
const TEMPO = 120;
const BEAT_DURATION = 60 / TEMPO;
const LOOP_BEATS = 8;
const LOOKAHEAD_SECONDS = 0.25;
const SCHEDULER_INTERVAL_MS = 90;
const ATTACK = 0.01;
const RELEASE = 0.08;

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
    real[i] = value;
    imag[i] = value * 0.6;
  }
  return context.createPeriodicWave(real, imag, { disableNormalization: true });
}

function createMelodyPattern(): PatternNote[] {
  const sequence: Array<[number, number, string, number?]> = [
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
  ];

  return sequence.map(([time, duration, note, velocity = 1]) => ({
    time,
    duration,
    velocity,
    frequency: noteToFrequency(note),
    waveform: "square",
  }));
}

function createBassPattern(): PatternNote[] {
  const sequence: Array<[number, number, string, number?]> = [
    [0, 1, "C3", 0.8],
    [1, 1, "C2", 0.6],
    [2, 1, "F2", 0.8],
    [3, 1, "G2", 0.7],
    [4, 1, "C3", 0.8],
    [5, 1, "C2", 0.6],
    [6, 1, "F2", 0.8],
    [7, 1, "G2", 0.7],
  ];

  return sequence.map(([time, duration, note, velocity = 1]) => ({
    time,
    duration,
    velocity,
    frequency: noteToFrequency(note),
    waveform: "square",
  }));
}

function createNoisePattern(noiseWave: PeriodicWave): PatternNote[] {
  const sequence: Array<[number, number, number?]> = [
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
  ];

  return sequence.map(([time, duration, velocity = 0.6]) => ({
    time,
    duration,
    velocity,
    frequency: 220,
    waveform: "custom",
    periodicWave: noiseWave,
  }));
}

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
  melodyGain.gain.value = 0.8;
  melodyGain.connect(masterGain);

  const bassGain = context.createGain();
  bassGain.gain.value = 0.55;
  bassGain.connect(masterGain);

  const noiseGain = context.createGain();
  noiseGain.gain.value = 0.25;
  noiseGain.connect(masterGain);

  const noiseWave = createNoiseWave(context);

  const melodyPattern = createMelodyPattern();
  const bassPattern = createBassPattern();
  const noisePattern = createNoisePattern(noiseWave);

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
    scheduleNote(melodyPattern, melodyGain, loopStart);
    scheduleNote(bassPattern, bassGain, loopStart);
    scheduleNote(noisePattern, noiseGain, loopStart);
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
