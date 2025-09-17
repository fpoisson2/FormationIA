import { ReactNode } from "react";
import { Link } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";

interface LayoutProps {
  currentStep: number;
  children: ReactNode;
}

const STEPS = [
  { number: 1, label: "Préparer", path: "/etape-1" },
  { number: 2, label: "Explorer", path: "/etape-2" },
  { number: 3, label: "Synthétiser", path: "/etape-3" },
];

function Layout({ currentStep, children }: LayoutProps): JSX.Element {
  return (
    <div className="min-h-screen bg-[color:var(--brand-sand)]">
      <header className="relative bg-[color:var(--brand-black)] text-white">
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[rgba(237,30,32,0.2)] to-transparent" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <Link to="/" className="flex items-center gap-3">
              <img src={logoPrincipal} alt="Cégep Limoilou" className="h-12 w-auto md:h-16" />
              <span className="text-xs uppercase tracking-[0.3em] text-white/70">Atelier IA</span>
            </Link>
            <span className="brand-chip bg-white/10 text-white/90">
              Voir grand avec l’IA pédagogique
            </span>
          </div>
          <div className="grid gap-6 md:grid-cols-[3fr_2fr] md:items-center">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
                Dompter l’IA pour apprendre avec confiance
              </h1>
              <p className="text-sm text-white/80 md:text-base">
                Trois étapes guidées pour cadrer une demande, explorer les réglages des modèles et transformer les sorties en ressources d’étude. Chaque écran introduit un éclairage sur l’IA pour nourrir votre sens critique.
              </p>
            </div>
            <div className="rounded-3xl bg-white/10 p-6 text-sm text-white/80 shadow-lg backdrop-blur">
              <p className="font-semibold uppercase tracking-wide text-white">Ce que vous allez pratiquer</p>
              <ul className="mt-3 space-y-2 text-sm">
                <li>• Ajuster les paramètres d’un profil IA selon l’objectif pédagogique.</li>
                <li>• Observer comment chaque réglage change la forme et le ton des réponses.</li>
                <li>• Produire une synthèse finale qui capture l’essentiel de vos essais.</li>
              </ul>
            </div>
          </div>
          <nav className="flex flex-col gap-3 md:flex-row">
            {STEPS.map((step) => {
              const isActive = currentStep === step.number;
              const isCompleted = currentStep > step.number;
              const className = [
                "flex-1 rounded-full px-5 py-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                isActive
                  ? "bg-white text-[color:var(--brand-black)] shadow-lg"
                  : isCompleted
                  ? "bg-[color:var(--brand-red)] text-white shadow-lg hover:bg-red-600"
                  : "bg-white/10 text-white/80 hover:bg-white/20",
              ].join(" ");
              return (
                <Link key={step.number} to={step.path} className={className}>
                  Étape {step.number} · {step.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-16 pt-12">
        {children}
      </main>
    </div>
  );
}

export default Layout;
