import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from "react";

import {
  API_AUTH_KEY,
  API_BASE_URL,
  MODEL_OPTIONS,
  type ModelConfig,
} from "../../../../config";
import { useActivityCompletion } from "../../../../hooks/useActivityCompletion";
import type { Flashcard } from "../../../../types/flashcards";
import type { StepComponentProps } from "../../types";
import { useStepSequence } from "../../useStepSequence";
import type { WorkshopComparisonStepState } from "./WorkshopComparisonStep";
import type { WorkshopContextStepState } from "./WorkshopContextStep";

export interface WorkshopSynthesisStepConfig {
  contextStepId: string;
  comparisonStepId: string;
}

interface WorkshopSynthesisPayload {
  flashcardsA: Flashcard[];
  flashcardsB: Flashcard[];
  finalSummary: string;
}

type FlashcardSetter = Dispatch<SetStateAction<Flashcard[]>>;

const normalizeConfig = (config: unknown): WorkshopSynthesisStepConfig => {
  if (!config || typeof config !== "object") {
    return { contextStepId: "", comparisonStepId: "" };
  }
  const base = config as WorkshopSynthesisStepConfig;
  return {
    contextStepId:
      typeof base.contextStepId === "string" ? base.contextStepId : "",
    comparisonStepId:
      typeof base.comparisonStepId === "string" ? base.comparisonStepId : "",
  };
};

const buildInitialState = (
  payload: unknown
): WorkshopSynthesisPayload => {
  if (
    payload &&
    typeof payload === "object" &&
    "flashcardsA" in payload &&
    "flashcardsB" in payload
  ) {
    const typed = payload as WorkshopSynthesisPayload;
    return {
      flashcardsA: Array.isArray(typed.flashcardsA)
        ? (typed.flashcardsA as Flashcard[])
        : [],
      flashcardsB: Array.isArray(typed.flashcardsB)
        ? (typed.flashcardsB as Flashcard[])
        : [],
      finalSummary:
        typeof typed.finalSummary === "string" ? typed.finalSummary : "",
    };
  }

  return {
    flashcardsA: [],
    flashcardsB: [],
    finalSummary: "",
  };
};

const getActivityField = <T,>(
  context: Record<string, unknown> | null | undefined,
  key: string
): T | undefined => {
  if (!context || typeof context !== "object") {
    return undefined;
  }
  const value = (context as Record<string, unknown>)[key];
  return value as T | undefined;
};

export type WorkshopSynthesisStepState = WorkshopSynthesisPayload;

export function WorkshopSynthesisStep({
  config,
  payload,
  onAdvance,
  isEditMode,
}: StepComponentProps): JSX.Element {
  const { payloads, activityContext } = useStepSequence();

  const typedConfig = useMemo(() => normalizeConfig(config), [config]);

  const contextState = useMemo(() => {
    const base = payloads[typedConfig.contextStepId];
    if (
      base &&
      typeof base === "object" &&
      "sourceText" in base &&
      typeof (base as WorkshopContextStepState).sourceText === "string"
    ) {
      return base as WorkshopContextStepState;
    }
    return { sourceText: "" };
  }, [payloads, typedConfig.contextStepId]);

  const comparisonState = useMemo(() => {
    const base = payloads[typedConfig.comparisonStepId];
    if (
      base &&
      typeof base === "object" &&
      "configA" in base &&
      "configB" in base
    ) {
      return base as WorkshopComparisonStepState;
    }
    return null;
  }, [payloads, typedConfig.comparisonStepId]);

  const initialState = useMemo(() => buildInitialState(payload), [payload]);

  const [flashcardsA, setFlashcardsA] = useState<Flashcard[]>(
    initialState.flashcardsA
  );
  const [flashcardsB, setFlashcardsB] = useState<Flashcard[]>(
    initialState.flashcardsB
  );
  const [loadingSide, setLoadingSide] = useState<"A" | "B" | null>(null);
  const [errorSide, setErrorSide] = useState<string | null>(null);
  const [finalSummary, setFinalSummary] = useState(initialState.finalSummary);
  const [finalSummaryLoading, setFinalSummaryLoading] = useState(false);
  const [finalSummaryError, setFinalSummaryError] = useState<string | null>(
    null
  );

  useEffect(() => {
    setFlashcardsA(initialState.flashcardsA);
    setFlashcardsB(initialState.flashcardsB);
    setFinalSummary(initialState.finalSummary);
  }, [
    initialState.flashcardsA,
    initialState.flashcardsB,
    initialState.finalSummary,
  ]);

  const completionId = useMemo(() => {
    const rawCompletionId = getActivityField<string>(
      activityContext,
      "completionId"
    );
    if (typeof rawCompletionId === "string" && rawCompletionId.length > 0) {
      return rawCompletionId;
    }
    const fallbackId = getActivityField<string>(activityContext, "activityId");
    if (typeof fallbackId === "string" && fallbackId.length > 0) {
      return fallbackId;
    }
    return "step-sequence-activity";
  }, [activityContext]);

  const navigateToActivities = useMemo(
    () => getActivityField<() => void>(activityContext, "navigateToActivities"),
    [activityContext]
  );

  const summaryReady = useMemo(() => Boolean(finalSummary.trim()), [finalSummary]);

  const { markCompleted } = useActivityCompletion({
    activityId: completionId,
    onCompleted: () => {
      navigateToActivities?.();
    },
    autoComplete: {
      condition: summaryReady,
      triggerCompletionCallback: true,
    },
    resetOn: [completionId],
  });

  const completionPayloadRef = useRef<string>(initialState.finalSummary);

  useEffect(() => {
    if (!finalSummary.trim()) {
      completionPayloadRef.current = "";
      return;
    }
    if (completionPayloadRef.current === finalSummary) {
      return;
    }
    completionPayloadRef.current = finalSummary;
    onAdvance({
      flashcardsA,
      flashcardsB,
      finalSummary,
    });
  }, [flashcardsA, flashcardsB, finalSummary, onAdvance]);

  const canGenerateFlashcards = useMemo(
    () => Boolean(contextState.sourceText.trim()) && !isEditMode,
    [contextState.sourceText, isEditMode]
  );

  const runFlashcardsRequest = async (
    config: ModelConfig,
    setter: FlashcardSetter
  ) => {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (API_AUTH_KEY) {
      headers["X-API-Key"] = API_AUTH_KEY;
    }

    const response = await fetch(`${API_BASE_URL}/flashcards`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: contextState.sourceText,
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
    setter(cards);
  };

  const handleCardsBoth = async () => {
    if (!comparisonState || !canGenerateFlashcards) {
      setErrorSide(
        "Ajoutez un texte source avant de créer des cartes d’étude."
      );
      return;
    }

    setErrorSide(null);
    setLoadingSide("A");
    try {
      await Promise.all([
        runFlashcardsRequest(comparisonState.configA, setFlashcardsA),
        runFlashcardsRequest(comparisonState.configB, setFlashcardsB),
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur inattendue";
      setErrorSide(message);
    } finally {
      setLoadingSide(null);
    }
  };

  const profileA = useMemo(() => {
    if (!comparisonState) return undefined;
    return MODEL_OPTIONS.find(
      (option) => option.value === comparisonState.configA.model
    );
  }, [comparisonState]);

  const profileB = useMemo(() => {
    if (!comparisonState) return undefined;
    return MODEL_OPTIONS.find(
      (option) => option.value === comparisonState.configB.model
    );
  }, [comparisonState]);

  const handleFinalSummary = async () => {
    if (!comparisonState || isEditMode) {
      return;
    }

    if (!comparisonState.summaryA.trim() || !comparisonState.summaryB.trim()) {
      setFinalSummaryError(
        "Générez d’abord les deux résumés pour pouvoir produire une synthèse finale."
      );
      return;
    }

    setFinalSummary("");
    setFinalSummaryError(null);
    setFinalSummaryLoading(true);

    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (API_AUTH_KEY) {
        headers["X-API-Key"] = API_AUTH_KEY;
      }

      const response = await fetch(`${API_BASE_URL}/summary`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: `Texte source :\n${contextState.sourceText}\n\nProfil rapide :\n${comparisonState.summaryA}\n\nProfil expert :\n${comparisonState.summaryB}\n\nÉcris une synthèse finale en français en trois parties : 1) points communs, 2) différences notables, 3) recommandations pédagogiques.`,
          model: "gpt-5-mini",
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
      await markCompleted({ triggerCompletionCallback: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur inattendue";
      setFinalSummaryError(message);
    } finally {
      setFinalSummaryLoading(false);
    }
  };

  return (
    <div className="space-y-12">
      <section className="page-section landing-panel bg-white/95 space-y-6 animate-section">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
              Étape 3
            </span>
            <h2 className="text-2xl text-[color:var(--brand-black)]">
              Comparer, capitaliser, transmettre
            </h2>
            <p className="text-sm text-[color:var(--brand-charcoal)]">
              Analysez les formulations produites par chaque profil IA et relevez ce qui change (niveau de détail, ton, structure). Notez ces observations pendant qu’elles sont fraîches : elles guideront vos choix ultérieurs.
            </p>
          </div>
        </div>
        <div className="section-divider my-6" />
        <div className="grid gap-4 md:grid-cols-2 animate-section-delayed">
          <article className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[color:var(--brand-black)]">
                Profil A — {profileA?.label ?? "configuration"}
              </h3>
              <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Résumé généré
              </span>
            </header>
            <p className="min-h-[140px] whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              {comparisonState?.summaryA || "(Résultat en attente — lancez la requête à l’étape précédente)"}
            </p>
          </article>
          <article className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[color:var(--brand-black)]">
                Profil B — {profileB?.label ?? "configuration"}
              </h3>
              <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                Résumé généré
              </span>
            </header>
            <p className="min-h-[140px] whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              {comparisonState?.summaryB || "(Résultat en attente — lancez la requête à l’étape précédente)"}
            </p>
          </article>
        </div>
      </section>

      <div className="section-divider" />
      <section className="grid gap-6 animate-section md:grid-cols-2">
        {["A", "B"].map((label) => {
          const cards = label === "A" ? flashcardsA : flashcardsB;
          return (
            <div
              key={label}
              className="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-[color:var(--brand-black)]">
                  Cartes d’étude — Modèle {label}
                </h3>
                <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                  {cards.length ? `${cards.length} carte(s)` : "En attente"}
                </span>
              </div>
              {cards.length > 0 ? (
                <ul className="space-y-3 text-sm text-[color:var(--brand-charcoal)]">
                  {cards.map((card, index) => (
                    <li
                      key={`${label}-${index}`}
                      className="rounded-3xl bg-[rgba(18,18,18,0.05)] p-4"
                    >
                      <p className="font-semibold">Q · {card.question}</p>
                      <p className="mt-2 text-[color:var(--brand-charcoal)]/80">
                        R · {card.reponse}
                      </p>
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
        disabled={loadingSide !== null || !canGenerateFlashcards}
      >
        {loadingSide ? "Génération…" : "Créer les cartes pour les deux profils"}
      </button>

      <div className="section-divider" />

      <section className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm space-y-4 animate-section">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-[color:var(--brand-black)]">
              Synthèse finale
            </h3>
            <p className="text-sm text-[color:var(--brand-charcoal)]">
              Utilisez cette synthèse pour garder une trace des points communs, des différences et des pistes d’action dégagées par vos deux profils IA.
            </p>
          </div>
          <button
            type="button"
            onClick={handleFinalSummary}
            className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={finalSummaryLoading || isEditMode}
          >
            {finalSummaryLoading ? "Synthèse en cours…" : "Générer la synthèse"}
          </button>
        </div>
        {finalSummaryError && (
          <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-600">
            {finalSummaryError}
          </p>
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

