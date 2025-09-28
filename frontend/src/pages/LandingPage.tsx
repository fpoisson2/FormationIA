import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";
import { useLTI } from "../hooks/useLTI";

const heroHighlights = [
  {
    title: "Séquence unique",
    description:
      "StepSequence guide l'apprenant de la préparation du contexte à la synthèse finale en trois étapes coordonnées.",
  },
  {
    title: "Accompagnement humain",
    description:
      "Le parcours est ponctué de repères pédagogiques pour cultiver l'esprit critique face aux suggestions de l'IA.",
  },
];

const featureCards = [
  {
    title: "Étape 1 — Préparer",
    description:
      "Cadrez la demande et identifiez les attentes clés : StepSequence vérifie la clarté du contexte partagé à l'IA.",
  },
  {
    title: "Étape 2 — Explorer",
    description:
      "Comparez deux profils IA en flux continu et observez leurs réponses côte à côte pour éclairer vos choix.",
  },
  {
    title: "Étape 3 — Synthétiser",
    description:
      "Assemblez une synthèse réutilisable, exportable et argumentée pour capitaliser sur vos essais IA.",
  },
];

const integrationHighlights = [
  {
    title: "Connexion Moodle via LTI 1.3",
    description:
      "Déployez Formation IA comme activité externe sécurisée. LTI Advantage garantit l'échange automatique des identités et des rôles.",
  },
  {
    title: "Deep Linking simplifié",
    description:
      "Insérez StepSequence dans n'importe quel cours Moodle en deux clics. Les paramètres sont transmis automatiquement à vos étudiants.",
  },
  {
    title: "Suivi des parcours",
    description:
      "Remontez les traces d'apprentissage dans Moodle : achèvements, séquence consultée et progression détaillée.",
  },
];

const onboardingSteps = [
  {
    title: "Configurer la plateforme",
    description:
      "Ajoutez Formation IA comme outil externe dans Moodle, importez la clé publique et choisissez les contextes autorisés.",
  },
  {
    title: "Partager via Deep Link",
    description:
      "Depuis un cours, utilisez l'insertion LTI pour sélectionner StepSequence et personnaliser son intitulé.",
  },
  {
    title: "Accompagner la cohorte",
    description:
      "Les apprenants accèdent instantanément au parcours guidé et bénéficient des repères pédagogiques intégrés.",
  },
];

function LandingPage(): JSX.Element {
  const navigate = useNavigate();
  const { isLTISession, loading: ltiLoading } = useLTI();

  useEffect(() => {
    if (!ltiLoading && isLTISession) {
      navigate("/activites", { replace: true });
    }
  }, [isLTISession, ltiLoading, navigate]);

  return (
    <div className="landing-gradient min-h-screen px-6 pb-24 pt-10 text-[color:var(--brand-black)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-16">
        <header className="flex flex-col gap-6 rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img
              src={logoPrincipal}
              alt="Formation IA"
              className="h-10 w-auto md:h-12"
            />
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/80">
              Formation IA
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-3 text-sm font-semibold text-[color:var(--brand-charcoal)]/80">
            <Link
              to="/activites"
              className="rounded-full border border-white/60 bg-white/60 px-4 py-2 transition hover:bg-white"
            >
              StepSequence
            </Link>
            <a
              href="#integrations"
              className="rounded-full border border-white/60 bg-white/60 px-4 py-2 transition hover:bg-white"
            >
              Intégrations
            </a>
            <Link to="/connexion" className="cta-button cta-button--primary">
              Se connecter
            </Link>
          </nav>
        </header>

        <main className="space-y-16">
          <section className="page-section landing-panel grid gap-12 bg-white/95 md:grid-cols-[2fr,1fr]">
            <div className="space-y-6">
              <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
                Plateforme pédagogique
              </span>
              <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
                StepSequence : l'atelier pour apprendre à collaborer avec l'IA en formation supérieure.
              </h1>
              <p className="text-base leading-relaxed text-[color:var(--brand-charcoal)]">
                Formation IA accompagne enseignants et apprenants dans la découverte responsable de l'intelligence artificielle générative. Le parcours StepSequence combine narration, repères pédagogiques et espaces de réflexion pour ancrer les bonnes pratiques.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link to="/activites" className="cta-button cta-button--primary">
                  Découvrir StepSequence
                </Link>
                <Link to="/connexion" className="cta-button cta-button--light">
                  Se connecter ou activer via Moodle
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {heroHighlights.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm"
                  >
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative flex flex-col justify-between gap-6 rounded-3xl border border-[color:var(--brand-red)]/30 bg-[color:var(--brand-red)]/10 p-6 text-[color:var(--brand-charcoal)] shadow-inner">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--brand-red)]/80">
                  Nouveauté
                </p>
                <h2 className="mt-3 text-2xl font-semibold leading-snug">
                  Intégration Moodle LTI + Deep Linking
                </h2>
                <p className="mt-2 text-sm leading-relaxed">
                  Distribuez les parcours Formation IA directement dans vos cours Moodle. Les enseignants publient, les étudiants se connectent, tout le monde apprend ensemble.
                </p>
              </div>
              <div className="rounded-2xl border border-white/60 bg-white/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
                  Idéal pour
                </p>
                <ul className="mt-3 space-y-2 text-sm text-[color:var(--brand-charcoal)]">
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[color:var(--brand-red)]" aria-hidden="true" />
                    Centres de formation collégiale
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[color:var(--brand-red)]" aria-hidden="true" />
                    Services pédagogiques universitaires
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-[color:var(--brand-red)]" aria-hidden="true" />
                    Équipes innovation et transformation numérique
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section
            id="activites"
            className="page-section landing-panel space-y-8 bg-white/90"
          >
            <div className="space-y-3">
              <span className="brand-chip bg-[color:var(--brand-black)] text-white">
                Parcours StepSequence
              </span>
              <h2 className="text-3xl font-semibold leading-tight">
                Un chemin unique pour apprivoiser l'IA en classe.
              </h2>
              <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                StepSequence offre une narration continue, des exemples annotés et des espaces d'analyse pour ancrer la stratégie numérique propre à votre établissement.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {featureCards.map((card) => (
                <article
                  key={card.title}
                  className="flex h-full flex-col gap-3 rounded-3xl border border-white/80 bg-white/80 p-6 shadow-sm"
                >
                  <h3 className="text-xl font-semibold leading-snug">
                    {card.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                    {card.description}
                  </p>
                  <div className="mt-auto flex items-center gap-2 text-sm font-semibold text-[color:var(--brand-red)]">
                    <span aria-hidden="true">→</span> Intégré à StepSequence
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section
            id="integrations"
            className="page-section landing-panel space-y-8 bg-white/95"
          >
            <div className="space-y-3">
              <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
                Intégrations Moodle
              </span>
              <h2 className="text-3xl font-semibold leading-tight">
                Connectez Formation IA à votre écosystème numérique en toute confiance.
              </h2>
              <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                LTI Advantage 1.3 assure l'authentification, le Deep Linking facilite la distribution et les webhooks permettent de suivre l'engagement. Aucun compte supplémentaire à créer pour vos communautés éducatives.
              </p>
            </div>
            <div className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
              <div className="grid gap-4 md:grid-cols-2">
                {integrationHighlights.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-3xl border border-white/80 bg-white/80 p-6 shadow-sm"
                  >
                    <h3 className="text-lg font-semibold leading-snug text-[color:var(--brand-black)]">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-4 rounded-3xl border border-white/80 bg-white/70 p-6 shadow-sm">
                <h3 className="text-lg font-semibold leading-snug text-[color:var(--brand-black)]">
                  Comment démarrer ?
                </h3>
                <ol className="space-y-3 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                  {onboardingSteps.map((step, index) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-sm font-semibold text-[color:var(--brand-red)]">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-semibold text-[color:var(--brand-black)]">
                          {step.title}
                        </p>
                        <p className="text-[color:var(--brand-charcoal)]/80">
                          {step.description}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                <Link to="/connexion" className="cta-button cta-button--primary">
                  Activer l'authentification LTI
                </Link>
              </div>
            </div>
          </section>

          <section className="page-section landing-panel space-y-6 bg-white/90">
            <div className="flex flex-col gap-4 text-center">
              <h2 className="text-3xl font-semibold leading-tight">
                Prêts à faire rayonner l'innovation pédagogique ?
              </h2>
              <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)] md:text-base">
                Les équipes Formation IA vous accompagnent pour paramétrer votre première cohorte, adapter les parcours à votre discipline et partager les meilleures pratiques issues de la communauté.
              </p>
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link to="/activites" className="cta-button cta-button--primary">
                  Découvrir le catalogue complet
                </Link>
                <a
                  href="mailto:innovation@cegeplimoilou.ca"
                  className="cta-button cta-button--light"
                >
                  Contacter l'équipe
                </a>
              </div>
            </div>
          </section>
        </main>

        <footer className="flex flex-col items-center gap-2 text-center text-xs text-[color:var(--brand-charcoal)]/80 md:flex-row md:justify-between">
          <p>© {new Date().getFullYear()} Formation IA – Cégep Limoilou.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/activites" className="hover:text-[color:var(--brand-red)]">
              Activités
            </Link>
            <Link to="/connexion" className="hover:text-[color:var(--brand-red)]">
              Connexion
            </Link>
            <a href="#integrations" className="hover:text-[color:var(--brand-red)]">
              LTI &amp; Deep Link
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default LandingPage;
