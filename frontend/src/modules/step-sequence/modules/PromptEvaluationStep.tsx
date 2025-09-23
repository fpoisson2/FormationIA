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

export interface PromptEvaluationStepConfig extends PromptEvaluationStepContent {
  onChange?: (content: PromptEvaluationStepContent) => void;
}

type DetailedScoreKey = "clarity" | "specificity" | "structure" | "length";

const SCORE_LABELS: Record<DetailedScoreKey, string> = {
  clarity: "Clarté",
  specificity: "Spécificité",
  structure: "Structure",
  length: "Longueur",
};

export interface PromptEvaluationScore {
  total: number;
  clarity: number;
  specificity: number;
  structure: number;
  length: number;
  comments: string;
  advice: string[];
}

export interface PromptEvaluationStepPayload {
  prompt: string;
  rawResponse: string;
  evaluation: PromptEvaluationScore | null;
  comment: string;
}

interface PromptEvaluationApiResponse {
  evaluation: PromptEvaluationScore;
  raw: string;
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
  const candidate = value as Record<string, unknown>;
  const numericKeys: (keyof PromptEvaluationScore)[] = [
    "total",
    "clarity",
    "specificity",
    "structure",
    "length",
  ];
  if (
    numericKeys.some((key) => {
      const score = candidate[key];
      return typeof score !== "number" || Number.isNaN(score);
    })
  ) {
    return false;
  }
  if (typeof candidate.comments !== "string") {
    return false;
  }
  if (!Array.isArray(candidate.advice) || candidate.advice.some((item) => typeof item !== "string")) {
    return false;
  }
  return true;
}

function normalizePayload(payload: unknown): PromptEvaluationStepPayload {
  if (!payload || typeof payload !== "object") {
    return {
      prompt: "",
      rawResponse: "",
      evaluation: null,
      comment: "",
    } satisfies PromptEvaluationStepPayload;
  }

  const base = payload as Partial<PromptEvaluationStepPayload> & Record<string, unknown>;

  return {
    prompt: typeof base.prompt === "string" ? base.prompt : "",
    rawResponse: typeof base.rawResponse === "string" ? base.rawResponse : "",
    evaluation: isPromptEvaluationScore(base.evaluation) ? base.evaluation : null,
    comment: typeof base.comment === "string" ? base.comment : "",
  } satisfies PromptEvaluationStepPayload;
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

  const typedPayload = useMemo(() => normalizePayload(payload), [payload]);

  const [promptText, setPromptText] = useState<string>(
    () => typedPayload.prompt || content.defaultText,
  );
  const [evaluation, setEvaluation] = useState<PromptEvaluationScore | null>(
    () => typedPayload.evaluation,
  );
  const [rawResponse, setRawResponse] = useState<string>(() => typedPayload.rawResponse);
  const [comment, setComment] = useState<string>(() => typedPayload.comment);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPromptText(typedPayload.prompt || content.defaultText);
    setEvaluation(typedPayload.evaluation);
    setRawResponse(typedPayload.rawResponse);
    setComment(typedPayload.comment);
  }, [
    typedPayload.prompt,
    typedPayload.evaluation,
    typedPayload.rawResponse,
    typedPayload.comment,
    content.defaultText,
  ]);

  useEffect(() => {
    if (isDesigner) {
      setPromptText(content.defaultText);
      setEvaluation(null);
      setRawResponse("");
      setComment("");
      setError(null);
    }
  }, [isDesigner, content.defaultText]);

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
    [content, effectiveOnUpdateConfig, onChange],
  );

  const handlePromptChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setPromptText(value);
    setEvaluation(null);
    setRawResponse("");
    setComment("");
    setError(null);
  }, []);

  const handleCommentChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setComment(event.target.value);
  }, []);

  const modelOption = useMemo(
    () => MODEL_OPTIONS.find((option) => option.value === content.model),
    [content.model],
  );
  const verbosityOption = useMemo(
    () => VERBOSITY_OPTIONS.find((option) => option.value === content.verbosity),
    [content.verbosity],
  );
  const thinkingOption = useMemo(
    () => THINKING_OPTIONS.find((option) => option.value === content.thinking),
    [content.thinking],
  );

  const runtimePrompt = isDesigner ? content.defaultText : promptText;
  const wordCount = useMemo(() => countWords(runtimePrompt), [runtimePrompt]);
  const trimmedPrompt = promptText.trim();

  const canRequestEvaluation = !isDesigner && !loading && trimmedPrompt.length > 0;
  const hasEvaluation = evaluation !== null;
  const canContinue =
    !isDesigner && !loading && hasEvaluation && trimmedPrompt.length > 0;

  const formattedRawResponse = useMemo(() => {
    if (!rawResponse) {
      return "";
    }
    try {
      const parsed = JSON.parse(rawResponse);
      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      return rawResponse;
    }
  }, [rawResponse]);

  const handleEvaluate = useCallback(async () => {
    if (isDesigner) {
      return;
    }

    const text = trimmedPrompt;
    if (!text) {
      setError("Écris ton prompt avant de demander un score.");
      return;
    }

    setLoading(true);
    setError(null);
    setEvaluation(null);
    setRawResponse("");
    setComment("");

    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (API_AUTH_KEY) {
        headers["X-API-Key"] = API_AUTH_KEY;
      }

      const response = await fetch(`${API_BASE_URL}/prompt-evaluation`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: text,
          developerMessage: content.developerMessage,
          model: content.model,
          verbosity: content.verbosity,
          thinking: content.thinking,
        }),
      });

      if (!response.ok) {
        let message = "Impossible d’obtenir le score IA.";
        try {
          const data = (await response.json()) as { detail?: unknown };
          if (typeof data.detail === "string" && data.detail.trim().length > 0) {
            message = data.detail;
          }
        } catch (error) {
          // Ignore JSON parsing errors and keep the default message.
        }
        throw new Error(message);
      }

      const data = (await response.json()) as PromptEvaluationApiResponse;
      setEvaluation(data.evaluation);
      setRawResponse(typeof data.raw === "string" ? data.raw : JSON.stringify(data.raw));
    } catch (cause) {
      const message =
        cause instanceof Error && cause.message
          ? cause.message
          : "Une erreur inattendue est survenue.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [
    isDesigner,
    trimmedPrompt,
    content.developerMessage,
    content.model,
    content.thinking,
    content.verbosity,
  ]);

  const handleAdvanceClick = useCallback(() => {
    if (!canContinue || !evaluation) {
      return;
    }

    effectiveOnAdvance({
      prompt: trimmedPrompt,
      rawResponse,
      evaluation,
      comment: comment.trim(),
    });
  }, [
    canContinue,
    effectiveOnAdvance,
    evaluation,
    rawResponse,
    comment,
    trimmedPrompt,
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
    [definition.id],
  );

  const handleDefaultTextConfigChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      updateConfig({ defaultText: event.target.value });
    },
    [updateConfig],
  );

  const handleDeveloperMessageConfigChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      updateConfig({ developerMessage: event.target.value });
    },
    [updateConfig],
  );

  const handleModelConfigChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      updateConfig({ model: event.target.value });
    },
    [updateConfig],
  );

  const handleVerbosityConfigChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as VerbosityChoice;
      updateConfig({
        verbosity: VERBOSITY_VALUES.includes(value) ? value : "low",
      });
    },
    [updateConfig],
  );

  const handleThinkingConfigChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as ThinkingChoice;
      updateConfig({
        thinking: THINKING_VALUES.includes(value) ? value : "minimal",
      });
    },
    [updateConfig],
  );

  const detailScores = (
    ["clarity", "specificity", "structure", "length"] as DetailedScoreKey[]
  ).map((key) =>
    evaluation
      ? {
          key,
          label: SCORE_LABELS[key],
          value: evaluation[key],
        }
      : null,
  ).filter((item): item is { key: DetailedScoreKey; label: string; value: number } => item !== null);

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

  const evaluationCard = (
    <section className="space-y-4 rounded-3xl border border-emerald-100 bg-emerald-50/70 p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
            Retour de l’évaluation
          </p>
          <p className="text-sm text-emerald-700/80">
            Analyse automatisée de la qualité du prompt.
          </p>
        </div>
        <SparklesIcon className="h-6 w-6 text-emerald-500" />
      </div>
      {hasEvaluation ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h3 className="text-lg font-semibold text-slate-900">
              Score global
            </h3>
            <span className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-1 text-sm font-semibold text-white">
              {evaluation.total} / 100
            </span>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {detailScores.map((item) => (
              <div
                key={item.key}
                className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm"
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                  {item.label}
                </dt>
                <dd className="mt-1 text-base font-semibold text-slate-900">
                  {item.value} / 100
                </dd>
              </div>
            ))}
          </dl>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
              Commentaire de l’IA
            </p>
            <p className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-800 shadow-inner">
              {evaluation.comments}
            </p>
          </div>
          {evaluation.advice.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                Pistes de bonification
              </p>
              <ul className="space-y-2 text-sm text-slate-700">
                {evaluation.advice.map((tip, index) => (
                  <li key={`${tip}-${index}`} className="flex gap-2">
                    <span className="mt-1 h-2 w-2 flex-none rounded-full bg-emerald-400" aria-hidden="true" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            <summary className="cursor-pointer font-semibold text-emerald-700">
              Voir la réponse JSON complète
            </summary>
            <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-900/90 p-4 text-xs text-emerald-100">
              {formattedRawResponse}
            </pre>
          </details>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-emerald-200 bg-white/60 px-4 py-6 text-sm text-slate-600">
          Lance une analyse pour obtenir un score détaillé.
        </p>
      )}
    </section>
  );

  const commentCard = (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Commentaire
          </p>
          <p className="text-sm text-slate-600">
            Note tes observations après avoir pris connaissance du score IA.
          </p>
        </div>
      </div>
      <textarea
        id={`${definition.id}-review-comment`}
        value={comment}
        onChange={hasEvaluation && !loading ? handleCommentChange : undefined}
        readOnly={!hasEvaluation || loading}
        rows={5}
        placeholder={
          hasEvaluation
            ? "Ajoute ton appréciation ou les prochaines étapes."
            : "Déclenche d’abord l’évaluation pour consigner un commentaire."
        }
        className="w-full rounded-3xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-800 shadow-inner focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      />
    </section>
  );

  const mainContent = (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Écris ton prompt</h2>
            <p className="text-sm text-slate-600">Prépare la consigne à faire analyser.</p>
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
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        ) : null}
      </section>

      {evaluationCard}

      {commentCard}

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
