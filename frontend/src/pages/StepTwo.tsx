import { ChangeEvent, Dispatch, SetStateAction, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import InfoCard from "../components/InfoCard";
import { API_BASE_URL, API_AUTH_KEY, MODEL_OPTIONS, THINKING_OPTIONS, VERBOSITY_OPTIONS, type ModelConfig } from "../config";

interface StepTwoProps {
  sourceText: string;
  configA: ModelConfig;
  configB: ModelConfig;
  setConfigA: (value: ModelConfig) => void;
  setConfigB: (value: ModelConfig) => void;
  summaryA: string;
  summaryB: string;
  setSummaryA: Dispatch<SetStateAction<string>>;
  setSummaryB: Dispatch<SetStateAction<string>>;
}

function StepTwo({
  sourceText,
  configA,
  configB,
  setConfigA,
  setConfigB,
  summaryA,
  summaryB,
  setSummaryA,
  setSummaryB,
}: StepTwoProps): JSX.Element {
  const navigate = useNavigate();
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  const disabled = useMemo(() => !sourceText.trim(), [sourceText]);

  useEffect(() => {
    if (!sourceText.trim()) {
      navigate("/stepsequence/etape-1", { replace: true });
    }
  }, [navigate, sourceText]);

  const canProceedToStepThree = Boolean(summaryA.trim() && summaryB.trim());

  const handleConfigChange = (
    side: "A" | "B",
    field: keyof ModelConfig,
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value as ModelConfig[keyof ModelConfig];
    if (side === "A") {
      setConfigA({ ...configA, [field]: value } as ModelConfig);
    } else {
      setConfigB({ ...configB, [field]: value } as ModelConfig);
    }
  };

  const launchBothSummaries = async () => {
    if (disabled) {
      setErrorA("Ajoutez un texte source avant de lancer la génération.");
      setErrorB("Ajoutez un texte source avant de lancer la génération.");
      return;
    }

    const runFor = async (
      config: ModelConfig,
      setSummary: (value: string) => void,
      setError: (value: string | null) => void,
      setLoading: (value: boolean) => void
    ) => {
      setError(null);
      setSummary("");
      setLoading(true);

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
            text: sourceText,
            model: config.model,
            verbosity: config.verbosity,
            thinking: config.thinking,
          }),
        });

        if (!response.ok || !response.body) {
          const errorMessage = await response.text();
          throw new Error(errorMessage || "Impossible de contacter le serveur");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          if (chunk) {
            setSummary((prev) => prev + chunk);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur inattendue";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    await Promise.all([
      runFor(configA, setSummaryA, setErrorA, setLoadingA),
      runFor(configB, setSummaryB, setErrorB, setLoadingB),
    ]);
  };

  return (
    <div className="space-y-12">
      <section className="page-section landing-panel bg-white/95 animate-section">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">Étape 2</span>
            <p className="text-sm text-[color:var(--brand-charcoal)]">
              Choisissez un modèle, la verbosité et l’effort de raisonnement pour vos variantes A et B. Suivez le flux en direct pour annoter les idées fortes et les tentatives plus audacieuses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/stepsequence/etape-1")}
            className="cta-button cta-button--light"
          >
            Revenir à l’étape 1
          </button>
        </div>
        <div className="my-6 section-divider" />
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between animate-section-delayed">
          <button
            type="button"
            onClick={launchBothSummaries}
            className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={loadingA || loadingB || disabled}
          >
            {loadingA || loadingB ? "Réponses en cours…" : "Lancer les deux requêtes"}
          </button>
        </div>
        <div className="my-6 section-divider" />
        <div className="grid gap-6 md:grid-cols-2 animate-section-delayed">
          {["A", "B"].map((side) => {
            const config = side === "A" ? configA : configB;
            const summary = side === "A" ? summaryA : summaryB;
            const setSummary = side === "A" ? setSummaryA : setSummaryB;
            const loading = side === "A" ? loadingA : loadingB;
            const setLoading = side === "A" ? setLoadingA : setLoadingB;
            const error = side === "A" ? errorA : errorB;
            const setError = side === "A" ? setErrorA : setErrorB;
            const profile = MODEL_OPTIONS.find((option) => option.value === config.model);

            return (
              <div key={side} className="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-[color:var(--brand-black)]">Profil {side}</h3>
                  <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
                    {loading ? "Réponse en cours…" : summary ? "Réponse générée" : "En attente"}
                  </span>
                </div>
                <div className="grid gap-3 text-sm">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor={`model-${side}`}>
                    Profil IA
                  </label>
                  <select
                    id={`model-${side}`}
                    value={config.model}
                    onChange={(event) => handleConfigChange(side as "A" | "B", "model", event)}
                    className="rounded-full border border-white/60 bg-white/80 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                  >
                    {MODEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {profile?.helper && (
                    <p className="text-xs text-[color:var(--brand-charcoal)]/70">
                      {profile.helper}
                    </p>
                  )}

                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor={`verbosity-${side}`}>
                    Verbosité attendue
                  </label>
                  <select
                    id={`verbosity-${side}`}
                    value={config.verbosity}
                    onChange={(event) => handleConfigChange(side as "A" | "B", "verbosity", event)}
                    className="rounded-full border border-white/60 bg-white/80 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                  >
                    {VERBOSITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor={`thinking-${side}`}>
                    Effort de raisonnement
                  </label>
                  <select
                    id={`thinking-${side}`}
                    value={config.thinking}
                    onChange={(event) => handleConfigChange(side as "A" | "B", "thinking", event)}
                    className="rounded-full border border-white/60 bg-white/80 px-4 py-2 text-sm shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                  >
                    {THINKING_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {error ? (
                  <p className="rounded-2xl bg-red-50 p-3 text-xs text-red-600">{error}</p>
                ) : (
                  <div className="min-h-[140px] rounded-3xl bg-[rgba(18,18,18,0.05)] p-4 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                    {summary ? summary : loading ? "Initialisation du flux…" : "Résultat en attente."}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="section-divider" />
      <section className="grid gap-4 animate-section md:grid-cols-2 lg:grid-cols-4">
        <InfoCard
          tone="red"
          title="Profils IA"
          description="Comparez un profil rapide (orienté temps de réponse) et un profil expert (orienté profondeur). L’objectif est d’observer comment la même consigne peut livrer deux angles différents."
        />
        <InfoCard
          tone="black"
          title="Verbosité"
          description={'De "Succinct" à "Détaillé", comparez comment l’IA sélectionne, enrichit ou condense les informations clés.'}
        />
        <InfoCard
          tone="sand"
          title="Effort de raisonnement"
          description={'Réglez le raisonnement de "Minimal" à "Analytique" pour visualiser la quantité d’arguments explicités.'}
        />
        <InfoCard
          tone="white"
          title="Astuce multi-plateforme"
          description="Dans les interfaces ChatGPT ou Gemini, vous pouvez également choisir le moteur utilisé (ex. « Rapide », « Avancé »). Recherchez l’option « Modèle » ou « Quality » dans les réglages pour reproduire vos comparaisons."
        />
      </section>

      <div className="section-divider" />
      <div className="flex justify-end animate-section">
        <button
          type="button"
          onClick={() => navigate("/stepsequence/etape-3")}
          className="cta-button cta-button--light disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!canProceedToStepThree}
        >
          Passer à l’étape 3
        </button>
      </div>
    </div>
  );
}

export default StepTwo;
