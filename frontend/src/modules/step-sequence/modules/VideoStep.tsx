import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type Hls from "hls.js";

import type { StepComponentProps } from "../types";
import { StepSequenceContext } from "../types";

export type VideoSourceType = "mp4" | "hls" | "youtube";

export interface VideoSource {
  type: VideoSourceType;
  url: string;
}

export interface VideoCaption {
  src: string;
  srclang?: string;
  label?: string;
  default?: boolean;
}

export interface VideoStepContent {
  sources: VideoSource[];
  poster?: string;
  captions?: VideoCaption[];
  autoAdvanceOnEnd?: boolean;
  expectedDuration?: number;
}

export interface VideoStepConfig extends VideoStepContent {
  onChange?: (content: VideoStepContent) => void;
}

const EMPTY_CONTENT: VideoStepContent = {
  sources: [],
  captions: [],
  autoAdvanceOnEnd: false,
  expectedDuration: undefined,
};

type HlsModule = {
  default?: typeof Hls;
  Hls?: typeof Hls;
};

let cachedHlsConstructor: typeof Hls | null | undefined;

async function loadHlsConstructor(): Promise<typeof Hls | null> {
  if (cachedHlsConstructor !== undefined) {
    return cachedHlsConstructor;
  }

  if (typeof window === "undefined") {
    cachedHlsConstructor = null;
    return cachedHlsConstructor;
  }

  const attemptImport = async (
    loader: () => Promise<HlsModule>
  ): Promise<typeof Hls | null> => {
    try {
      const module = await loader();
      const constructor = module.default ?? module.Hls;
      return typeof constructor === "function" ? constructor : null;
    } catch (error) {
      return null;
    }
  };

  const loaderCandidates: Array<() => Promise<HlsModule>> = [
    () => import("hls.js/dist/hls.mjs") as Promise<HlsModule>,
    () => import("hls.js") as Promise<HlsModule>,
  ];

  for (const loader of loaderCandidates) {
    const constructor = await attemptImport(loader);
    if (constructor) {
      cachedHlsConstructor = constructor;
      return cachedHlsConstructor;
    }
  }

  cachedHlsConstructor = null;
  return cachedHlsConstructor;
}

function sanitizeSources(sources: unknown): VideoSource[] {
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const source = item as Partial<VideoSource>;
      const url = typeof source.url === "string" ? source.url.trim() : "";
      const type: VideoSourceType =
        source.type === "hls"
          ? "hls"
          : source.type === "youtube"
          ? "youtube"
          : "mp4";
      if (!url) {
        return undefined;
      }
      return { type, url } satisfies VideoSource;
    })
    .filter((item): item is VideoSource => Boolean(item));
}

function sanitizeCaptions(captions: unknown): VideoCaption[] {
  if (!Array.isArray(captions)) {
    return [];
  }
  return captions
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const caption = item as Partial<VideoCaption>;
      const src = typeof caption.src === "string" ? caption.src.trim() : "";
      if (!src) {
        return undefined;
      }
      return {
        src,
        srclang:
          typeof caption.srclang === "string" && caption.srclang
            ? caption.srclang
            : undefined,
        label:
          typeof caption.label === "string" && caption.label
            ? caption.label
            : undefined,
        default: Boolean(caption.default),
      } satisfies VideoCaption;
    })
    .filter((item): item is VideoCaption => Boolean(item));
}

interface ParsedYouTubeUrl {
  videoId: string;
  sourceUrl: URL;
}

const YOUTUBE_ALLOWED_PASSTHROUGH_PARAMS = new Set([
  "si",
  "pp",
  "feature",
  "widget_referrer",
  "iv_load_policy",
  "disablekb",
  "fs",
  "color",
  "hl",
  "cc_lang_pref",
  "cc_load_policy",
  "vq",
  "autoplay",
  "mute",
  "controls",
  "showinfo",
  "origin",
  "enablejsapi",
]);

function parseYouTubeUrl(url: string): ParsedYouTubeUrl | null {
  if (!url) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    return null;
  }

  const normalizedHost = parsedUrl.hostname
    .replace(/^www\./u, "")
    .replace(/^m\./u, "")
    .toLowerCase();

  let videoId = "";
  if (normalizedHost === "youtu.be") {
    videoId = parsedUrl.pathname.replace(/^\//u, "").split("/")[0] ?? "";
  } else if (
    normalizedHost === "youtube.com" ||
    normalizedHost === "youtube-nocookie.com" ||
    normalizedHost.endsWith(".youtube.com")
  ) {
    if (parsedUrl.pathname === "/watch") {
      videoId = parsedUrl.searchParams.get("v") ?? "";
    } else if (parsedUrl.pathname.startsWith("/embed/")) {
      videoId = parsedUrl.pathname.split("/")[2] ?? "";
    } else if (parsedUrl.pathname.startsWith("/shorts/")) {
      videoId = parsedUrl.pathname.split("/")[2] ?? "";
    } else if (parsedUrl.pathname.startsWith("/live/")) {
      videoId = parsedUrl.pathname.split("/")[2] ?? "";
    }
  }

  const trimmedId = videoId.trim();
  if (!trimmedId) {
    return null;
  }

  if (!/^[a-zA-Z0-9_-]{6,}$/u.test(trimmedId)) {
    return null;
  }

  return { videoId: trimmedId, sourceUrl: parsedUrl };
}

function parseYouTubeTimeValue(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/u.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const timeMatch = trimmed.match(
    /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/iu
  );
  if (!timeMatch) {
    return null;
  }

  const hours = timeMatch[1] ? Number.parseInt(timeMatch[1], 10) : 0;
  const minutes = timeMatch[2] ? Number.parseInt(timeMatch[2], 10) : 0;
  const seconds = timeMatch[3] ? Number.parseInt(timeMatch[3], 10) : 0;
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  return totalSeconds > 0 ? totalSeconds : null;
}

const YOUTUBE_RESERVED_PARAMS = new Set([
  "start",
  "t",
  "end",
  "list",
  "index",
  "playlist",
  "loop",
  "playsinline",
  "rel",
  "modestbranding",
]);

interface BuildYouTubeEmbedOptions {
  origin?: string | null;
}

function getYouTubeEmbedUrl(
  url: string,
  options?: BuildYouTubeEmbedOptions
): string | null {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) {
    return null;
  }

  const { videoId, sourceUrl } = parsed;
  const embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
  embedUrl.searchParams.set("rel", "0");
  embedUrl.searchParams.set("playsinline", "1");
  embedUrl.searchParams.set("modestbranding", "1");

  const startFromStartParam = parseYouTubeTimeValue(
    sourceUrl.searchParams.get("start")
  );
  const startFromTParam = parseYouTubeTimeValue(
    sourceUrl.searchParams.get("t")
  );
  const startTime = startFromStartParam ?? startFromTParam;
  if (startTime != null) {
    embedUrl.searchParams.set("start", startTime.toString());
  }

  const endTime = parseYouTubeTimeValue(sourceUrl.searchParams.get("end"));
  if (endTime != null) {
    embedUrl.searchParams.set("end", endTime.toString());
  }

  const listParam = sourceUrl.searchParams.get("list");
  if (listParam) {
    embedUrl.searchParams.set("list", listParam);
  }

  const indexParam = sourceUrl.searchParams.get("index");
  if (indexParam && /^\d+$/u.test(indexParam)) {
    embedUrl.searchParams.set("index", indexParam);
  }

  const playlistParam = sourceUrl.searchParams.get("playlist");
  if (playlistParam) {
    embedUrl.searchParams.set("playlist", playlistParam);
  }

  const loopParam = sourceUrl.searchParams.get("loop");
  if (loopParam === "1" || loopParam?.toLowerCase() === "true") {
    embedUrl.searchParams.set("loop", "1");
    if (!embedUrl.searchParams.has("playlist")) {
      embedUrl.searchParams.set("playlist", videoId);
    }
  }

  if (options?.origin) {
    embedUrl.searchParams.set("origin", options.origin);
  }

  sourceUrl.searchParams.forEach((value, key) => {
    if (!value) {
      return;
    }
    if (YOUTUBE_RESERVED_PARAMS.has(key)) {
      return;
    }
    if (!YOUTUBE_ALLOWED_PASSTHROUGH_PARAMS.has(key)) {
      return;
    }
    if (key === "origin" && options?.origin) {
      return;
    }
    embedUrl.searchParams.set(key, value);
  });

  return embedUrl.toString();
}

function formatExpectedDuration(duration?: number): string | null {
  if (typeof duration !== "number" || Number.isNaN(duration) || duration < 0) {
    return null;
  }

  if (duration < 60) {
    const rounded = Math.round(duration);
    return `${rounded} seconde${rounded > 1 ? "s" : ""}`;
  }

  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds.toString().padStart(2, "0");
  return `${minutes} min ${paddedSeconds} s`;
}

export function VideoStep({
  config,
  isActive,
  isEditMode,
  onAdvance,
  onUpdateConfig,
}: StepComponentProps): JSX.Element {
  const context = useContext(StepSequenceContext);
  const isEditModeFromContext = context?.isEditMode ?? isEditMode;
  const effectiveOnAdvance = context?.onAdvance ?? onAdvance;
  const effectiveOnUpdateConfig = context?.onUpdateConfig ?? onUpdateConfig;

  const typedConfig = useMemo<VideoStepConfig>(() => {
    if (!config || typeof config !== "object") {
      return { ...EMPTY_CONTENT };
    }

    const base = config as VideoStepConfig;
    const expectedDuration =
      typeof base.expectedDuration === "number" &&
      Number.isFinite(base.expectedDuration)
        ? base.expectedDuration
        : undefined;

    const poster =
      typeof base.poster === "string"
        ? base.poster
        : base.poster == null
        ? undefined
        : String(base.poster);

    return {
      sources: sanitizeSources(base.sources),
      poster,
      captions: sanitizeCaptions(base.captions),
      autoAdvanceOnEnd: Boolean(base.autoAdvanceOnEnd),
      expectedDuration,
      onChange: base.onChange,
    };
  }, [config]);

  const { onChange, ...content } = typedConfig;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [autoplayFailed, setAutoplayFailed] = useState(false);
  const [clientOrigin, setClientOrigin] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const { origin } = window.location;
      if (origin && origin !== "null") {
        setClientOrigin(origin);
      }
    } catch (error) {
      setClientOrigin(null);
    }
  }, []);

  const notifyChange = useCallback(
    (nextContent: VideoStepContent) => {
      onChange?.(nextContent);
      effectiveOnUpdateConfig({ ...nextContent, onChange });
    },
    [effectiveOnUpdateConfig, onChange]
  );

  const hlsSource = useMemo(
    () => content.sources.find((source) => source.type === "hls"),
    [content.sources]
  );
  const mp4Sources = useMemo(
    () => content.sources.filter((source) => source.type === "mp4"),
    [content.sources]
  );
  const youtubeSource = useMemo(
    () => content.sources.find((source) => source.type === "youtube"),
    [content.sources]
  );
  const youtubeSourceUrl = youtubeSource?.url ?? "";
  const youtubeEmbedUrl = useMemo(
    () => getYouTubeEmbedUrl(youtubeSourceUrl, { origin: clientOrigin }),
    [clientOrigin, youtubeSourceUrl]
  );
  const mp4Signature = useMemo(
    () => mp4Sources.map((source) => source.url).join("|"),
    [mp4Sources]
  );

  const sourceSignature = useMemo(
    () =>
      content.sources
        .map((source) => `${source.type}:${source.url}`)
        .join("|"),
    [content.sources]
  );

  useEffect(() => {
    if (youtubeEmbedUrl) {
      return undefined;
    }

    const video = videoRef.current;
    if (!video) {
      return undefined;
    }

    if (!hlsSource) {
      if (typeof video.load === "function") {
        video.load();
      }
      return undefined;
    }

    let isUnmounted = false;
    let hlsInstance: Hls | undefined;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsSource.url;
      if (typeof video.load === "function") {
        video.load();
      }
      return () => {
        video.removeAttribute("src");
        if (typeof video.load === "function") {
          video.load();
        }
      };
    }

    void (async () => {
      const HlsConstructor = await loadHlsConstructor();
      if (isUnmounted) {
        return;
      }
      if (HlsConstructor && HlsConstructor.isSupported()) {
        hlsInstance = new HlsConstructor();
        hlsInstance.loadSource(hlsSource.url);
        hlsInstance.attachMedia(video);
      } else {
        video.src = hlsSource.url;
        if (typeof video.load === "function") {
          video.load();
        }
      }
    })();

    return () => {
      isUnmounted = true;
      hlsInstance?.destroy();
      hlsInstance = undefined;
      video.removeAttribute("src");
      if (typeof video.load === "function") {
        video.load();
      }
    };
  }, [hlsSource, mp4Signature, youtubeEmbedUrl]);

  useEffect(() => {
    if (youtubeEmbedUrl) {
      setAutoplayFailed(false);
      return;
    }

    const video = videoRef.current;
    if (!video || isEditModeFromContext) {
      return;
    }

    if (!isActive || (!hlsSource && mp4Sources.length === 0)) {
      return;
    }

    let cancelled = false;

    const attemptPlay = () => {
      if (!videoRef.current || cancelled) {
        return;
      }
      if (typeof videoRef.current.play !== "function") {
        return;
      }
      try {
        const playResult = videoRef.current.play();
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => {
            if (!cancelled) {
              setAutoplayFailed(true);
            }
          });
        }
      } catch (error) {
        if (!cancelled) {
          setAutoplayFailed(true);
        }
      }
    };

    const startPlayback = () => {
      setAutoplayFailed(false);
      attemptPlay();
    };

    if (video.readyState >= 2) {
      startPlayback();
    } else {
      const handleLoadedData = () => {
        startPlayback();
      };
      video.addEventListener("loadeddata", handleLoadedData, { once: true });
      return () => {
        cancelled = true;
        video.removeEventListener("loadeddata", handleLoadedData);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [
    hlsSource,
    isActive,
    isEditModeFromContext,
    mp4Sources.length,
    sourceSignature,
    youtubeEmbedUrl,
  ]);

  useEffect(() => {
    if (youtubeEmbedUrl) {
      setAutoplayFailed(false);
      return;
    }

    if (!isActive || isEditModeFromContext) {
      setAutoplayFailed(false);
    }
  }, [isActive, isEditModeFromContext, sourceSignature, youtubeEmbedUrl]);

  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (!video || typeof video.pause !== "function") {
        return;
      }
      video.pause();
    };
  }, []);

  const handleSourceChange = useCallback(
    (type: VideoSourceType) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value.trim();
        const remainingSources = content.sources.filter(
          (source) => source.type !== type
        );
        const nextSources = value
          ? [...remainingSources, { type, url: value }]
          : remainingSources;
        notifyChange({
          ...content,
          sources: sanitizeSources(nextSources),
        });
      },
    [content, notifyChange]
  );

  const handlePosterChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value.trim();
      notifyChange({
        ...content,
        poster: value || undefined,
      });
    },
    [content, notifyChange]
  );

  const handleAutoAdvanceChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      notifyChange({
        ...content,
        autoAdvanceOnEnd: event.target.checked,
      });
    },
    [content, notifyChange]
  );

  const handleExpectedDurationChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      const numericValue = Number.parseFloat(value);
      notifyChange({
        ...content,
        expectedDuration:
          value === "" || Number.isNaN(numericValue) || numericValue < 0
            ? undefined
            : numericValue,
      });
    },
    [content, notifyChange]
  );

  const handleContinueClick = useCallback(
    (event: FormEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setAutoplayFailed(false);
      effectiveOnAdvance();
    },
    [effectiveOnAdvance]
  );

  const mp4SourceValue = useMemo(() => mp4Sources[0]?.url ?? "", [mp4Sources]);
  const hlsSourceValue = hlsSource?.url ?? "";
  const youtubeSourceValue = youtubeSource?.url ?? "";
  const hasVideoElementSource =
    !youtubeEmbedUrl && (mp4Sources.length > 0 || Boolean(hlsSource));
  const isAutoAdvanceSupported = !youtubeEmbedUrl;
  const showYouTubeError = Boolean(youtubeSource) && !youtubeEmbedUrl;

  const handleVideoEnded = useCallback(() => {
    if (
      !isEditModeFromContext &&
      content.autoAdvanceOnEnd &&
      isAutoAdvanceSupported
    ) {
      effectiveOnAdvance();
    }
  }, [
    content.autoAdvanceOnEnd,
    effectiveOnAdvance,
    isAutoAdvanceSupported,
    isEditModeFromContext,
  ]);

  const handleVideoPlay = useCallback(() => {
    setAutoplayFailed(false);
  }, []);

  const expectedDurationLabel = useMemo(
    () => formatExpectedDuration(content.expectedDuration),
    [content.expectedDuration]
  );

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">Vidéo</h2>
          {expectedDurationLabel ? (
            <p className="text-sm text-slate-600">
              Durée attendue : {expectedDurationLabel}
            </p>
          ) : null}
        </header>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          {youtubeEmbedUrl ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
              <iframe
                key={youtubeEmbedUrl}
                className="absolute left-0 top-0 h-full w-full"
                src={youtubeEmbedUrl}
                title="Vidéo YouTube"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          ) : hasVideoElementSource ? (
            <video
              ref={videoRef}
              className="h-auto w-full rounded-md bg-black"
              controls
              playsInline
              poster={content.poster}
              onEnded={handleVideoEnded}
              onPlay={handleVideoPlay}
            >
              {mp4Sources.map((source) => (
                <source key={source.url} src={source.url} type="video/mp4" />
              ))}
              {(content.captions ?? []).map((caption, index) => (
                <track
                  key={`${caption.src}-${index}`}
                  src={caption.src}
                  kind="subtitles"
                  label={caption.label}
                  srcLang={caption.srclang}
                  default={caption.default}
                />
              ))}
              Votre navigateur ne supporte pas la lecture de vidéos.
            </video>
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              {showYouTubeError
                ? "Impossible d’interpréter l’URL YouTube fournie. Vérifiez qu’elle est correcte."
                : "Ajoutez une source vidéo pour commencer la lecture."}
            </div>
          )}
        </div>
        {autoplayFailed && !youtubeEmbedUrl ? (
          <div className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <span>
              La lecture automatique est bloquée par le navigateur.
            </span>
            <button
              type="button"
              className="rounded-md bg-amber-600 px-3 py-1 text-white"
              onClick={handleContinueClick}
            >
              Continuer
            </button>
          </div>
        ) : null}
      </section>

      {isEditModeFromContext ? (
        <section className="space-y-4 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h3 className="text-base font-medium text-slate-900">
            Paramètres de la vidéo
          </h3>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">URL MP4</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              placeholder="https://cdn.example.com/video.mp4"
              value={mp4SourceValue}
              onChange={handleSourceChange("mp4")}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">URL YouTube</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              placeholder="https://www.youtube.com/watch?v=abcdefghijk"
              value={youtubeSourceValue}
              onChange={handleSourceChange("youtube")}
            />
            <span className="block text-xs text-slate-500">
              Les liens « watch », youtu.be, shorts ou embed sont pris en charge.
            </span>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">URL HLS</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              placeholder="https://cdn.example.com/playlist.m3u8"
              value={hlsSourceValue}
              onChange={handleSourceChange("hls")}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Poster</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              placeholder="https://cdn.example.com/poster.jpg"
              value={content.poster ?? ""}
              onChange={handlePosterChange}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={content.autoAdvanceOnEnd ?? false}
              onChange={handleAutoAdvanceChange}
              disabled={!isAutoAdvanceSupported}
            />
            <span>Passer automatiquement à l’étape suivante en fin de vidéo</span>
          </label>
          {!isAutoAdvanceSupported ? (
            <p className="text-xs text-slate-500">
              L’avance automatique n’est pas disponible pour les vidéos YouTube.
            </p>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">
              Durée attendue (secondes)
            </span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              type="number"
              min="0"
              step="1"
              value={
                typeof content.expectedDuration === "number"
                  ? String(content.expectedDuration)
                  : ""
              }
              onChange={handleExpectedDurationChange}
            />
          </label>
        </section>
      ) : null}
    </div>
  );
}
