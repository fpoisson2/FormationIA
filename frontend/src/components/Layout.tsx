import { ReactNode } from "react";
import { Link } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";

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
  return (
    <div className="landing-gradient min-h-screen px-6 pb-16 pt-10 text-[color:var(--brand-black)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-12">
        <header className="space-y-8 rounded-3xl border border-white/70 bg-white/90 p-8 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <Link to="/" className="flex items-center gap-3">
              <img src={logoPrincipal} alt="Cégep Limoilou" className="h-12 w-auto md:h-16" />
              <span className="text-xs uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/70">
                Atelier comparatif IA
              </span>
            </Link>
            <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
              Trois étapes guidées
            </span>
          </div>
          <div className="grid gap-6 md:grid-cols-[3fr_2fr] md:items-start">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
                Cadrez, comparez, synthétisez vos essais IA
              </h1>
              <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90 md:text-base">
                Suivez une progression claire pour préparer votre contexte, explorer deux profils IA en flux continu puis transformer les sorties en ressources réutilisables.
              </p>
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
                <Link key={step.number} to={step.path} className={`${baseClasses} ${stateClasses}`}>
                  Étape {step.number} · {step.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="space-y-12">{children}</main>
      </div>
    </div>
  );
}

export default Layout;
