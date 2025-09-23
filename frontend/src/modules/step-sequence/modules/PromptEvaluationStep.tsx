import {
  ChangeEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  API_AUTH_KEY,
  API_BASE_URL,
  MODEL_OPTIONS,
  THINKING_OPTIONS,
  VERBOSITY_OPTIONS,
  type ThinkingChoice,
  type VerbosityChoice,
} from "../../../config";
import type { StepComponentProps } from "../types";
import { StepSequenceContext } from "../types";

const DEFAULT_PROMPT_TEXT = `Rôle: Tu es un tuteur pair qui anime un atelier dynamique.
Tâche: Proposer un plan d’atelier de 60 minutes pour revoir les structures de données avant l’intra.
Public: Étudiantes et étudiants de première année au cégep.
Contraintes: Prévoir trois segments (accroche, pratique guidée, conclusion). Mentionner un outil collaboratif utilisé.
Format attendu: Liste numérotée avec durées estimées.
Réponds uniquement avec le plan.`;

const DEFAULT_DEVELOPER_MESSAGE =
  "Tu es un évaluateur pédagogique spécialisé dans la rédaction de prompts. Analyse le prompt suivant et attribue un score global ainsi que quatre sous-scores (0-100). Réponds uniquement avec un JSON strict, sans commentaire supplémentaire.\n\nFormat attendu (JSON strict): {\"total\":int,\"clarity\":int,\"specificity\":int,\"structure\":int,\"length\":int,\"comments\":\"string\",\"advice\":[\"string\",...]}.\n- \"comments\" : synthèse en 2 phrases max.\n- \"advice\" : pistes concrètes (3 max).\n- Utilise des entiers pour les scores.\n- Pas d’autre texte hors du JSON.";

const VERBOSITY_VALUES: VerbosityChoice[] = ["low", "medium", "high"];
const THINKING_VALUES: ThinkingChoice[] = ["minimal", "medium", "high"];

interface PromptEvaluationStepContent {
  defaultText: string;
  developerMessage: string;
  model: string;
  verbosity: VerbosityChoice;
  thinking: ThinkingChoice;
}

export interface PromptEvaluationStepConfig
  extends PromptEvaluationStepContent {
  onChange?: (content: PromptEvaluationStepContent) => void;
}

type NumericScoreKey = "total" | "clarity" | "specificity" | "structure" | "length";

export interface PromptEvaluationScore {
  total: number;
  clarity?: number;
  specificity?: number;
  structure?: number;
  length?: number;
  comments?: string;
  advice?: string[];
}

export interface PromptEvaluationStepPayload {
  prompt: string;
  rawResponse: string;
  evaluation: PromptEvaluationScore | null;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function normalizeConfig(config: unknown): PromptEvaluationStepConfig {
  if (!config || typeof config !== "object") {
    return {
      defaultText: DEFAULT_PROMPT_TEXT,
      developerMessage: DEFAULT_DEVELOPER_MESSAGE,
      model: MODEL_OPTIONS[0]?.value ?? "gpt-5-nano",
      verbosity: "low",
      thinking: "minimal",
    } satisfies PromptEvaluationStepConfig;
  }

  const base = config as Partial<PromptEvaluationStepConfig>;
  const fallbackModel = MODEL_OPTIONS[0]?.value ?? "gpt-5-nano";

  const verbosity = VERBOSITY_VALUES.includes(base.verbosity as VerbosityChoice)
    ? (base.verbosity as VerbosityChoice)
    : "low";

  const thinking = THINKING_VALUES.includes(base.thinking as ThinkingChoice)
    ? (base.thinking as ThinkingChoice)
    : "minimal";

  return {
    defaultText: typeof base.defaultText === "string" ? base.defaultText : DEFAULT_PROMPT_TEXT,
    developerMessage:
      typeof base.developerMessage === "string" && base.developerMessage.trim().length > 0
        ? base.developerMessage
        : DEFAULT_DEVELOPER_MESSAGE,
    model:
      typeof base.model === "string" && base.model.trim().length > 0
        ? base.model.trim()
        : fallbackModel,
    verbosity,
    thinking,
    onChange: base.onChange,
  } satisfies PromptEvaluationStepConfig;
}

function isPromptEvaluationScore(value: unknown): value is PromptEvaluationScore {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PromptEvaluationScore> & Record<string, unknown>;
  if (typeof candidate.total !== "number" || !Number.isFinite(candidate.total)) {
    return false;
  }

  const numericKeys: NumericScoreKey[] = [
    "clarity",
    "specificity",
    "structure",
    "length",
  ];

  for (const key of numericKeys) {
    const score = candidate[key];
    if (
      score !== undefined &&
      (typeof score !== "number" || !Number.isFinite(score))
    ) {
      return false;
    }
  }

  if (candidate.comments !== undefined && typeof candidate.comments !== "string") {
    return false;
  }

  if (candidate.advice !== undefined) {
    if (!Array.isArray(candidate.advice)) {
      return false;
    }
    if (candidate.advice.some((item) => typeof item !== "string")) {
      return false;
    }
  }

  return true;
}

function normalizePayload(payload: unknown): PromptEvaluationStepPayload {
  if (!payload || typeof payload !== "object") {
    return {
      prompt: "",
      rawResponse: "",
      evaluation: null,
    } satisfies PromptEvaluationStepPayload;
  }

  const base = payload as Partial<PromptEvaluationStepPayload> & Record<string, unknown>;

  return {
    prompt: typeof base.prompt === "string" ? base.prompt : "",
    rawResponse: typeof base.rawResponse === "string" ? base.rawResponse : "",
    evaluation: isPromptEvaluationScore(base.evaluation) ? base.evaluation : null,
  } satisfies PromptEvaluationStepPayload;
}

function cleanJson(raw: string): string {
  return raw
    .replace(/Résumé du raisonnement[\s\S]*$/i, "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonCandidate(raw: string): string | null {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  return raw.slice(firstBrace, lastBrace + 1).trim();
}

function parseEvaluationObject(
  data: Record<string, unknown>
): PromptEvaluationScore | null {
  const toInteger = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.round(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return Math.round(parsed);
      }
    }
    return undefined;
  };

  const total = toInteger(data.total);
  if (typeof total !== "number") {
    return null;
  }

  const result: PromptEvaluationScore = { total };
  const clarity = toInteger(data.clarity);
  if (typeof clarity === "number") {
    result.clarity = clarity;
  }
  const specificity = toInteger(data.specificity);
  if (typeof specificity === "number") {
    result.specificity = specificity;
  }
  const structure = toInteger(data.structure);
  if (typeof structure === "number") {
    result.structure = structure;
  }
  const lengthScore = toInteger(data.length);
  if (typeof lengthScore === "number") {
    result.length = lengthScore;
  }
  if (typeof data.comments === "string") {
    result.comments = data.comments;
  }
  if (Array.isArray(data.advice)) {
    result.advice = data.advice.filter((item): item is string => typeof item === "string");
  }

  return result;
}

function parseEvaluation(raw: string): PromptEvaluationScore | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const attempts = new Set<string>();
  const cleaned = cleanJson(trimmed);
  if (cleaned) {
    attempts.add(cleaned);
  }
  const bracesCandidate = extractJsonCandidate(trimmed);
  if (bracesCandidate) {
    attempts.add(bracesCandidate);
  }

  let lastError: unknown = null;

  for (const candidate of attempts) {
    try {
      const data = JSON.parse(candidate) as Record<string, unknown>;
      const evaluation = parseEvaluationObject(data);
      if (evaluation) {
        return evaluation;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (import.meta.env.DEV && lastError) {
    // eslint-disable-next-line no-console
    console.warn("Unable to parse evaluation JSON", lastError);
  }

  return null;
}

function SparklesIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 4 13.5 8.5 18 10 13.5 11.5 12 16 10.5 11.5 6 10l4.5-1.5z" strokeLinejoin="round" />
      <path d="M6 18l1 2 2 .5-1-2L6 18zM17 3l.5 1.5L19 5l-1.5.5L17 3z" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 1-9 9" strokeLinecap="round" />
      <path d="M3 12a9 9 0 0 1 9-9" strokeLinecap="round" opacity={0.3} />
    </svg>
  );
}

export function PromptEvaluationStep({
  definition,
  config,
  payload,
  isEditMode,
  onAdvance,
  onUpdateConfig,
}: StepComponentProps): JSX.Element {
  const context = useContext(StepSequenceContext);
  const effectiveOnAdvance = context?.onAdvance ?? onAdvance;
  const effectiveOnUpdateConfig = context?.onUpdateConfig ?? onUpdateConfig;
  const isDesigner = context?.isEditMode ?? isEditMode;

  const typedConfig = useMemo(() => normalizeConfig(config), [config]);
  const { onChange, ...content } = typedConfig;

  const updateConfig = useCallback(
    (patch: Partial<PromptEvaluationStepContent>) => {
      const nextContent: PromptEvaluationStepContent = {
        defaultText: content.defaultText,
        developerMessage: content.developerMessage,
        model: content.model,
        verbosity: content.verbosity,
        thinking: content.thinking,
        ...patch,
      };
      onChange?.(nextContent);
      effectiveOnUpdateConfig({ ...nextContent, onChange });
    },
    [content, effectiveOnUpdateConfig, onChange]
  );

  const typedPayload = useMemo(() => normalizePayload(payload), [payload]);

  const [promptText, setPromptText] = useState<string>(() =>
    typedPayload.prompt || content.defaultText
  );
  const [evaluationRaw, setEvaluationRaw] = useState<string>(
    () => typedPayload.rawResponse
  );
  const [evaluation, setEvaluation] = useState<PromptEvaluationScore | null>(
    () => typedPayload.evaluation
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseWarning, setParseWarning] = useState<string | null>(null);

  useEffect(() => {
    setPromptText(typedPayload.prompt || content.defaultText);
    setEvaluationRaw(typedPayload.rawResponse);
    setEvaluation(typedPayload.evaluation);
  }, [
    typedPayload.prompt,
    typedPayload.rawResponse,
    typedPayload.evaluation,
    content.defaultText,
  ]);

  useEffect(() => {
    if (isDesigner) {
      setPromptText(content.defaultText);
      setEvaluation(null);
      setEvaluationRaw("");
      setParseWarning(null);
      setError(null);
    }
  }, [isDesigner, content.defaultText]);

  const handlePromptChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setPromptText(value);
      setEvaluation(null);
      setEvaluationRaw("");
      setParseWarning(null);
      setError(null);
    },
    []
  );

  const modelOption = useMemo(
    () => MODEL_OPTIONS.find((option) => option.value === content.model),
    [content.model]
  );
  const verbosityOption = useMemo(
    () => VERBOSITY_OPTIONS.find((option) => option.value === content.verbosity),
    [content.verbosity]
  );
  const thinkingOption = useMemo(
    () => THINKING_OPTIONS.find((option) => option.value === content.thinking),
    [content.thinking]
  );

  const runtimePrompt = isDesigner ? content.defaultText : promptText;
  const wordCount = useMemo(() => countWords(runtimePrompt), [runtimePrompt]);
  const trimmedPrompt = promptText.trim();

  const canRequestEvaluation = !isDesigner && !loading && trimmedPrompt.length > 0;
  const canContinue =
    !isDesigner &&
    !loading &&
    trimmedPrompt.length > 0 &&
    evaluationRaw.trim().length > 0;

  const handleEvaluate = useCallback(async () => {
    if (isDesigner) {
      return;
    }

    const text = promptText.trim();
    if (!text) {
      setError("Écris ton prompt avant de demander un score.");
      return;
    }

    setLoading(true);
    setError(null);
    setParseWarning(null);
    setEvaluation(null);
    setEvaluationRaw("");

    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (API_AUTH_KEY) {
        headers["X-API-Key"] = API_AUTH_KEY;
      }

      const response = await fetch(`${API_BASE_URL}/summary`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: `${content.developerMessage}\n\nPrompt à évaluer:\n${text}`,
          model: content.model,
          verbosity: content.verbosity,
          thinking: content.thinking,
        }),
      });

      if (!response.ok || !response.body) {
        const message = await response.text();
        throw new Error(message || "Impossible d’évaluer le prompt.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();

      const normalized = raw.trim();
      setEvaluationRaw(normalized);
      const parsed = parseEvaluation(normalized);
      setEvaluation(parsed);
      if (!parsed) {
        setParseWarning("Impossible d’interpréter automatiquement la réponse de l’IA.");
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Erreur inattendue";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [
    content.developerMessage,
    content.model,
    content.thinking,
    content.verbosity,
    isDesigner,
    promptText,
  ]);

  const handleAdvanceClick = useCallback(() => {
    if (!canContinue) {
      return;
    }

    effectiveOnAdvance({
      prompt: promptText,
      rawResponse: evaluationRaw,
      evaluation,
    });
  }, [
    canContinue,
    effectiveOnAdvance,
    evaluation,
    evaluationRaw,
    promptText,
  ]);

  const promptFieldId = `${definition.id}-prompt`;
  const developerFieldId = `${definition.id}-developer-message`;

  const configIds = useMemo(
    () => ({
      defaultText: `${definition.id}-config-default-text`,
      developerMessage: `${definition.id}-config-developer-message`,
      model: `${definition.id}-config-model`,
      verbosity: `${definition.id}-config-verbosity`,
      thinking: `${definition.id}-config-thinking`,
    }),
    [definition.id]
  );

  const handleDefaultTextConfigChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      updateConfig({ defaultText: event.target.value });
    },
    [updateConfig]
  );

  const handleDeveloperMessageConfigChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      updateConfig({ developerMessage: event.target.value });
    },
    [updateConfig]
  );

  const handleModelConfigChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      updateConfig({ model: event.target.value });
    },
    [updateConfig]
  );

  const handleVerbosityConfigChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as VerbosityChoice;
      updateConfig({
        verbosity: VERBOSITY_VALUES.includes(value) ? value : "low",
      });
    },
    [updateConfig]
  );

  const handleThinkingConfigChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as ThinkingChoice;
      updateConfig({
        thinking: THINKING_VALUES.includes(value) ? value : "minimal",
      });
    },
    [updateConfig]
  );

  const developerCard = (
    <section className="space-y-4 rounded-3xl border border-orange-100 bg-orange-50/70 p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
            Message développeur
          </p>
          <p className="text-sm text-orange-700/80">
            Envoyé avant le prompt pour guider l’évaluation.
          </p>
        </div>
        <SparklesIcon className="h-6 w-6 text-orange-500" />
      </div>
      <pre
        id={developerFieldId}
        className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-white p-4 font-mono text-xs leading-relaxed text-slate-800 shadow-inner"
      >
        {content.developerMessage}
      </pre>
      <dl className="grid gap-4 text-xs text-slate-600 sm:grid-cols-3">
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-500">
            Modèle
          </dt>
          <dd className="mt-1 font-medium text-slate-800">
            {modelOption
              ? `${modelOption.label} (${modelOption.value})`
              : content.model}
            {modelOption?.helper ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {modelOption.helper}
              </p>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-500">
            Verbosité
          </dt>
          <dd className="mt-1 font-medium text-slate-800">
            {verbosityOption
              ? `${verbosityOption.label} (${verbosityOption.value})`
              : content.verbosity}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-500">
            Raisonnement
          </dt>
          <dd className="mt-1 font-medium text-slate-800">
            {thinkingOption
              ? `${thinkingOption.label} (${thinkingOption.value})`
              : content.thinking}
          </dd>
        </div>
      </dl>
    </section>
  );

  const mainContent = (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Écris ton prompt
            </h2>
            <p className="text-sm text-slate-600">
              Prépare la consigne à faire analyser.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-600">
            {wordCount} mot{wordCount > 1 ? "s" : ""}
          </span>
        </div>
        <textarea
          id={promptFieldId}
          value={runtimePrompt}
          onChange={isDesigner || loading ? undefined : handlePromptChange}
          readOnly={isDesigner || loading}
          rows={10}
          className="min-h-[220px] w-full rounded-3xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-800 shadow-inner focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          placeholder="Décris la mission et les contraintes de ton prompt."
        />
        <p className="text-xs text-slate-500">
          Ce texte sera envoyé tel quel pour obtenir un score IA.
        </p>
      </section>

      {developerCard}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleEvaluate}
            disabled={!canRequestEvaluation}
            className="inline-flex items-center gap-2 rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <SpinnerIcon className="h-4 w-4 animate-spin" />
            ) : (
              <SparklesIcon className="h-4 w-4" />
            )}
            {loading ? "Analyse en cours…" : "Demander le score IA"}
          </button>
          <span className="text-xs text-slate-500">
            {isDesigner
              ? "Prévisualisation — indisponible en mode édition."
              : trimmedPrompt.length === 0
              ? "Écris ton prompt avant de demander une évaluation."
              : "Analyse la qualité du prompt avec l’agent IA."}
          </span>
        </div>
        {error ? (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {parseWarning ? (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {parseWarning}
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
        <label
          htmlFor={`${definition.id}-evaluation-raw`}
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Réponse de l’IA
        </label>
        <textarea
          id={`${definition.id}-evaluation-raw`}
          value={evaluationRaw}
          readOnly
          rows={Math.max(4, Math.min(12, evaluationRaw.split(/\n/).length + 1))}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700 shadow-inner"
          placeholder="La réponse JSON de l’IA apparaîtra ici."
        />
        <p className="text-xs text-slate-500">
          Cette sortie est conservée telle quelle pour la suite de l’activité.
        </p>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleAdvanceClick}
          disabled={!canContinue}
          className="inline-flex items-center gap-2 rounded-full bg-[color:var(--brand-black)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continuer
        </button>
      </div>
    </div>
  );

  if (isDesigner) {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm">
          {mainContent}
        </div>
        <aside className="space-y-6">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Configuration du module
            </h3>
            <p className="text-sm text-slate-600">
              Ajuste le texte par défaut et les paramètres d’évaluation.
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor={configIds.defaultText}
              className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Texte par défaut
            </label>
            <textarea
              id={configIds.defaultText}
              value={content.defaultText}
              onChange={handleDefaultTextConfigChange}
              rows={8}
              className="w-full rounded-3xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor={configIds.developerMessage}
              className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Message développeur
            </label>
            <textarea
              id={configIds.developerMessage}
              value={content.developerMessage}
              onChange={handleDeveloperMessageConfigChange}
              rows={10}
              className="w-full rounded-3xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            <p className="text-xs text-slate-500">
              Ce texte précède le prompt de l’étudiant pour demander le score.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label
                htmlFor={configIds.model}
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Modèle
              </label>
              <select
                id={configIds.model}
                value={content.model}
                onChange={handleModelConfigChange}
                className="w-full rounded-3xl border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.value})
                  </option>
                ))}
                {!modelOption && content.model ? (
                  <option value={content.model}>{content.model}</option>
                ) : null}
              </select>
            </div>
            <div className="space-y-2">
              <label
                htmlFor={configIds.verbosity}
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Verbosité
              </label>
              <select
                id={configIds.verbosity}
                value={content.verbosity}
                onChange={handleVerbosityConfigChange}
                className="w-full rounded-3xl border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                {VERBOSITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label
                htmlFor={configIds.thinking}
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Raisonnement
              </label>
              <select
                id={configIds.thinking}
                value={content.thinking}
                onChange={handleThinkingConfigChange}
                className="w-full rounded-3xl border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                {THINKING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  return mainContent;
}
