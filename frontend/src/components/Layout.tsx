import { ReactNode } from "react";

import ActivityLayout from "./ActivityLayout";

interface LayoutProps {
  currentStep: number;
  children: ReactNode;
}

const STEPS = [
  { number: 1, label: "Préparer", path: "/atelier/etape-1" },
  { number: 2, label: "Explorer", path: "/atelier/etape-2" },
  { number: 3, label: "Synthétiser", path: "/atelier/etape-3" },
];

function Layout({ currentStep, children }: LayoutProps): JSX.Element {
  const title = "Cadrez, comparez, synthétisez vos essais IA";
  const subtitle =
    "Suivez une progression claire pour préparer votre contexte, explorer deux profils IA en flux continu puis transformer les sorties en ressources réutilisables.";

  return (
    <ActivityLayout
      activityId="atelier-comparatif"
      eyebrow="Atelier comparatif IA"
      title={title}
      subtitle={subtitle}
      badge="Trois étapes guidées"
      className="pb-16 pt-10"
      containerClassName="space-y-12"
      headerClassName="space-y-8"
      contentClassName="space-y-12"
      headerBody={
        <div className="grid gap-6 md:grid-cols-[3fr_2fr] md:items-start">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">{title}</h1>
            <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90 md:text-base">{subtitle}</p>
          </div>
          <div className="rounded-3xl border border-white/60 bg-white/85 p-6 text-sm shadow-sm">
            <p className="font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">Au programme</p>
            <ul className="mt-3 space-y-2 text-[color:var(--brand-charcoal)]">
              <li>• Décrire précisément le contexte et les attentes.</li>
              <li>• Ajuster modèle, verbosité et effort de raisonnement.</li>
              <li>• Comparer les productions pour créer une synthèse fiable.</li>
            </ul>
          </div>
        </div>
      }
      headerChildren={
        <nav className="grid gap-3 md:grid-cols-3">
          {STEPS.map((step) => {
            const isActive = currentStep === step.number;
            const isCompleted = currentStep > step.number;
            const baseClasses = "rounded-full px-5 py-3 text-sm font-semibold transition shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
            const stateClasses = isActive
              ? "bg-[color:var(--brand-red)] text-white"
              : isCompleted
              ? "bg-white text-[color:var(--brand-black)]"
              : "bg-white/70 text-[color:var(--brand-charcoal)]/80 hover:bg-white";
            return (
              <div
                key={step.number}
                className={`${baseClasses} ${stateClasses}`}
                aria-current={isActive ? "step" : undefined}
              >
                Étape {step.number} · {step.label}
              </div>
            );
          })}
        </nav>
      }
    >
      {children}
    </ActivityLayout>
  );
}

export default Layout;
