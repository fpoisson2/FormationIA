import { useMemo } from "react";

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
  const cellPercent = 100 / GRID_SIZE;
  const playerLeft = (player.x + 0.5) * cellPercent;
  const playerTop = (player.y + 0.5) * cellPercent;
  const targetLeft = (target.x + 0.5) * cellPercent;
  const targetTop = (target.y + 0.5) * cellPercent;

  return (
    <div className="relative mx-auto w-full max-w-[480px]">
      <div className="flex items-end gap-3 md:gap-4">
        <div className="flex h-[clamp(220px,80vw,360px)] flex-col justify-between pb-3 text-[11px] font-semibold text-[color:var(--brand-charcoal)]/70 md:pb-4 md:text-xs">
          {axis.map((value) => (
            <span key={`row-${value}`} className="text-right">
              {value}
            </span>
          ))}
        </div>
        <div className="relative">
          <div className="relative aspect-square h-[clamp(220px,80vw,360px)] rounded-3xl border border-white/60 bg-white/70 p-2 shadow-inner">
            <div className="grid h-full w-full grid-cols-10 grid-rows-10 overflow-hidden rounded-2xl border border-white/40">
              {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => {
                const x = index % GRID_SIZE;
                const y = Math.floor(index / GRID_SIZE);
                const key = `${x}-${y}`;
                const isVisited = visited.has(key);
                const isStart = x === START_POSITION.x && y === START_POSITION.y;
                const isTarget = x === target.x && y === target.y;
                const isBlocked = blockedSet.has(key);
                return (
                  <div
                    key={key}
                    className={`relative border border-white/40 ${
                      isVisited ? "bg-[color:var(--brand-yellow)]/30" : "bg-white/60"
                    }`}
                  >
                    {isBlocked && (
                      <span className="absolute inset-0 flex items-center justify-center text-xs text-[color:var(--brand-red)]">🧱</span>
                    )}
                    {isStart && (
                      <span className="absolute left-1 top-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]">
                        Start
                      </span>
                    )}
                    {isTarget && (
                      <span className="absolute right-1 top-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">
                        Goal
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="clarity-grid-overlay" />
          </div>
          <div className="pointer-events-none absolute inset-0">
            <span
              className="absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-2xl transition-transform duration-300 ease-out"
              style={{ left: `${playerLeft}%`, top: `${playerTop}%` }}
              role="img"
              aria-label="Bonhomme"
            >
              👤
            </span>
            <span
              className="absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-2xl"
              style={{ left: `${targetLeft}%`, top: `${targetTop}%` }}
              role="img"
              aria-label="Objectif"
            >
              🎯
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-[24px] text-[11px] font-semibold text-[color:var(--brand-charcoal)]/70 md:gap-[34px] md:text-xs">
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
}

export function PlanPreview({ plan, notes }: PlanPreviewProps): JSX.Element {
  if (!plan.length && !notes) {
    return (
      <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Plan</h3>
        <p className="mt-2 text-sm text-[color:var(--brand-charcoal)]/80">
          Le plan validé apparaîtra ici dès que le backend aura converti ta consigne.
        </p>
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
