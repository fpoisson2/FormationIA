import { useMemo } from "react";

import castleTile from "../../assets/kenney_map-pack/PNG/mapTile_100.png";
import explorerToken from "../../assets/kenney_map-pack/PNG/mapTile_136.png";
import grassTile from "../../assets/kenney_map-pack/PNG/mapTile_022.png";
import startMarkerTile from "../../assets/kenney_map-pack/PNG/mapTile_179.png";
import treeTile from "../../assets/kenney_map-pack/PNG/mapTile_115.png";
import shoreWaterTile from "../../assets/kenney_map-pack/PNG/mapTile_171.png";
import deepWaterTile from "../../assets/kenney_map-pack/PNG/mapTile_188.png";
import cliffBottomEdgeTile from "../../assets/kenney_map-pack/PNG/mapTile_037.png";
import cliffBottomLeftTile from "../../assets/kenney_map-pack/PNG/mapTile_036.png";
import cliffBottomRightTile from "../../assets/kenney_map-pack/PNG/mapTile_038.png";
import cliffLeftEdgeTile from "../../assets/kenney_map-pack/PNG/mapTile_021.png";
import cliffRightEdgeTile from "../../assets/kenney_map-pack/PNG/mapTile_023.png";
import cliffTopEdgeTile from "../../assets/kenney_map-pack/PNG/mapTile_007.png";
import cliffTopLeftTile from "../../assets/kenney_map-pack/PNG/mapTile_006.png";
import cliffTopRightTile from "../../assets/kenney_map-pack/PNG/mapTile_008.png";
import { CLARITY_TIPS, DIRECTION_LABELS, GRID_SIZE, START_POSITION } from "./constants";
import { formatDuration } from "./utils";
import type { ClientStats, GridCoord, PlanAction } from "./types";

export interface ClarityGridProps {
  player: GridCoord;
  target: GridCoord;
  blocked: GridCoord[];
  visited: Set<string>;
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
  const overlaySize = `${cellPercent}%`;
  const overlayInset = `${cellPercent}%`;
  const overlayCellSize = `calc(100% / ${GRID_SIZE}) calc(100% / ${GRID_SIZE})`;
  const overlayBackgroundSize = `${overlayCellSize}, ${overlayCellSize}`;

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
              backgroundImage: `url(${deepWaterTile})`,
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
                  const isOuterWater =
                    gridX === 0 ||
                    gridY === 0 ||
                    gridX === extendedGridSize - 1 ||
                    gridY === extendedGridSize - 1;

                  if (isOuterWater) {
                    let touchesLand =
                      (gridX === 0 && gridY > 0 && gridY < extendedGridSize - 1) ||
                      (gridX === extendedGridSize - 1 && gridY > 0 && gridY < extendedGridSize - 1) ||
                      (gridY === 0 && gridX > 0 && gridX < extendedGridSize - 1) ||
                      (gridY === extendedGridSize - 1 && gridX > 0 && gridX < extendedGridSize - 1);

                    if (!touchesLand) {
                      touchesLand =
                        (gridX === 0 && gridY === 0) ||
                        (gridX === extendedGridSize - 1 && gridY === 0) ||
                        (gridX === 0 && gridY === extendedGridSize - 1) ||
                        (gridX === extendedGridSize - 1 && gridY === extendedGridSize - 1);
                    }

                    return (
                      <div key={`water-${gridX}-${gridY}`} className="relative">
                        <img
                          src={touchesLand ? shoreWaterTile : deepWaterTile}
                          alt=""
                          aria-hidden="true"
                          className="h-full w-full object-cover"
                          style={{ imageRendering: "pixelated" }}
                        />
                      </div>
                    );
                  }

                  const x = gridX - 1;
                  const y = gridY - 1;
                  const key = `${x}-${y}`;
                  const isVisited = visited.has(key);
                  const isStart = x === START_POSITION.x && y === START_POSITION.y;
                  const isBlocked = blockedSet.has(key);

                  const isTopEdge = y === 0;
                  const isBottomEdge = y === GRID_SIZE - 1;
                  const isLeftEdge = x === 0;
                  const isRightEdge = x === GRID_SIZE - 1;

                  let terrainTile = grassTile;

                  if (isTopEdge && isLeftEdge) {
                    terrainTile = cliffTopLeftTile;
                  } else if (isTopEdge && isRightEdge) {
                    terrainTile = cliffTopRightTile;
                  } else if (isBottomEdge && isLeftEdge) {
                    terrainTile = cliffBottomLeftTile;
                  } else if (isBottomEdge && isRightEdge) {
                    terrainTile = cliffBottomRightTile;
                  } else if (isTopEdge) {
                    terrainTile = cliffTopEdgeTile;
                  } else if (isBottomEdge) {
                    terrainTile = cliffBottomEdgeTile;
                  } else if (isLeftEdge) {
                    terrainTile = cliffLeftEdgeTile;
                  } else if (isRightEdge) {
                    terrainTile = cliffRightEdgeTile;
                  }

                  return (
                    <div key={key} className="relative overflow-hidden border border-white/30">
                      <img
                        src={terrainTile}
                        alt=""
                        aria-hidden="true"
                        className="h-full w-full object-cover"
                        style={{ imageRendering: "pixelated" }}
                      />
                      {isVisited && (
                        <span className="absolute inset-0 bg-[color:var(--brand-yellow)]/25 mix-blend-soft-light" aria-hidden="true" />
                      )}
                      {isBlocked && (
                        <img
                          src={treeTile}
                          alt="Arbre bloquant"
                          className="absolute inset-0 h-full w-full object-contain drop-shadow"
                          style={{ imageRendering: "pixelated" }}
                        />
                      )}
                      {isStart && (
                        <span
                          className="absolute left-1/2 top-1/2 z-[1] flex -translate-x-1/2 -translate-y-1/2"
                          style={{ width: "72%", height: "72%" }}
                        >
                          <img
                            src={startMarkerTile}
                            alt="Point de départ"
                            className="h-full w-full object-contain drop-shadow"
                            style={{
                              imageRendering: "pixelated",
                            }}
                          />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              className="clarity-grid-overlay"
              style={{
                backgroundSize: overlayBackgroundSize,
                top: overlayInset,
                bottom: overlayInset,
                left: overlayInset,
                right: overlayInset,
              }}
            />
          </div>
          <div className="pointer-events-none absolute inset-0">
            <img
              src={explorerToken}
              alt="Explorateur"
              className="absolute -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-lg transition-transform duration-300 ease-out"
              style={{
                left: `${playerLeft}%`,
                top: `${playerTop}%`,
                width: overlaySize,
                height: overlaySize,
                imageRendering: "pixelated",
              }}
            />
            <img
              src={castleTile}
              alt="Château objectif"
              className="absolute -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-lg"
              style={{
                left: `${targetLeft}%`,
                top: `${targetTop}%`,
                width: overlaySize,
                height: overlaySize,
                imageRendering: "pixelated",
              }}
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
