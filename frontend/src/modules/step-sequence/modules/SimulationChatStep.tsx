import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  BulletedListFieldSpec,
  FieldSpec,
  FieldType,
  MultipleChoiceFieldSpec,
  SingleChoiceFieldSpec,
  StageAnswer,
  StageRecord,
  TableMenuDayValue,
  TableMenuFullValue,
  TextareaWithCounterFieldSpec,
  TwoBulletsFieldSpec,
} from "../../../api";
import { submitStage } from "../../../api";
import ChatBubble from "../../../components/ChatBubble";
import GuidedFields from "../../../components/GuidedFields";
import { StepSequenceContext } from "../types";
import type { StepComponentProps } from "../types";
import {
  API_AUTH_KEY,
  API_BASE_URL,
  MODEL_OPTIONS,
  THINKING_OPTIONS,
  VERBOSITY_OPTIONS,
  type ModelChoice,
  type ThinkingChoice,
  type VerbosityChoice,
} from "../../../config";
import {
  createDefaultFieldSpec,
  createInitialFormValues,
  defaultValidateFormValues,
  sanitizeFormValues,
  validateFieldSpec,
} from "./FormStep";

const DEFAULT_TITLE = "Simulation conversation";
const DEFAULT_HELP = "Réponds aux consignes et observe comment la demande évolue.";
const DEFAULT_SUBMIT_LABEL = "Continuer";
const DEFAULT_ROLE_AI = "IA";
const DEFAULT_ROLE_USER = "Participant";

export type SimulationChatMode = "scripted" | "live";

export const DEFAULT_SIMULATION_SYSTEM_MESSAGE =
  "Tu es un tuteur virtuel bienveillant qui accompagne un participant francophone." +
  " Donne des conseils concrets et aide la personne à progresser." +
  " Quand la conversation est terminée ou que l'objectif est atteint, signale la fin.";

const MODEL_CHOICES = new Set<ModelChoice>(MODEL_OPTIONS.map((option) => option.value));
const VERBOSITY_CHOICES = new Set<VerbosityChoice>(
  VERBOSITY_OPTIONS.map((option) => option.value)
);
const THINKING_CHOICES = new Set<ThinkingChoice>(THINKING_OPTIONS.map((option) => option.value));

const DEFAULT_MODEL_CHOICE = (
  MODEL_OPTIONS.find((option) => option.value === "gpt-5-mini")?.value ??
  MODEL_OPTIONS[0]?.value ??
  "gpt-5-mini"
) as ModelChoice;

const DEFAULT_VERBOSITY_CHOICE = (
  VERBOSITY_OPTIONS.find((option) => option.value === "medium")?.value ??
  VERBOSITY_OPTIONS[0]?.value ??
  "medium"
) as VerbosityChoice;

const DEFAULT_THINKING_CHOICE = (
  THINKING_OPTIONS.find((option) => option.value === "medium")?.value ??
  THINKING_OPTIONS[0]?.value ??
  "medium"
) as ThinkingChoice;

export interface SimulationChatConversationMessage {
  id: string;
  role: "ai" | "user";
  content: string;
  isStreaming?: boolean;
}

export interface SimulationChatConversationState {
  messages: SimulationChatConversationMessage[];
  finished: boolean;
}

interface SimulationChatRolesConfig {
  ai: string;
  user: string;
}

export interface SimulationChatStageConfig {
  id: string;
  prompt: string;
  fields: FieldSpec[];
  allowEmpty?: boolean;
  submitLabel?: string;
}

export interface SimulationChatConfig {
  title: string;
  help: string;
  roles: SimulationChatRolesConfig;
  missionId?: string;
  stages: SimulationChatStageConfig[];
  mode: SimulationChatMode;
  systemMessage: string;
  model: ModelChoice;
  verbosity: VerbosityChoice;
  thinking: ThinkingChoice;
}

export interface SimulationChatPayload {
  history: StageRecord[];
  runId?: string | null;
  conversation?: SimulationChatConversationState | null;
}

function generateStageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `stage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneFieldSpec(field: FieldSpec): FieldSpec {
  switch (field.type) {
    case "bulleted_list": {
      const spec = field as BulletedListFieldSpec;
      return {
        ...spec,
        mustContainAny: spec.mustContainAny ? [...spec.mustContainAny] : undefined,
      };
    }
    case "table_menu_day":
    case "table_menu_full": {
      return {
        ...field,
        meals: [...field.meals],
      };
    }
    case "textarea_with_counter": {
      const spec = field as TextareaWithCounterFieldSpec;
      return {
        ...spec,
        forbidWords: spec.forbidWords ? [...spec.forbidWords] : undefined,
      };
    }
    case "single_choice": {
      const spec = field as SingleChoiceFieldSpec;
      return {
        ...spec,
        options: spec.options.map((option) => ({ ...option })),
      };
    }
    case "multiple_choice": {
      const spec = field as MultipleChoiceFieldSpec;
      return {
        ...spec,
        options: spec.options.map((option) => ({ ...option })),
      };
    }
    default:
      return { ...field };
  }
}

function normalizeFieldSpecForStage(spec: unknown): FieldSpec | null {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return null;
  }

  const original = spec as Record<string, unknown>;
  const candidate = {
    ...original,
    label: typeof original.label === "string" ? original.label : "",
  };

  if (!validateFieldSpec(candidate)) {
    return null;
  }

  return cloneFieldSpec(candidate as FieldSpec);
}

function isStageAnswerLike(value: unknown): value is StageAnswer {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStageRecordLike(value: unknown): value is StageRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<StageRecord>;
  return (
    typeof record.stageIndex === "number" &&
    Number.isFinite(record.stageIndex) &&
    typeof record.prompt === "string" &&
    isStageAnswerLike(record.values)
  );
}

function normalizeStage(
  stage: unknown,
  fallbackId: string
): SimulationChatStageConfig | null {
  if (!stage || typeof stage !== "object") {
    return null;
  }
  const base = stage as Partial<SimulationChatStageConfig> & {
    fields?: unknown;
    allowEmpty?: unknown;
    submitLabel?: unknown;
    prompt?: unknown;
    id?: unknown;
  };

  const rawFields = Array.isArray(base.fields) ? base.fields : [];
  const fields = rawFields
    .map(normalizeFieldSpecForStage)
    .filter((field): field is FieldSpec => field !== null);

  const prompt = typeof base.prompt === "string" ? base.prompt : "";
  const allowEmpty = Boolean(base.allowEmpty);
  const submitLabel =
    typeof base.submitLabel === "string" && base.submitLabel.trim().length > 0
      ? base.submitLabel
      : undefined;
  const id =
    typeof base.id === "string" && base.id.trim().length > 0 ? base.id : fallbackId;

  return {
    id,
    prompt,
    fields,
    allowEmpty,
    submitLabel,
  };
}

function normalizeSimulationChatConfig(config: unknown): SimulationChatConfig {
  if (!config || typeof config !== "object") {
    return {
      title: DEFAULT_TITLE,
      help: DEFAULT_HELP,
      roles: { ai: DEFAULT_ROLE_AI, user: DEFAULT_ROLE_USER },
      stages: [],
      mode: "scripted",
      systemMessage: DEFAULT_SIMULATION_SYSTEM_MESSAGE,
      model: DEFAULT_MODEL_CHOICE,
      verbosity: DEFAULT_VERBOSITY_CHOICE,
      thinking: DEFAULT_THINKING_CHOICE,
    };
  }

  const base = config as Partial<SimulationChatConfig> & {
    roles?: Partial<SimulationChatRolesConfig>;
    stages?: unknown;
    mode?: unknown;
    systemMessage?: unknown;
    model?: unknown;
    verbosity?: unknown;
    thinking?: unknown;
  };

  const title =
    typeof base.title === "string"
      ? base.title
      : DEFAULT_TITLE;
  const help =
    typeof base.help === "string"
      ? base.help
      : DEFAULT_HELP;

  const aiRole =
    typeof base.roles?.ai === "string" ? base.roles.ai : DEFAULT_ROLE_AI;
  const userRole =
    typeof base.roles?.user === "string" ? base.roles.user : DEFAULT_ROLE_USER;

  const missionId =
    typeof base.missionId === "string" && base.missionId.trim().length > 0
      ? base.missionId
      : undefined;

  const rawStages = Array.isArray(base.stages) ? base.stages : [];
  const seenIds = new Set<string>();
  const stages: SimulationChatStageConfig[] = [];

  rawStages.forEach((entry, index) => {
    const normalized = normalizeStage(entry, `stage-${index + 1}-${generateStageId()}`);
    if (!normalized) {
      return;
    }
    let stageId = normalized.id;
    while (seenIds.has(stageId)) {
      stageId = `stage-${generateStageId()}`;
    }
    seenIds.add(stageId);
    stages.push({ ...normalized, id: stageId });
  });

  const normalizedMode: SimulationChatMode =
    typeof base.mode === "string" && base.mode.trim().toLowerCase() === "live"
      ? "live"
      : "scripted";

  const systemMessage =
    typeof base.systemMessage === "string" && base.systemMessage.trim().length > 0
      ? base.systemMessage.trim()
      : DEFAULT_SIMULATION_SYSTEM_MESSAGE;

  const normalizedModel =
    typeof base.model === "string" && MODEL_CHOICES.has(base.model.trim() as ModelChoice)
      ? (base.model.trim() as ModelChoice)
      : DEFAULT_MODEL_CHOICE;

  const normalizedVerbosity =
    typeof base.verbosity === "string" && VERBOSITY_CHOICES.has(base.verbosity.trim() as VerbosityChoice)
      ? (base.verbosity.trim() as VerbosityChoice)
      : DEFAULT_VERBOSITY_CHOICE;

  const normalizedThinking =
    typeof base.thinking === "string" && THINKING_CHOICES.has(base.thinking.trim() as ThinkingChoice)
      ? (base.thinking.trim() as ThinkingChoice)
      : DEFAULT_THINKING_CHOICE;

  return {
    title,
    help,
    roles: { ai: aiRole, user: userRole },
    missionId,
    stages,
    mode: normalizedMode,
    systemMessage,
    model: normalizedModel,
    verbosity: normalizedVerbosity,
    thinking: normalizedThinking,
  };
}

function parsePayload(
  payload: unknown,
  stageCount: number
): {
  history: StageRecord[];
  runId: string | null;
  nextStageIndex: number;
  conversation: SimulationChatConversationState;
} {
  const parseConversationPayload = (value: unknown): SimulationChatConversationState => {
    if (!value || typeof value !== "object") {
      return { messages: [], finished: false };
    }

    const base = value as Partial<SimulationChatConversationState> & {
      messages?: unknown;
      finished?: unknown;
    };

    const rawMessages = Array.isArray(base.messages) ? base.messages : [];
    const messages = rawMessages
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const candidate = entry as Partial<SimulationChatConversationMessage> & {
          role?: unknown;
          content?: unknown;
          id?: unknown;
        };
        const rawRole = typeof candidate.role === "string" ? candidate.role.trim().toLowerCase() : "user";
        const role: "ai" | "user" = rawRole === "ai" || rawRole === "assistant" ? "ai" : "user";
        const content = typeof candidate.content === "string" ? candidate.content : "";
        const id =
          typeof candidate.id === "string" && candidate.id.trim().length > 0
            ? candidate.id
            : generateStageId();
        return { id, role, content } satisfies SimulationChatConversationMessage;
      })
      .filter((message): message is SimulationChatConversationMessage => Boolean(message));

    const finished = Boolean(base.finished);

    return { messages, finished };
  };

  if (!payload || typeof payload !== "object") {
    return {
      history: [],
      runId: null,
      nextStageIndex: 0,
      conversation: { messages: [], finished: false },
    };
  }

  const base = payload as Partial<SimulationChatPayload>;
  const rawHistory = Array.isArray(base.history) ? base.history : [];
  const filteredHistory = rawHistory
    .filter(isStageRecordLike)
    .map((record) => {
      const rawIndex = Math.max(0, Math.trunc(record.stageIndex));
      const stageIndex = stageCount > 0 ? Math.min(rawIndex, stageCount - 1) : 0;
      const prompt = typeof record.prompt === "string" ? record.prompt : "";
      const values = isStageAnswerLike(record.values)
        ? (record.values as StageAnswer)
        : {};
      return {
        stageIndex,
        prompt,
        values,
      } satisfies StageRecord;
    })
    .filter((record) => stageCount === 0 || record.stageIndex < stageCount)
    .sort((a, b) => a.stageIndex - b.stageIndex);

  const runId =
    typeof base.runId === "string" && base.runId.trim().length > 0
      ? base.runId
      : null;

  const nextStageIndex = filteredHistory.reduce((acc, record) => {
    return Math.max(acc, record.stageIndex + 1);
  }, 0);

  return {
    history: filteredHistory,
    runId,
    nextStageIndex: Math.min(nextStageIndex, Math.max(stageCount, 0)),
    conversation: parseConversationPayload(base.conversation),
  };
}

interface SimulationChatStreamHandlers {
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onDone: (shouldEnd: boolean) => void;
  onError: (message: string) => void;
}

async function streamSimulationChatResponse(
  body: {
    systemMessage: string;
    messages: { role: string; content: string }[];
  } & Pick<SimulationChatConfig, "model" | "verbosity" | "thinking">,
  handlers: SimulationChatStreamHandlers
): Promise<void> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (API_AUTH_KEY) {
    headers["X-API-Key"] = API_AUTH_KEY;
  }

  const response = await fetch(`${API_BASE_URL}/simulation-chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: handlers.signal,
  });

  if (!response.ok || !response.body) {
    const message = await response.text();
    throw new Error(message || "Impossible de contacter le service de simulation.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      if (!chunk.trim()) {
        continue;
      }
      let eventName = "message";
      let dataPayload = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataPayload += `${line.slice(5)}\n`;
        }
      }
      const trimmed = dataPayload.trim();
      let data: unknown = null;
      if (trimmed) {
        try {
          data = JSON.parse(trimmed);
        } catch (error) {
          console.warn("Impossible d'analyser un événement SSE de simulation", error);
        }
      }
      if (eventName === "delta" && data && typeof (data as { text?: unknown }).text === "string") {
        handlers.onDelta((data as { text: string }).text);
      } else if (eventName === "done") {
        const shouldEnd =
          typeof (data as { shouldEnd?: unknown })?.shouldEnd === "boolean"
            ? Boolean((data as { shouldEnd?: unknown }).shouldEnd)
            : false;
        handlers.onDone(shouldEnd);
      } else if (eventName === "error") {
        const message =
          typeof (data as { message?: unknown })?.message === "string"
            ? ((data as { message: string }).message || "Erreur du serveur de simulation.")
            : "Erreur du serveur de simulation.";
        handlers.onError(message);
      }
    }
  }
}

function renderHistoryValue(field: FieldSpec, value: unknown): JSX.Element | null {
  switch (field.type) {
    case "bulleted_list": {
      const items = Array.isArray(value) ? (value as string[]) : [];
      return (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={`${field.id}-${index}`}>{item}</li>
          ))}
        </ul>
      );
    }
    case "two_bullets": {
      const items = Array.isArray(value) ? (value as string[]) : [];
      return (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={`${field.id}-${index}`}>{item}</li>
          ))}
        </ul>
      );
    }
    case "table_menu_day": {
      const table = (value as TableMenuDayValue) ?? {};
      return (
        <div className="mt-3 text-xs">
          <div className="flex flex-col gap-3 md:hidden">
            {field.meals.map((meal) => (
              <div key={meal} className="rounded-2xl bg-white/5 p-3">
                <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-white/70">{meal}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-white">{table[meal] ?? "—"}</p>
              </div>
            ))}
          </div>
          <table className="hidden w-full divide-y divide-white/20 md:table">
            <tbody>
              {field.meals.map((meal) => (
                <tr key={meal} className="divide-x divide-white/10">
                  <th className="bg-white/10 px-3 py-2 text-left font-semibold uppercase tracking-wide align-top">
                    {meal}
                  </th>
                  <td className="px-3 py-2 whitespace-pre-wrap break-words text-sm">{table[meal] ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "table_menu_full": {
      const table = (value as TableMenuFullValue) ?? {};
      return (
        <div className="mt-3 text-xs">
          <div className="flex flex-col gap-3 md:hidden">
            {field.meals.map((meal) => {
              const row = table[meal] ?? { plat: "—", boisson: "—", dessert: "—" };
              return (
                <div key={meal} className="rounded-2xl bg-white/5 p-3">
                  <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-white/70">{meal}</p>
                  <dl className="mt-2 space-y-2 text-sm text-white">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-white/60">Plat</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">{row.plat || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-white/60">Boisson</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">{row.boisson || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-white/60">Dessert</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">{row.dessert || "—"}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
          <table className="hidden w-full divide-y divide-white/20 md:table">
            <thead className="bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left align-top">Repas</th>
                <th className="px-3 py-2 text-left align-top">Plat</th>
                <th className="px-3 py-2 text-left align-top">Boisson</th>
                <th className="px-3 py-2 text-left align-top">Dessert</th>
              </tr>
            </thead>
            <tbody>
              {field.meals.map((meal) => {
                const row = table[meal] ?? { plat: "—", boisson: "—", dessert: "—" };
                return (
                  <tr key={meal} className="divide-x divide-white/10">
                    <th className="bg-white/10 px-3 py-2 text-left font-semibold uppercase tracking-wide align-top">
                      {meal}
                    </th>
                    <td className="px-3 py-2 whitespace-pre-wrap break-words text-sm">{row.plat || "—"}</td>
                    <td className="px-3 py-2 whitespace-pre-wrap break-words text-sm">{row.boisson || "—"}</td>
                    <td className="px-3 py-2 whitespace-pre-wrap break-words text-sm">{row.dessert || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    case "textarea_with_counter":
    case "reference_line": {
      const text = typeof value === "string" ? value : "";
      return <p className="mt-2 rounded-2xl bg-white/10 p-3 text-sm leading-relaxed">{text || "—"}</p>;
    }
    case "single_choice": {
      const spec = field as SingleChoiceFieldSpec;
      const selected = typeof value === "string" ? value : "";
      const option = spec.options.find((item) => item.value === selected);
      return (
        <p className="mt-2 rounded-2xl bg-white/10 p-3 text-sm leading-relaxed">{option ? option.label : "—"}</p>
      );
    }
    case "multiple_choice": {
      const spec = field as MultipleChoiceFieldSpec;
      const selections = Array.isArray(value) ? (value as string[]) : [];
      const labels = selections
        .map((item) => spec.options.find((option) => option.value === item)?.label)
        .filter((label): label is string => Boolean(label));
      if (labels.length === 0) {
        return <p className="mt-2 rounded-2xl bg-white/10 p-3 text-sm leading-relaxed">—</p>;
      }
      return (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {labels.map((label, index) => (
            <li key={`${field.id}-${index}`}>{label}</li>
          ))}
        </ul>
      );
    }
    default:
      return null;
  }
}

export function SimulationChatStep({
  config,
  payload,
  isEditMode,
  onAdvance,
  onUpdateConfig,
}: StepComponentProps): JSX.Element {
  const context = useContext(StepSequenceContext);
  const effectiveOnAdvance = context?.onAdvance ?? onAdvance;
  const effectiveOnUpdateConfig = context?.onUpdateConfig ?? onUpdateConfig;
  const isDesignerMode = context?.isEditMode ?? isEditMode;

  const typedConfig = useMemo(() => normalizeSimulationChatConfig(config), [config]);
  const stageCount = typedConfig.stages.length;

  const parsedPayload = useMemo(
    () => parsePayload(payload, stageCount),
    [payload, stageCount]
  );

  const payloadSignature = useMemo(
    () =>
      JSON.stringify({
        runId: parsedPayload.runId ?? null,
        nextStageIndex: parsedPayload.nextStageIndex,
        history: parsedPayload.history,
        conversation: parsedPayload.conversation,
      }),
    [parsedPayload]
  );

  const [history, setHistory] = useState<StageRecord[]>(parsedPayload.history);
  const [runId, setRunId] = useState<string | null>(parsedPayload.runId);
  const [stageIndex, setStageIndex] = useState<number>(parsedPayload.nextStageIndex);
  const [activeConfig, setActiveConfig] = useState<SimulationChatConfig>(typedConfig);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(
    typedConfig.stages[0]?.id ?? null
  );
  const [values, setValues] = useState<StageAnswer>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [displayedPrompt, setDisplayedPrompt] = useState("");
  const [isStreamingPrompt, setIsStreamingPrompt] = useState(false);
  const [fieldTypeDraft, setFieldTypeDraft] = useState<FieldType>("textarea_with_counter");
  const [conversationMessages, setConversationMessages] = useState<SimulationChatConversationMessage[]>(
    parsedPayload.conversation.messages
  );
  const [conversationFinished, setConversationFinished] = useState<boolean>(
    parsedPayload.conversation.finished
  );
  const [liveInput, setLiveInput] = useState("");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isStreamingLiveReply, setIsStreamingLiveReply] = useState(false);
  const liveRequestController = useRef<AbortController | null>(null);
  const conversationRef = useRef<SimulationChatConversationMessage[]>(
    parsedPayload.conversation.messages
  );

  const isLiveMode = activeConfig.mode === "live";

  useEffect(() => {
    setActiveConfig(typedConfig);
  }, [typedConfig]);

  useEffect(() => {
    setHistory(parsedPayload.history);
    setRunId(parsedPayload.runId);
    setStageIndex(parsedPayload.nextStageIndex);
    setConversationMessages(parsedPayload.conversation.messages);
    setConversationFinished(parsedPayload.conversation.finished);
    conversationRef.current = parsedPayload.conversation.messages;
  }, [payloadSignature]);

  useEffect(() => {
    conversationRef.current = conversationMessages;
  }, [conversationMessages]);

  useEffect(() => {
    return () => {
      liveRequestController.current?.abort();
    };
  }, []);

  useEffect(() => {
    setHistory((prev) =>
      prev
        .filter((record) => record.stageIndex < activeConfig.stages.length)
        .map((record) => ({ ...record }))
    );
    setStageIndex((prev) => Math.min(prev, Math.max(activeConfig.stages.length, 0)));
  }, [activeConfig.stages.length]);

  useEffect(() => {
    setSelectedStageId((previous) => {
      if (activeConfig.stages.length === 0) {
        return null;
      }
      if (previous && activeConfig.stages.some((stage) => stage.id === previous)) {
        return previous;
      }
      return activeConfig.stages[0]?.id ?? null;
    });
  }, [activeConfig.stages]);

  const selectedStageIndex = useMemo(() => {
    if (!selectedStageId) {
      return -1;
    }
    return activeConfig.stages.findIndex((stage) => stage.id === selectedStageId);
  }, [activeConfig.stages, selectedStageId]);

  useEffect(() => {
    if (!isDesignerMode) {
      return;
    }
    if (selectedStageIndex >= 0) {
      setStageIndex(selectedStageIndex);
    } else if (activeConfig.stages.length === 0) {
      setStageIndex(0);
    }
  }, [activeConfig.stages.length, isDesignerMode, selectedStageIndex]);

  const currentStage = stageIndex < activeConfig.stages.length ? activeConfig.stages[stageIndex] : null;

  useEffect(() => {
    if (isLiveMode) {
      setValues({});
      setErrors({});
      setDisplayedPrompt("");
      setIsStreamingPrompt(false);
      return;
    }
    if (!currentStage) {
      setValues({});
      setErrors({});
      setDisplayedPrompt("");
      setIsStreamingPrompt(false);
      return;
    }
    const existing = history.find((record) => record.stageIndex === stageIndex);
    setValues(createInitialFormValues(currentStage.fields, existing?.values));
    setErrors({});
    setServerError(null);

    const fullPrompt = currentStage.prompt ?? "";
    setDisplayedPrompt("");
    setIsStreamingPrompt(true);
    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setDisplayedPrompt(fullPrompt.slice(0, index));
      if (index >= fullPrompt.length) {
        window.clearInterval(interval);
        setIsStreamingPrompt(false);
      }
    }, 18);

    return () => {
      window.clearInterval(interval);
      setDisplayedPrompt(fullPrompt);
      setIsStreamingPrompt(false);
    };
  }, [currentStage, history, isLiveMode, stageIndex]);

  const handleValueChange = useCallback((fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const handleLiveInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setLiveInput(event.target.value);
  }, []);

  const handleLiveSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isDesignerMode || conversationFinished || isStreamingLiveReply) {
        return;
      }

      const trimmed = liveInput.trim();
      if (!trimmed) {
        setLiveError("Écris un message pour poursuivre la discussion.");
        return;
      }

      const userMessage: SimulationChatConversationMessage = {
        id: generateStageId(),
        role: "user",
        content: trimmed,
      };
      const baseMessages = [...conversationRef.current, userMessage];
      setLiveError(null);
      setLiveInput("");

      const aiMessageId = generateStageId();
      setConversationMessages((prev) => {
        const next = [
          ...prev,
          userMessage,
          { id: aiMessageId, role: "ai", content: "", isStreaming: true },
        ];
        conversationRef.current = next;
        return next;
      });

      const controller = new AbortController();
      liveRequestController.current?.abort();
      liveRequestController.current = controller;
      setIsStreamingLiveReply(true);

      try {
        await streamSimulationChatResponse(
          {
            systemMessage: activeConfig.systemMessage,
            model: activeConfig.model,
            verbosity: activeConfig.verbosity,
            thinking: activeConfig.thinking,
            messages: baseMessages.map((message) => ({
              role: message.role === "ai" ? "assistant" : "user",
              content: message.content,
            })),
          },
          {
            signal: controller.signal,
            onDelta: (chunk) => {
              if (!chunk) {
                return;
              }
              setConversationMessages((prev) => {
                const next = prev.map((message) =>
                  message.id === aiMessageId
                    ? { ...message, content: `${message.content}${chunk}` }
                    : message
                );
                conversationRef.current = next;
                return next;
              });
            },
            onDone: (shouldEnd) => {
              setConversationMessages((prev) => {
                const next = prev.map((message) =>
                  message.id === aiMessageId ? { ...message, isStreaming: false } : message
                );
                conversationRef.current = next;
                if (shouldEnd) {
                  const storedMessages = next.map(({ isStreaming: _omit, ...rest }) => rest);
                  effectiveOnAdvance({
                    history,
                    runId: runId ?? null,
                    conversation: { messages: storedMessages, finished: true },
                  });
                }
                return next;
              });
              setConversationFinished(shouldEnd);
              if (shouldEnd) {
                setLiveError(null);
              }
            },
            onError: (message) => {
              setConversationMessages((prev) => {
                const next = prev.filter((entry) => entry.id !== aiMessageId);
                conversationRef.current = next;
                return next;
              });
              setLiveError(message);
            },
          }
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setConversationMessages((prev) => {
            const next = prev.filter((entry) => entry.id !== aiMessageId);
            conversationRef.current = next;
            return next;
          });
          const message = error instanceof Error ? error.message : "Erreur inattendue.";
          setLiveError(message);
        }
      } finally {
        setIsStreamingLiveReply(false);
        liveRequestController.current = null;
      }
    },
    [
      activeConfig.systemMessage,
      conversationFinished,
      effectiveOnAdvance,
      history,
      isDesignerMode,
      isStreamingLiveReply,
      liveInput,
      runId,
    ]
  );

  const pushConfigChange = useCallback(
    (updater: (prev: SimulationChatConfig) => SimulationChatConfig) => {
      setActiveConfig((prev) => {
        const base = prev ?? typedConfig;
        const next = updater(base);
        effectiveOnUpdateConfig(next);
        return next;
      });
    },
    [effectiveOnUpdateConfig, typedConfig]
  );

  const handleTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      pushConfigChange((prev) => ({ ...prev, title: value }));
    },
    [pushConfigChange]
  );

  const handleHelpChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      pushConfigChange((prev) => ({ ...prev, help: value }));
    },
    [pushConfigChange]
  );

  const handleModeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const rawValue = event.target.value;
      const value: SimulationChatMode = rawValue === "live" ? "live" : "scripted";
      pushConfigChange((prev) => ({ ...prev, mode: value }));
    },
    [pushConfigChange]
  );

  const handleModelChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      pushConfigChange((prev) => ({
        ...prev,
        model: MODEL_CHOICES.has(value as ModelChoice) ? (value as ModelChoice) : prev.model,
      }));
    },
    [pushConfigChange]
  );

  const handleVerbosityChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      pushConfigChange((prev) => ({
        ...prev,
        verbosity: VERBOSITY_CHOICES.has(value as VerbosityChoice)
          ? (value as VerbosityChoice)
          : prev.verbosity,
      }));
    },
    [pushConfigChange]
  );

  const handleThinkingChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      pushConfigChange((prev) => ({
        ...prev,
        thinking: THINKING_CHOICES.has(value as ThinkingChoice)
          ? (value as ThinkingChoice)
          : prev.thinking,
      }));
    },
    [pushConfigChange]
  );

  const handleSystemMessageChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      pushConfigChange((prev) => ({ ...prev, systemMessage: value }));
    },
    [pushConfigChange]
  );

  const handleRoleChange = useCallback(
    (key: "ai" | "user", value: string) => {
      pushConfigChange((prev) => ({
        ...prev,
        roles: {
          ...prev.roles,
          [key]: value,
        },
      }));
    },
    [pushConfigChange]
  );

  const handleMissionIdChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      pushConfigChange((prev) => ({
        ...prev,
        missionId: value.length > 0 ? value : undefined,
      }));
    },
    [pushConfigChange]
  );

  const handleSelectStage = useCallback((stageId: string) => {
    setSelectedStageId(stageId);
  }, []);

  const handleAddStage = useCallback(() => {
    const newStage: SimulationChatStageConfig = {
      id: generateStageId(),
      prompt: "Nouvelle consigne",
      fields: [],
      allowEmpty: false,
    };
    pushConfigChange((prev) => ({
      ...prev,
      stages: [...prev.stages, newStage],
    }));
    setSelectedStageId(newStage.id);
  }, [pushConfigChange]);

  const handleRemoveStage = useCallback(
    (stageId: string) => {
      const removedIndex = activeConfig.stages.findIndex((stage) => stage.id === stageId);
      if (removedIndex === -1) {
        return;
      }
      pushConfigChange((prev) => ({
        ...prev,
        stages: prev.stages.filter((stage) => stage.id !== stageId),
      }));
      setSelectedStageId((prevId) => {
        if (prevId && prevId !== stageId) {
          return prevId;
        }
        const remaining = activeConfig.stages.filter((stage) => stage.id !== stageId);
        if (remaining.length === 0) {
          return null;
        }
        const nextIndex = Math.min(removedIndex, remaining.length - 1);
        return remaining[nextIndex]?.id ?? null;
      });
      setHistory((prev) =>
        prev
          .filter((record) => record.stageIndex !== removedIndex)
          .map((record) =>
            record.stageIndex > removedIndex
              ? { ...record, stageIndex: record.stageIndex - 1 }
              : record
          )
      );
      setStageIndex((prev) => {
        if (prev > removedIndex) {
          return prev - 1;
        }
        if (prev === removedIndex) {
          return Math.max(removedIndex, 0);
        }
        return prev;
      });
    },
    [activeConfig.stages, pushConfigChange]
  );

  const handleStagePromptChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const stageId = selectedStageId;
      if (!stageId) {
        return;
      }
      const value = event.target.value;
      pushConfigChange((prev) => {
        const index = prev.stages.findIndex((stage) => stage.id === stageId);
        if (index === -1) {
          return prev;
        }
        const nextStages = [...prev.stages];
        nextStages[index] = { ...nextStages[index], prompt: value };
        return { ...prev, stages: nextStages };
      });
    },
    [pushConfigChange, selectedStageId]
  );

  const handleAllowEmptyChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const stageId = selectedStageId;
      if (!stageId) {
        return;
      }
      const checked = event.target.checked;
      pushConfigChange((prev) => {
        const index = prev.stages.findIndex((stage) => stage.id === stageId);
        if (index === -1) {
          return prev;
        }
        const nextStages = [...prev.stages];
        nextStages[index] = { ...nextStages[index], allowEmpty: checked };
        return { ...prev, stages: nextStages };
      });
    },
    [pushConfigChange, selectedStageId]
  );

  const handleStageSubmitLabelChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const stageId = selectedStageId;
      if (!stageId) {
        return;
      }
      const value = event.target.value;
      pushConfigChange((prev) => {
        const index = prev.stages.findIndex((stage) => stage.id === stageId);
        if (index === -1) {
          return prev;
        }
        const nextStages = [...prev.stages];
        nextStages[index] = {
          ...nextStages[index],
          submitLabel: value.length > 0 ? value : undefined,
        };
        return { ...prev, stages: nextStages };
      });
    },
    [pushConfigChange, selectedStageId]
  );

  const handleAddField = useCallback(() => {
    const stageId = selectedStageId;
    if (!stageId) {
      return;
    }
    pushConfigChange((prev) => {
      const index = prev.stages.findIndex((stage) => stage.id === stageId);
      if (index === -1) {
        return prev;
      }
      const stage = prev.stages[index];
      const existingIds = new Set(stage.fields.map((field) => field.id));
      let field = createDefaultFieldSpec(fieldTypeDraft);
      while (existingIds.has(field.id)) {
        field = createDefaultFieldSpec(fieldTypeDraft);
      }
      const nextStage = { ...stage, fields: [...stage.fields, field] };
      const nextStages = [...prev.stages];
      nextStages[index] = nextStage;
      return { ...prev, stages: nextStages };
    });
  }, [fieldTypeDraft, pushConfigChange, selectedStageId]);

  const handleRemoveField = useCallback(
    (fieldIndex: number) => {
      const stageId = selectedStageId;
      if (!stageId) {
        return;
      }
      pushConfigChange((prev) => {
        const index = prev.stages.findIndex((stage) => stage.id === stageId);
        if (index === -1) {
          return prev;
        }
        const stage = prev.stages[index];
        const nextStage = {
          ...stage,
          fields: stage.fields.filter((_, idx) => idx !== fieldIndex),
        };
        const nextStages = [...prev.stages];
        nextStages[index] = nextStage;
        return { ...prev, stages: nextStages };
      });
    },
    [pushConfigChange, selectedStageId]
  );

  const handleFieldLabelChange = useCallback(
    (fieldIndex: number, value: string) => {
      const stageId = selectedStageId;
      if (!stageId) {
        return;
      }
      pushConfigChange((prev) => {
        const index = prev.stages.findIndex((stage) => stage.id === stageId);
        if (index === -1) {
          return prev;
        }
        const stage = prev.stages[index];
        const nextFields = stage.fields.map((field, idx) =>
          idx === fieldIndex ? { ...field, label: value } : field
        );
        const nextStages = [...prev.stages];
        nextStages[index] = { ...stage, fields: nextFields };
        return { ...prev, stages: nextStages };
      });
    },
    [pushConfigChange, selectedStageId]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isDesignerMode || !currentStage || isLiveMode) {
        return;
      }

      const sanitized = sanitizeFormValues(currentStage.fields, values);
      const fieldErrors = defaultValidateFormValues(
        currentStage.fields,
        sanitized,
        Boolean(currentStage.allowEmpty)
      );
      const filteredErrors: Record<string, string> = {};
      Object.entries(fieldErrors).forEach(([key, message]) => {
        if (typeof message === "string" && message.length > 0) {
          filteredErrors[key] = message;
        }
      });
      if (Object.keys(filteredErrors).length > 0) {
        setErrors(filteredErrors);
        return;
      }

      setErrors({});
      setServerError(null);

      let nextRunId = runId;
      if (activeConfig.missionId) {
        setIsSubmitting(true);
        try {
          const response = await submitStage({
            missionId: activeConfig.missionId,
            stageIndex,
            payload: sanitized,
            runId: runId ?? undefined,
          });
          nextRunId = response.runId;
          setRunId(response.runId);
        } catch (error) {
          setServerError((error as Error).message || "Impossible d’enregistrer la manche.");
          return;
        } finally {
          setIsSubmitting(false);
        }
      }

      const record: StageRecord = {
        stageIndex,
        prompt: currentStage.prompt,
        values: sanitized,
      };
      const filteredHistory = history.filter((entry) => entry.stageIndex !== stageIndex);
      const nextHistory = [...filteredHistory, record].sort(
        (a, b) => a.stageIndex - b.stageIndex
      );
      setHistory(nextHistory);

      const nextIndex = stageIndex + 1;
      setStageIndex(nextIndex);

      if (nextIndex >= activeConfig.stages.length) {
        effectiveOnAdvance({
          history: nextHistory,
          runId: nextRunId ?? runId ?? null,
        });
      }
    },
    [
      activeConfig.missionId,
      currentStage,
      effectiveOnAdvance,
      history,
      isDesignerMode,
      runId,
      isLiveMode,
      stageIndex,
      values,
    ]
  );

  const historyEntries = useMemo(
    () => (isLiveMode ? [] : history.filter((entry) => entry.stageIndex < stageIndex)),
    [history, isLiveMode, stageIndex]
  );

  const allowEmpty = isLiveMode ? true : Boolean(currentStage?.allowEmpty);
  const hasBlockingErrors = isLiveMode ? false : !allowEmpty && Object.keys(errors).length > 0;
  const submitLabel = !isLiveMode && currentStage
    ? currentStage.submitLabel && currentStage.submitLabel.length > 0
      ? currentStage.submitLabel
      : stageIndex === activeConfig.stages.length - 1
        ? "Terminer"
        : DEFAULT_SUBMIT_LABEL
    : DEFAULT_SUBMIT_LABEL;
  const promptForDisplay = isLiveMode
    ? ""
    : displayedPrompt.length > 0
      ? displayedPrompt
      : isStreamingPrompt
        ? ""
        : currentStage?.prompt ?? "";

  const roleLabels = activeConfig.roles;
  const selectedStage =
    selectedStageIndex >= 0 ? activeConfig.stages[selectedStageIndex] : null;
  const canSendLiveMessage =
    !isDesignerMode && !conversationFinished && !isStreamingLiveReply && liveInput.trim().length > 0;

  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      <div className="flex-1 space-y-8">

        <section className="space-y-6">
          <div className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-sm">
            <div className="flex max-h-none flex-col gap-5 overflow-visible pr-2 lg:max-h-[60vh] lg:overflow-y-auto">
              {isLiveMode
                ? conversationMessages.map((message) => (
                    <ChatBubble
                      key={message.id}
                      role={message.role}
                      roleLabel={message.role === "ai" ? roleLabels.ai : roleLabels.user}
                      isStreaming={Boolean(message.isStreaming)}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    </ChatBubble>
                  ))
                : historyEntries.map((entry) => {
                    const stageTemplate = activeConfig.stages[entry.stageIndex];
                    return (
                      <div key={`history-${entry.stageIndex}`} className="space-y-3">
                        <ChatBubble
                          role="ai"
                          title={`Manche ${entry.stageIndex + 1}`}
                          roleLabel={roleLabels.ai}
                        >
                          <p>{stageTemplate?.prompt ?? entry.prompt}</p>
                        </ChatBubble>
                        <ChatBubble role="user" roleLabel={roleLabels.user}>
                          {stageTemplate?.fields.map((field) => (
                            <div key={field.id}>
                              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
                                {field.label}
                              </p>
                              {renderHistoryValue(field, entry.values[field.id])}
                            </div>
                          ))}
                        </ChatBubble>
                      </div>
                    );
                  })}
              {!isLiveMode && currentStage ? (
                <ChatBubble
                  role="ai"
                  title={`Manche ${Math.min(stageIndex + 1, stageCount)}`}
                  roleLabel={roleLabels.ai}
                  isStreaming={isStreamingPrompt}
                >
                  <p>{promptForDisplay}</p>
                </ChatBubble>
              ) : null}
            </div>
          </div>

          {isLiveMode ? (
            conversationFinished ? (
              <div className="rounded-3xl border border-white/60 bg-white/90 p-6 text-sm text-[color:var(--brand-charcoal)]/80">
                La discussion est terminée.
              </div>
            ) : (
              <form onSubmit={handleLiveSubmit} className="space-y-4">
                <ChatBubble
                  role="user"
                  title="À toi de jouer"
                  roleLabel={roleLabels.user}
                  bubbleClassName="bg-white text-[color:var(--brand-black)] border border-[color:var(--brand-red)]/20 shadow-xl md:max-w-none"
                  containerClassName="w-full"
                  chipClassName="bg-[color:var(--brand-red)]/15 text-[color:var(--brand-red)]"
                >
                  <p className="text-xs italic text-[color:var(--brand-charcoal)]/80">
                    {activeConfig.help}
                  </p>
                  <textarea
                    value={liveInput}
                    onChange={handleLiveInputChange}
                    className="mt-4 w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/40"
                    placeholder="Écris ta réponse ici…"
                    rows={4}
                    disabled={isDesignerMode || isStreamingLiveReply}
                  />
                  {liveError ? (
                    <p className="text-sm font-semibold text-red-600">{liveError}</p>
                  ) : null}
                </ChatBubble>
                <div className="flex items-center justify-end gap-4">
                  {isStreamingLiveReply ? (
                    <span className="text-sm text-[color:var(--brand-charcoal)]/80">
                      Réponse en cours…
                    </span>
                  ) : null}
                  <button
                    type="submit"
                    className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canSendLiveMessage}
                  >
                    Envoyer
                  </button>
                </div>
              </form>
            )
          ) : currentStage ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <ChatBubble
                role="user"
                title="À toi de jouer"
                roleLabel={roleLabels.user}
                bubbleClassName="bg-white text-[color:var(--brand-black)] border border-[color:var(--brand-red)]/20 shadow-xl md:max-w-none"
                containerClassName="w-full"
                chipClassName="bg-[color:var(--brand-red)]/15 text-[color:var(--brand-red)]"
              >
                <p className="text-xs italic text-[color:var(--brand-charcoal)]/80">
                  {activeConfig.help}
                </p>
                <GuidedFields
                  fields={currentStage.fields}
                  values={values}
                  onChange={handleValueChange}
                  errors={errors}
                />
                {serverError ? (
                  <p className="text-sm font-semibold text-red-600">{serverError}</p>
                ) : null}
              </ChatBubble>
              <div className="flex items-center justify-end gap-4">
                {isSubmitting ? (
                  <span className="text-sm text-[color:var(--brand-charcoal)]/80">
                    Envoi…
                  </span>
                ) : null}
                <button
                  type="submit"
                  className="cta-button cta-button--primary disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSubmitting || hasBlockingErrors}
                >
                  {submitLabel}
                </button>
              </div>
            </form>
          ) : (
            <div className="rounded-3xl border border-white/60 bg-white/90 p-6 text-sm text-[color:var(--brand-charcoal)]/80">
              {stageCount === 0
                ? "Ajoute une manche dans le panneau de droite pour lancer la simulation."
                : "La simulation est terminée."}
            </div>
          )}
        </section>
      </div>

      {isDesignerMode ? (
        <aside className="w-full max-w-md space-y-6 rounded-2xl border border-slate-200 p-4">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[color:var(--brand-black)]">
              Paramètres généraux
            </h2>
            <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
              Titre
              <input
                type="text"
                value={activeConfig.title}
                onChange={handleTitleChange}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
              Aide contextuelle
              <textarea
                value={activeConfig.help}
                onChange={handleHelpChange}
                className="h-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
              Mode
              <select
                value={activeConfig.mode}
                onChange={handleModeChange}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="scripted">Simulation guidée</option>
                <option value="live">Discussion en direct (API)</option>
              </select>
            </label>
            {isLiveMode ? (
              <>
                <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                  Message système
                  <textarea
                    value={activeConfig.systemMessage}
                    onChange={handleSystemMessageChange}
                    className="h-32 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                    Modèle
                    <select
                      value={activeConfig.model}
                      onChange={handleModelChange}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      {MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                    Verbosité
                    <select
                      value={activeConfig.verbosity}
                      onChange={handleVerbosityChange}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      {VERBOSITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                    Raisonnement
                    <select
                      value={activeConfig.thinking}
                      onChange={handleThinkingChange}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      {THINKING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            ) : null}
            <div className="grid grid-cols-1 gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                Libellé du rôle IA
                <input
                  type="text"
                  value={roleLabels.ai}
                  onChange={(event) => handleRoleChange("ai", event.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                Libellé du rôle usager
                <input
                  type="text"
                  value={roleLabels.user}
                  onChange={(event) => handleRoleChange("user", event.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            {!isLiveMode ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                Mission associée (optionnel)
                <input
                  type="text"
                  value={activeConfig.missionId ?? ""}
                  onChange={handleMissionIdChange}
                  placeholder="Identifiant de mission"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            ) : null}
          </div>

          {isLiveMode ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-[color:var(--brand-charcoal)]/70">
              Le mode discussion directe n’utilise pas les manches configurées.
            </p>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[color:var(--brand-black)]">
                    Manches
                  </h3>
                  <button
                    type="button"
                    className="cta-button cta-button--light"
                    onClick={handleAddStage}
                  >
                    Ajouter une manche
                  </button>
                </div>
                <ul className="space-y-2">
                  {activeConfig.stages.map((stage, index) => (
                    <li
                      key={stage.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectStage(stage.id)}
                        className={`text-left text-xs font-semibold ${
                          stage.id === selectedStageId
                            ? "text-[color:var(--brand-red)]"
                            : "text-[color:var(--brand-charcoal)]/80"
                        }`}
                      >
                        Manche {index + 1}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-600 hover:underline"
                        onClick={() => handleRemoveStage(stage.id)}
                      >
                        Retirer
                      </button>
                    </li>
                  ))}
                  {activeConfig.stages.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-[color:var(--brand-charcoal)]/70">
                      Aucune manche configurée.
                    </li>
                  ) : null}
                </ul>
              </div>

              {selectedStage ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-[color:var(--brand-black)]">
                    Paramètres de la manche
                  </h3>
                  <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                    Prompt
                    <textarea
                      value={selectedStage.prompt}
                      onChange={handleStagePromptChange}
                      className="h-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-[color:var(--brand-charcoal)]">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedStage.allowEmpty)}
                      onChange={handleAllowEmptyChange}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Autoriser la réponse vide
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                    Libellé du bouton
                    <input
                      type="text"
                      value={selectedStage.submitLabel ?? ""}
                      onChange={handleStageSubmitLabelChange}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="space-y-2">
                    <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                      Type de champ
                      <select
                        value={fieldTypeDraft}
                        onChange={(event) => setFieldTypeDraft(event.target.value as FieldType)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="textarea_with_counter">Zone de texte</option>
                        <option value="bulleted_list">Liste à puces</option>
                        <option value="two_bullets">Deux puces</option>
                        <option value="single_choice">Choix unique</option>
                        <option value="multiple_choice">Choix multiples</option>
                        <option value="table_menu_day">Table · journée</option>
                        <option value="table_menu_full">Table · complète</option>
                        <option value="reference_line">Référence</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="cta-button cta-button--light w-full"
                      onClick={handleAddField}
                    >
                      Ajouter un champ
                    </button>
                    <ul className="space-y-2">
                      {selectedStage.fields.map((field, index) => (
                        <li
                          key={field.id}
                          className="space-y-2 rounded-lg border border-slate-200 p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase text-[color:var(--brand-charcoal)]/70">
                              {field.type}
                            </span>
                            <button
                              type="button"
                              className="text-xs font-semibold text-red-600 hover:underline"
                              onClick={() => handleRemoveField(index)}
                            >
                              Retirer
                            </button>
                          </div>
                          <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--brand-charcoal)]">
                            Libellé
                            <input
                              type="text"
                              value={field.label}
                              onChange={(event) =>
                                handleFieldLabelChange(index, event.target.value)
                              }
                              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                          </label>
                        </li>
                      ))}
                      {selectedStage.fields.length === 0 ? (
                        <li className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-[color:var(--brand-charcoal)]/70">
                          Aucun champ configuré.
                        </li>
                      ) : null}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-[color:var(--brand-charcoal)]/70">
                  Sélectionne une manche pour la modifier.
                </p>
              )}
            </>
          )}
        </aside>
      ) : null}
    </div>
  );
}

export default SimulationChatStep;
