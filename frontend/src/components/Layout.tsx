import { ReactNode } from "react";
import { Link } from "react-router-dom";

import ActivityLayout from "./ActivityLayout";
import { useAdminAuth } from "../providers/AdminAuthProvider";

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
  const { status: adminStatus } = useAdminAuth();
  const isAdminAuthenticated = adminStatus === "authenticated";

  return (
    <ActivityLayout
      activityId="atelier-comparatif"
      eyebrow="Atelier comparatif IA"
      title="Cadrez, comparez, synthétisez vos essais IA"
      subtitle="Suivez une progression claire pour préparer votre contexte, explorer deux profils IA en flux continu puis transformer les sorties en ressources réutilisables."
      badge="Trois étapes guidées"
      actions={
        isAdminAuthenticated ? (
          <Link
            to="/admin"
            className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-xs font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
          >
            Administration
          </Link>
        ) : null
      }
      headerChildren={
        <>
          <div className="rounded-3xl border border-white/60 bg-white/85 p-6 text-sm shadow-sm md:ml-auto">
            <p className="font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">Au programme</p>
            <ul className="mt-3 space-y-2 text-[color:var(--brand-charcoal)]">
              <li>• Décrire précisément le contexte et les attentes.</li>
              <li>• Ajuster modèle, verbosité et effort de raisonnement.</li>
              <li>• Comparer les productions pour créer une synthèse fiable.</li>
            </ul>
          </div>
          <nav className="grid gap-3 md:grid-cols-3">
            {STEPS.map((step) => {
              const isActive = currentStep === step.number;
              const isCompleted = currentStep > step.number;
              const baseClasses =
                "rounded-full px-5 py-3 text-sm font-semibold transition shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
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
        </>
      }
      headerClassName="space-y-8"
      contentClassName="space-y-12"
    >
      {children}
    </ActivityLayout>
  );
}

export default Layout;
