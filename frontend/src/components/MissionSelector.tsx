import type { Mission } from "../api";

interface MissionSelectorProps {
  missions: Mission[];
  onSelect: (missionId: string) => void;
}

function MissionSelector({ missions, onSelect }: MissionSelectorProps): JSX.Element {
  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-2">
        {missions.map((mission) => (
          <article
            key={mission.id}
            className="flex h-full flex-col gap-4 rounded-3xl border border-white/60 bg-white p-6 shadow-sm"
          >
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-[color:var(--brand-black)]">
                {mission.title}
              </h2>
              <p className="text-sm text-[color:var(--brand-charcoal)]">{mission.ui_help}</p>
            </div>
            <div className="flex flex-col gap-3 text-sm text-[color:var(--brand-charcoal)]/80">
              <div className="rounded-2xl bg-[color:var(--brand-sand)]/60 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">
                  3 manches
                </span>
                <p className="mt-1 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                  Tu reçois une consigne floue de l’usager et tu dois répondre en tant qu’IA; chaque manche apporte une précision supplémentaire.
                </p>
              </div>
              <div className="rounded-2xl bg-[color:var(--brand-sand)]/40 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">
                  Révélation finale
                </span>
                <p className="mt-1 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                  À la fin, découvre la checklist complète de ce qui aurait dû être demandé dès le départ.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelect(mission.id)}
              className="cta-button cta-button--primary mt-auto"
            >
              Démarrer cette mission
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

export default MissionSelector;
