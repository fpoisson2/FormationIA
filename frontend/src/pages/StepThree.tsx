import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { API_BASE_URL, MODEL_OPTIONS, type ModelConfig } from "../config";
import type { Flashcard } from "../App";

interface StepThreeProps {
  sourceText: string;
  summaryA: string;
  summaryB: string;
  flashcardsA: Flashcard[];
  flashcardsB: Flashcard[];
  setFlashcardsA: Dispatch<SetStateAction<Flashcard[]>>;
  setFlashcardsB: Dispatch<SetStateAction<Flashcard[]>>;
  configA: ModelConfig;
  configB: ModelConfig;
}

function StepThree({
  sourceText,
  summaryA,
  summaryB,
  flashcardsA,
  flashcardsB,
  setFlashcardsA,
  setFlashcardsB,
  configA,
  configB,
}: StepThreeProps): JSX.Element {
  const navigate = useNavigate();
  const [loadingSide, setLoadingSide] = useState<"A" | "B" | null>(null);
  const [errorSide, setErrorSide] = useState<string | null>(null);
  const [finalSummary, setFinalSummary] = useState("");
  const [finalSummaryLoading, setFinalSummaryLoading] = useState(false);
  const [finalSummaryError, setFinalSummaryError] = useState<string | null>(null);

  const canGenerate = useMemo(() => Boolean(sourceText.trim()), [sourceText]);

  const handleCardsBoth = async () => {
    if (!canGenerate) {
      setErrorSide("Ajoutez un texte source avant de créer des cartes d’étude.");
      return;
    }

    setErrorSide(null);
    setLoadingSide("A");

    const runFor = async (
      config: ModelConfig,
      setCards: Dispatch<SetStateAction<Flashcard[]>>
    ) => {
      const response = await fetch(`${API_BASE_URL}/flashcards`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: sourceText,
          model: config.model,
          verbosity: config.verbosity,
          thinking: config.thinking,
          card_count: 3,
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Impossible de générer les cartes.");
      }

      const { cards } = (await response.json()) as { cards: Flashcard[] };
      if (!Array.isArray(cards)) {
        throw new Error("Format de réponse inattendu.");
      }
      setCards(cards);
    };

    try {
      await Promise.all([
        runFor(configA, setFlashcardsA),
        runFor(configB, setFlashcardsB),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inattendue";
      setErrorSide(message);
    } finally {
      setLoadingSide(null);
    }
  };

  const profileA = MODEL_OPTIONS.find((option) => option.value === configA.model);
  const profileB = MODEL_OPTIONS.find((option) => option.value === configB.model);

  const handleFinalSummary = async () => {
    if (!summaryA.trim() || !summaryB.trim()) {
      setFinalSummaryError("Générez d’abord les deux résumés pour pouvoir produire une synthèse finale.");
      return;
    }

    setFinalSummary("");
    setFinalSummaryError(null);
    setFinalSummaryLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: `Texte source :\n${sourceText}\n\nProfil rapide :\n${summaryA}\n\nProfil expert :\n${summaryB}\n\nÉcris une synthèse finale en français en trois parties : 1) points communs, 2) différences notables, 3) recommandations pédagogiques.`,
          model: "gpt-5-mini",
          verbosity: "medium",
          thinking: "minimal",
        }),
      });

      if (!response.ok || !response.body) {
        const message = await response.text();
        throw new Error(message || "Impossible de générer la synthèse finale.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        if (chunk) {
          setFinalSummary((prev) => prev + chunk);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inattendue";
      setFinalSummaryError(message);
    } finally {
      setFinalSummaryLoading(false);
    }
  };

  return (
    <div className="landing-gradient space-y-12">
      <section className="page-section landing-panel space-y-6 animate-section">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <span className="brand-chip bg-[color:var(--brand-red)] text-white/95">Étape 3</span>
            <h2 className="text-2xl text-[color:var(--brand-black)]">Comparer, capitaliser, transmettre</h2>
            <p className="text-sm text-[color:var(--brand-charcoal)]">
              Analysez les formulations produites par chaque profil IA et relevez ce qui change (niveau de détail, ton, structure). Notez ces observations pendant qu’elles sont fraîches : elles guideront vos choix ultérieurs.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/etape-2")}
            className="cta-button cta-button--light"
          >
            Revenir à l’étape 2
          </button>
        </div>
        <div className="section-divider my-6" />
        <div className="grid gap-4 md:grid-cols-2 animate-section-delayed">
          <article className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[color:var(--brand-black)]">Profil A — {profileA?.label ?? "configuration"}</h3>
              <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">Résumé généré</span>
            </header>
            <p className="min-h-[140px] whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              {summaryA || "(Résultat en attente — lancez la requête à l’étape précédente)"}
            </p>
          </article>
          <article className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[color:var(--brand-black)]">Profil B — {profileB?.label ?? "configuration"}</h3>
              <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">Résumé généré</span>
            </header>
            <p className="min-h-[140px] whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              {summaryB || "(Résultat en attente — lancez la requête à l’étape précédente)"}
            </p>
          </article>
        </div>
      </section>

      <div className="section-divider" />
      <section className="grid gap-6 animate-section md:grid-cols-2">
        {["A", "B"].map((label) => {
          const cards = label === "A" ? flashcardsA : flashcardsB;
          return (
            <div key={label} className="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-[color:var(--brand-black)]">Cartes d’étude — Modèle {label}</h3>
                <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                  {cards.length ? `${cards.length} carte(s)` : "En attente"}
                </span>
              </div>
              {cards.length > 0 ? (
                <ul className="space-y-3 text-sm text-[color:var(--brand-charcoal)]">
                  {cards.map((card, index) => (
                    <li key={index} className="rounded-3xl bg-[rgba(18,18,18,0.05)] p-4">
                      <p className="font-semibold">Q · {card.question}</p>
                      <p className="mt-2 text-[color:var(--brand-charcoal)]/80">R · {card.reponse}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-3xl bg-[rgba(18,18,18,0.04)] p-4 text-sm text-[color:var(--brand-charcoal)]/70">
                  Lancez la génération pour obtenir trois cartes prêtes à l’étude.
                </p>
              )}
            </div>
          );
        })}
      </section>

      {errorSide && (
        <p className="rounded-3xl bg-red-50 p-3 text-sm text-red-600">{errorSide}</p>
      )}

      <div className="section-divider" />

      <button
        type="button"
        onClick={handleCardsBoth}
        className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:bg-slate-300"
        disabled={loadingSide !== null}
      >
        {loadingSide ? "Génération…" : "Créer les cartes pour les deux profils"}
      </button>

      <div className="section-divider" />

      <section className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm space-y-4 animate-section">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-[color:var(--brand-black)]">Synthèse finale</h3>
            <p className="text-sm text-[color:var(--brand-charcoal)]">
              Utilisez cette synthèse pour garder une trace des points communs, des différences et des pistes d’action dégagées par vos deux profils IA.
            </p>
          </div>
          <button
            type="button"
            onClick={handleFinalSummary}
            className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={finalSummaryLoading}
          >
            {finalSummaryLoading ? "Synthèse en cours…" : "Générer la synthèse"}
          </button>
        </div>
        {finalSummaryError && (
          <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-600">{finalSummaryError}</p>
        )}
        <div className="min-h-[160px] whitespace-pre-wrap rounded-3xl bg-[rgba(18,18,18,0.04)] p-5 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
          {finalSummary
            ? finalSummary
            : "Cliquez sur « Générer la synthèse » pour obtenir un résumé final structuré."}
        </div>
      </section>
    </div>
  );
}

export default StepThree;
