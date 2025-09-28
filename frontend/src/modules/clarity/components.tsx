import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { CLARITY_TIPS, DIRECTION_LABELS, GRID_SIZE, START_POSITION } from "./constants";
import { formatDuration } from "./utils";
import type { ClientStats, GridCoord, PlanAction } from "./types";
import { SpriteFromAtlas, atlas } from "./atlas";

const GROUND_TILE = atlas("mapTile_022.png");
const VISITED_TILE = atlas("mapTile_128.png");
const BLOCK_TILE = atlas("mapTile_039.png");
const GOAL_TILE = atlas("mapTile_100.png");
const PLAYER_TILE = atlas("mapTile_136.png");

function TileLayer({
  tile,
  tileSize,
  className,
  style,
}: {
  tile: ReturnType<typeof atlas>;
  tileSize: number;
  className?: string;
  style?: CSSProperties;
}): JSX.Element | null {
  if (tileSize <= 0) {
    return null;
  }

  const classes = className
    ? `pointer-events-none absolute inset-0 flex items-center justify-center ${className}`
    : "pointer-events-none absolute inset-0 flex items-center justify-center";

  return (
    <div className={classes} style={style}>
      <SpriteFromAtlas coord={tile} scale={tileSize} />
    </div>
  );
}

export interface ClarityGridProps {
  player: GridCoord;
  target: GridCoord;
  blocked: GridCoord[];
  visited: Set<string>;
}

export function ClarityGrid({ player, target, blocked, visited }: ClarityGridProps): JSX.Element {
  const blockedSet = useMemo(() => new Set(blocked.map((cell) => `${cell.x}-${cell.y}`)), [blocked]);
  const axis = useMemo(() => Array.from({ length: GRID_SIZE }, (_, index) => index), []);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridExtent, setGridExtent] = useState(0);
  const tileSize = gridExtent > 0 ? gridExtent / GRID_SIZE : 0;

  useEffect(() => {
    const gridElement = gridRef.current;
    if (!gridElement) {
      return;
    }

    const measureExtent = () => {
      const gridRect = gridElement.getBoundingClientRect();
      if (gridRect.width <= 0 || gridRect.height <= 0) {
        return;
      }
      setGridExtent(gridRect.width);
    };

    measureExtent();

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => measureExtent();
      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }

    const observer = new ResizeObserver(() => {
      measureExtent();
    });
    observer.observe(gridElement);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div className="grid grid-cols-[auto,1fr] grid-rows-[1fr,auto] items-start gap-x-2 gap-y-2 sm:gap-x-3 sm:gap-y-3 md:gap-x-4 md:gap-y-4">
        <div
          className="grid grid-rows-10 justify-items-end text-[11px] font-semibold text-[color:var(--brand-charcoal)]/70 md:text-xs"
          style={{
            height: gridExtent > 0 ? gridExtent : undefined,
            gridTemplateRows:
              tileSize > 0 ? `repeat(${GRID_SIZE}, ${tileSize}px)` : undefined,
          }}
        >
          {axis.map((value) => (
            <span key={`row-${value}`} className="flex h-full w-full items-center justify-end">
              {value}
            </span>
          ))}
        </div>
        <div className="relative flex justify-center">
          <div
            className="relative w-full max-w-[400px] rounded-3xl border border-white/60 bg-gradient-to-br from-sky-100/70 via-white/80 to-slate-100/70 p-2 shadow-inner"
            style={{
              width: "clamp(180px, calc(100vw - 120px), 400px)",
              height: "clamp(180px, calc(100vw - 120px), 400px)",
            }}
          >
            <div
              ref={gridRef}
              className="relative grid h-full w-full grid-cols-10 grid-rows-10 overflow-hidden rounded-2xl bg-slate-50/40"
            >
              {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => {
                const x = index % GRID_SIZE;
                const y = Math.floor(index / GRID_SIZE);
                const key = `${x}-${y}`;
                const isStart = x === START_POSITION.x && y === START_POSITION.y;
                const isVisited = visited.has(key) && !isStart;
                const isTarget = x === target.x && y === target.y;
                const isBlocked = blockedSet.has(key);
                const hasPlayer = x === player.x && y === player.y;

                return (
                  <div key={key} className="relative">
                    <TileLayer tile={GROUND_TILE} tileSize={tileSize} />
                    {isVisited && (
                      <TileLayer tile={VISITED_TILE} tileSize={tileSize} className="opacity-80" />
                    )}
                    {isBlocked && (
                      <TileLayer
                        tile={BLOCK_TILE}
                        tileSize={tileSize}
                        className="z-[3] drop-shadow-[0_4px_6px_rgba(15,23,42,0.25)]"
                        style={{ transform: "scale(0.85)" }}
                      />
                    )}
                    {isTarget && (
                      <TileLayer
                        tile={GOAL_TILE}
                        tileSize={tileSize}
                        className="z-[4] drop-shadow-[0_4px_8px_rgba(220,38,38,0.25)]"
                        style={{ transform: "scale(0.82)" }}
                      />
                    )}
                    {hasPlayer && (
                      <TileLayer
                        tile={PLAYER_TILE}
                        tileSize={tileSize}
                        className="z-[6] animate-[float_1.4s_ease-in-out_infinite]"
                        style={{ transform: "scale(0.88)" }}
                      />
                    )}
                    <div className="pointer-events-none absolute inset-0 rounded-xl border border-white/40" />
                  </div>
                );
              })}
              <div
                className="clarity-grid-overlay"
                style={tileSize > 0 ? { backgroundSize: `${tileSize}px ${tileSize}px` } : undefined}
              />
            </div>
          </div>
        </div>
        <div aria-hidden />
        <div
          className="mx-auto grid grid-cols-10 justify-items-center text-[11px] font-semibold text-[color:var(--brand-charcoal)]/70 md:text-xs"
          style={{
            width: gridExtent > 0 ? gridExtent : undefined,
            gridTemplateColumns:
              tileSize > 0 ? `repeat(${GRID_SIZE}, ${tileSize}px)` : undefined,
          }}
        >
          {axis.map((value) => (
            <span key={`col-${value}`} className="flex h-full w-full items-center justify-center">
              {value}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface PlanPreviewProps {
  plan: PlanAction[];
  notes: string;
  placeholderMessage?: string;
  showPlaceholder?: boolean;
}

export function PlanPreview({
  plan,
  notes,
  placeholderMessage = "Le plan validé apparaîtra ici dès que le backend aura converti ta consigne.",
  showPlaceholder = true,
}: PlanPreviewProps): JSX.Element {
  if (!plan.length && !notes) {
    return (
      <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Plan</h3>
        {showPlaceholder && placeholderMessage.trim().length > 0 ? (
          <p className="mt-2 text-sm text-[color:var(--brand-charcoal)]/80">{placeholderMessage}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Plan validé</h3>
      <ol className="mt-4 space-y-2 text-sm text-[color:var(--brand-charcoal)]">
        {plan.map((action, index) => (
          <li key={`${action.dir}-${index}`} className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-xs font-semibold text-[color:var(--brand-red)]">
              {index + 1}
            </span>
            <span>
              {DIRECTION_LABELS[action.dir]} · {action.steps} pas
            </span>
          </li>
        ))}
      </ol>
      {notes && (
        <p className="mt-4 rounded-2xl bg-[color:var(--brand-yellow)]/30 p-3 text-xs text-[color:var(--brand-charcoal)]">
          Hypothèse du modèle : {notes}
        </p>
      )}
    </div>
  );
}

export function ClarityTipsPanel(): JSX.Element {
  return (
    <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Conseils de clarté</h3>
      <ul className="mt-4 space-y-3 text-sm text-[color:var(--brand-charcoal)]">
        {CLARITY_TIPS.map((tip) => (
          <li key={tip} className="flex items-start gap-3">
            <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
              ✶
            </span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface StatsModalProps {
  stats: ClientStats;
  summary: string;
  onReplay: () => void;
  onShuffle: () => void;
  onExit: () => void;
  onComplete: () => void;
  isCompleting: boolean;
}

export function StatsModal({
  stats,
  summary,
  onReplay,
  onShuffle,
  onExit,
  onComplete,
  isCompleting,
}: StatsModalProps): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/60 bg-white/95 p-8 shadow-2xl">
        <div>
          <h3 className="text-2xl font-semibold text-[color:var(--brand-black)]">🎉 Bilan de la manche</h3>
          <p className="mt-2 whitespace-pre-line text-sm text-[color:var(--brand-charcoal)]">{summary}</p>
          {stats.ambiguity && (
            <p className="mt-3 rounded-2xl bg-[color:var(--brand-yellow)]/40 p-3 text-xs text-[color:var(--brand-charcoal)]">
              Hypothèse détectée : {stats.ambiguity}
            </p>
          )}
        </div>
        <ul className="mt-6 grid gap-3 text-sm text-[color:var(--brand-charcoal)] md:grid-cols-2">
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Tentatives :</strong> {stats.attempts}
          </li>
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Pas effectués :</strong> {stats.stepsExecuted}
          </li>
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Chemin optimal :</strong> {stats.optimalPathLength ?? "–"}
          </li>
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Surcoût :</strong> {typeof stats.surcout === "number" ? `${stats.surcout > 0 ? "+" : ""}${stats.surcout}` : "–"}
          </li>
          <li className="rounded-2xl bg-white/80 p-3 shadow-sm">
            <strong className="text-[color:var(--brand-black)]">Temps de résolution :</strong> {formatDuration(stats.durationMs)}
          </li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="cta-button cta-button--primary inline-flex items-center gap-2"
            onClick={onComplete}
            disabled={isCompleting}
          >
            {isCompleting ? "Redirection…" : "Terminer l’activité"}
          </button>
          <button
            type="button"
            className="cta-button inline-flex items-center gap-2 border border-white/60 bg-white/80 text-[color:var(--brand-charcoal)] hover:bg-white"
            onClick={onReplay}
            disabled={isCompleting}
          >
            Rejouer (nouvel objet)
          </button>
          <button
            type="button"
            className="cta-button inline-flex items-center gap-2 border border-[color:var(--brand-red)]/30 bg-white/80 text-[color:var(--brand-red)] hover:bg-white"
            onClick={onShuffle}
            disabled={isCompleting}
          >
            Changer les obstacles
          </button>
          <button
            type="button"
            className="cta-button inline-flex items-center gap-2 border border-white/60 bg-white/80 text-[color:var(--brand-charcoal)] hover:bg-white"
            onClick={onExit}
            disabled={isCompleting}
          >
            Retour à l’intro
          </button>
        </div>
      </div>
    </div>
  );
}
