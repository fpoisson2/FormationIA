import { Link } from "react-router-dom";

const ACTIVITIES = [
  {
    id: "atelier",
    title: "Atelier comparatif IA",
    description:
      "Parcourez trois étapes guidées pour cadrer une demande, comparer deux profils IA et transformer les sorties en ressources pédagogiques.",
    highlights: [
      "Préparez un contexte détaillé",
      "Ajustez modèle, verbosité et raisonnement",
      "Générez cartes d’étude et synthèse finale",
    ],
    cta: "Lancer l’atelier",
    to: "/atelier/etape-1",
  },
  {
    id: "prompt-dojo",
    title: "Prompt Dojo — Mission débutant",
    description:
      "Progressez dans trois missions gamifiées pour apprendre à cadrer une consigne, avec score en direct et feedback IA.",
    highlights: [
      "Missions à difficulté progressive",
      "Score en direct, badges et coach IA",
      "Export du prompt final personnalisé",
    ],
    cta: "Entrer dans le dojo",
    to: "/prompt-dojo",
  },
  {
    id: "clarity",
    title: "Parcours de la clarté",
    description:
      "Formule une instruction limpide pour piloter un bonhomme sur une grille 10×10, du brief initial jusqu’au récapitulatif statistique.",
    highlights: [
      "Plan structuré généré (gpt-5-nano) avant l’animation",
      "Visualisation pas à pas, obstacles optionnels",
      "Tentatives, surcoût et temps de résolution analysés",
    ],
    cta: "Tester la clarté",
    to: "/parcours-clarte",
  },
];

function ActivitySelector(): JSX.Element {
  return (
    <div className="landing-gradient min-h-screen px-6 py-16 text-[color:var(--brand-black)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-12">
        <header className="space-y-4 text-center animate-section">
          <span className="inline-flex items-center justify-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]">
            Choisissez votre activité
          </span>
          <h1 className="text-3xl font-semibold md:text-4xl">
            Une plateforme, trois expériences pour apprivoiser l’IA
          </h1>
          <p className="mx-auto max-w-3xl text-sm text-[color:var(--brand-charcoal)] md:text-base">
            Selon vos objectifs, explorez l’atelier comparatif, mesurez vos progrès dans le dojo de prompts ou entraînez-vous à la précision avec le parcours de la clarté. Trois approches, une même identité visuelle et des repères pédagogiques communs.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2 animate-section-delayed">
          {ACTIVITIES.map((activity) => (
            <article
              key={activity.id}
              className="group flex h-full flex-col gap-6 rounded-3xl border border-white/60 bg-white/90 p-8 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">
                  {activity.title}
                </h2>
                <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90">
                  {activity.description}
                </p>
              </div>
              <ul className="flex flex-col gap-2 text-sm text-[color:var(--brand-charcoal)]">
                {activity.highlights.map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
                      +
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                <Link
                  to={activity.to}
                  className="cta-button cta-button--primary inline-flex items-center gap-2"
                >
                  {activity.cta}
                  <span className="inline-block text-lg transition group-hover:translate-x-1">→</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ActivitySelector;
