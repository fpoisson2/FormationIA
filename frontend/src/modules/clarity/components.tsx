import { useMemo } from "react";

import castleTile from "../../assets/kenney_map-pack/PNG/mapTile_100.png";
import explorerToken from "../../assets/kenney_map-pack/PNG/mapTile_136.png";
import grassTile from "../../assets/kenney_map-pack/PNG/mapTile_022.png";
import startMarkerTile from "../../assets/kenney_map-pack/PNG/mapTile_179.png";
import treeTile from "../../assets/kenney_map-pack/PNG/mapTile_115.png";
import waterTile from "../../assets/kenney_map-pack/PNG/mapTile_188.png";
import coastBottomEdgeTile from "../../assets/kenney_map-pack/PNG/mapTile_176.png";
import coastBottomLeftTile from "../../assets/kenney_map-pack/PNG/mapTile_172.png";
import coastBottomRightTile from "../../assets/kenney_map-pack/PNG/mapTile_173.png";
import coastLeftEdgeTile from "../../assets/kenney_map-pack/PNG/mapTile_177.png";
import coastRightEdgeTile from "../../assets/kenney_map-pack/PNG/mapTile_178.png";
import coastTopEdgeTile from "../../assets/kenney_map-pack/PNG/mapTile_159.png";
import coastTopLeftTile from "../../assets/kenney_map-pack/PNG/mapTile_155.png";
import coastTopRightTile from "../../assets/kenney_map-pack/PNG/mapTile_156.png";
import { CLARITY_TIPS, DIRECTION_LABELS, GRID_SIZE, START_POSITION } from "./constants";
import { formatDuration } from "./utils";
import type { ClientStats, GridCoord, PlanAction } from "./types";

export interface ClarityGridProps {
  player: GridCoord;
  target: GridCoord;
  blocked: GridCoord[];
  visited: Set<string>;
}

function resolveBorderTile(
  gridX: number,
  gridY: number,
  extendedSize: number,
): string | null {
  if (gridX === 0 && gridY === 0) {
    return coastTopLeftTile;
  }
  if (gridX === extendedSize - 1 && gridY === 0) {
    return coastTopRightTile;
  }
  if (gridX === 0 && gridY === extendedSize - 1) {
    return coastBottomLeftTile;
  }
  if (gridX === extendedSize - 1 && gridY === extendedSize - 1) {
    return coastBottomRightTile;
  }
  if (gridY === 0) {
    return coastTopEdgeTile;
  }
  if (gridY === extendedSize - 1) {
    return coastBottomEdgeTile;
  }
  if (gridX === 0) {
    return coastLeftEdgeTile;
  }
  if (gridX === extendedSize - 1) {
    return coastRightEdgeTile;
  }
  return null;
}

export function ClarityGrid({ player, target, blocked, visited }: ClarityGridProps): JSX.Element {
  const blockedSet = useMemo(() => new Set(blocked.map((cell) => `${cell.x}-${cell.y}`)), [blocked]);
  const axis = useMemo(() => Array.from({ length: GRID_SIZE }, (_, index) => index), []);
  const extendedGridSize = GRID_SIZE + 2;
  const cellPercent = 100 / extendedGridSize;
  const borderOffset = 1;
  const playerLeft = (player.x + borderOffset + 0.5) * cellPercent;
  const playerTop = (player.y + borderOffset + 0.5) * cellPercent;
  const targetLeft = (target.x + borderOffset + 0.5) * cellPercent;
  const targetTop = (target.y + borderOffset + 0.5) * cellPercent;

  return (
    <div className="relative mx-auto w-full max-w-[480px]">
      <div className="flex items-end gap-2 sm:gap-3 md:gap-4">
        <div className="flex h-[clamp(160px,calc(100vw-120px),360px)] flex-col justify-between pb-3 text-[11px] font-semibold text-[color:var(--brand-charcoal)]/70 md:pb-4 md:text-xs">
          {axis.map((value) => (
            <span key={`row-${value}`} className="text-right">
              {value}
            </span>
          ))}
        </div>
        <div className="relative">
          <div
            className="relative aspect-square h-[clamp(160px,calc(100vw-120px),360px)] rounded-[36px] border border-white/50 bg-white/30 p-3 shadow-inner"
            style={{
              backgroundImage: `url(${waterTile})`,
              backgroundRepeat: "repeat",
              backgroundSize: "96px",
            }}
          >
            <div className="h-full w-full rounded-[28px] border border-white/60 bg-white/60 p-1">
              <div
                className="grid h-full w-full overflow-hidden rounded-[24px] border border-white/40 bg-white/10"
                style={{
                  gridTemplateColumns: `repeat(${extendedGridSize}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${extendedGridSize}, minmax(0, 1fr))`,
                }}
              >
                {Array.from({ length: extendedGridSize * extendedGridSize }).map((_, index) => {
                  const gridX = index % extendedGridSize;
                  const gridY = Math.floor(index / extendedGridSize);
                  const borderTile = resolveBorderTile(gridX, gridY, extendedGridSize);

                  if (borderTile) {
                    return (
                      <div key={`border-${gridX}-${gridY}`} className="relative">
                        <img src={borderTile} alt="" aria-hidden="true" className="h-full w-full object-cover" />
                      </div>
                    );
                  }

                  const x = gridX - 1;
                  const y = gridY - 1;
                  const key = `${x}-${y}`;
                  const isVisited = visited.has(key);
                  const isStart = x === START_POSITION.x && y === START_POSITION.y;
                  const isBlocked = blockedSet.has(key);

                  return (
                    <div
                      key={key}
                      className="relative border border-white/30"
                      style={{
                        backgroundImage: `url(${grassTile})`,
                        backgroundSize: "cover",
                      }}
                    >
                      {isVisited && (
                        <span className="absolute inset-0 bg-[color:var(--brand-yellow)]/25 mix-blend-soft-light" aria-hidden="true" />
                      )}
                      {isBlocked && (
                        <img
                          src={treeTile}
                          alt="Arbre bloquant"
                          className="absolute inset-0 h-full w-full object-contain drop-shadow"
                        />
                      )}
                      {isStart && (
                        <span className="absolute left-1 top-1 z-[1] flex h-7 w-7 items-center justify-center">
                          <img
                            src={startMarkerTile}
                            alt="Point de départ"
                            className="h-full w-full object-contain drop-shadow"
                          />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="clarity-grid-overlay" />
          </div>
          <div className="pointer-events-none absolute inset-0">
            <img
              src={explorerToken}
              alt="Explorateur"
              className="absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-lg transition-transform duration-300 ease-out"
              style={{ left: `${playerLeft}%`, top: `${playerTop}%` }}
            />
            <img
              src={castleTile}
              alt="Château objectif"
              className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-lg"
              style={{ left: `${targetLeft}%`, top: `${targetTop}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-3 text-[11px] font-semibold text-[color:var(--brand-charcoal)]/70 sm:gap-[24px] md:gap-[34px] md:text-xs">
        {axis.map((value) => (
          <span key={`col-${value}`}>{value}</span>
        ))}
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
