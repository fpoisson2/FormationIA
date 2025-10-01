import { API_BASE_URL, API_AUTH_KEY } from "./config";
import type { ModelChoice, VerbosityChoice, ThinkingChoice } from "./config";
import type { StepSequenceToolDefinition } from "./modules/step-sequence";

export type FieldType =
  | "bulleted_list"
  | "table_menu_day"
  | "table_menu_full"
  | "textarea_with_counter"
  | "two_bullets"
  | "reference_line"
  | "single_choice"
  | "multiple_choice";

export interface BaseFieldSpec {
  id: string;
  label: string;
  type: FieldType;
}

export interface BulletedListFieldSpec extends BaseFieldSpec {
  type: "bulleted_list";
  minBullets: number;
  maxBullets: number;
  maxWordsPerBullet: number;
  mustContainAny?: string[];
}

export interface TableMenuDayFieldSpec extends BaseFieldSpec {
  type: "table_menu_day";
  meals: string[];
}

export interface TableMenuFullFieldSpec extends BaseFieldSpec {
  type: "table_menu_full";
  meals: string[];
}

export interface TextareaWithCounterFieldSpec extends BaseFieldSpec {
  type: "textarea_with_counter";
  minWords: number;
  maxWords: number;
  forbidWords?: string[];
  tone?: string;
}

export interface TwoBulletsFieldSpec extends BaseFieldSpec {
  type: "two_bullets";
  maxWordsPerBullet: number;
}

export interface ReferenceLineFieldSpec extends BaseFieldSpec {
  type: "reference_line";
}

export interface ChoiceFieldOption {
  value: string;
  label: string;
  description?: string;
}

export interface SingleChoiceFieldSpec extends BaseFieldSpec {
  type: "single_choice";
  options: ChoiceFieldOption[];
  correctAnswer?: string;
}

export interface MultipleChoiceFieldSpec extends BaseFieldSpec {
  type: "multiple_choice";
  options: ChoiceFieldOption[];
  minSelections?: number;
  maxSelections?: number;
  correctAnswers?: string[];
}

export type FieldSpec =
  | BulletedListFieldSpec
  | TableMenuDayFieldSpec
  | TableMenuFullFieldSpec
  | TextareaWithCounterFieldSpec
  | TwoBulletsFieldSpec
  | ReferenceLineFieldSpec
  | SingleChoiceFieldSpec
  | MultipleChoiceFieldSpec;

export interface MissionStage {
  prompt: string;
  fields: FieldSpec[];
  allowEmpty?: boolean;
}

export interface Mission {
  id: string;
  title: string;
  ui_help: string;
  stages: MissionStage[];
  summary_hint: string;
  revelation: string;
}

export interface TableMenuDayValue {
  [meal: string]: string;
}

export interface TableMenuFullMealValue {
  plat: string;
  boisson: string;
  dessert: string;
}

export interface TableMenuFullValue {
  [meal: string]: TableMenuFullMealValue;
}

export type FieldValue =
  | string
  | string[]
  | TableMenuDayValue
  | TableMenuFullValue
  | null;

export type StageAnswer = Record<string, FieldValue>;

export interface StageRecord {
  stageIndex: number;
  prompt: string;
  values: StageAnswer;
}

export interface SubmitStagePayload {
  missionId: string;
  stageIndex: number;
  payload: StageAnswer;
  runId?: string;
}

export interface SubmitStageResponse {
  ok: boolean;
  runId: string;
}

export interface ActivityProgressRecord {
  completed: boolean;
  updatedAt: string;
  completedAt?: string;
}

export interface ProgressResponse {
  activities: Record<string, ActivityProgressRecord>;
  missions: Record<string, any>;
}

export interface UpdateActivityProgressPayload {
  activityId: string;
  completed: boolean;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/json",
    ...(init?.headers ?? {}),
  };
  if (API_AUTH_KEY) {
    headers["x-api-key"] = API_AUTH_KEY;
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erreur serveur (${response.status}).`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    const text = await response.text();
    if (!text) {
      throw new Error("Réponse JSON attendue.");
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error("Réponse JSON invalide.");
    }
  }

  return (await response.json()) as T;
}

function withAdminCredentials(init: RequestInit = {}, token?: string | null): RequestInit {
  const headers: HeadersInit = {
    ...(init.headers ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return {
    ...init,
    headers,
    credentials: "include",
  };
}

export interface AdminUser {
  username: string;
  roles: string[];
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  fromEnv?: boolean;
}

export interface AdminSession {
  token: string | null;
  expiresAt?: string | null;
  user: AdminUser;
}

export interface AdminLoginPayload {
  username: string;
  password: string;
  remember?: boolean;
}

export interface CreatorSignupPayload {
  username: string;
  password: string;
  invitationCode?: string;
}

export interface StudentSignupPayload extends CreatorSignupPayload {}

export interface AdminInvitationCode {
  code: string;
  role: string;
  createdAt: string;
  consumedAt?: string | null;
  consumedBy?: string | null;
}

export interface AdminInvitationListResponse {
  invitations: AdminInvitationCode[];
}

export interface AdminInvitationCreatePayload {
  role: string;
  code?: string;
}

export interface AdminInvitationCreateResponse {
  invitation: AdminInvitationCode;
}

export interface AdminAuthResponse {
  token: string;
  expiresAt?: string;
  user: AdminUser;
}

export interface AdminMeResponse {
  user: AdminUser;
  expiresAt?: string;
}

export interface AdminPlatform {
  issuer: string;
  clientId: string;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  jwksUri: string | null;
  deploymentId: string | null;
  deploymentIds: string[];
  audience: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  readOnly?: boolean;
}

export interface AdminPlatformPayload {
  issuer: string;
  clientId: string;
  authorizationEndpoint?: string | null;
  tokenEndpoint?: string | null;
  jwksUri?: string | null;
  deploymentId?: string | null;
  deploymentIds?: string[] | null;
  audience?: string | null;
}

export interface AdminPlatformListResponse {
  platforms: AdminPlatform[];
}

export interface AdminPlatformResponse {
  platform: AdminPlatform;
}

export type AdminPlatformSaveMode = "create" | "replace" | "patch";

export interface AdminLtiKeyset {
  privateKeyPath: string | null;
  publicKeyPath: string | null;
  updatedAt?: string | null;
  readOnly?: boolean;
  publicKey?: string | null;
}

export interface AdminLtiKeysetResponse {
  keyset: AdminLtiKeyset;
}

export interface AdminLtiKeyUploadPayload {
  privateKey?: string;
  publicKey?: string;
}

export interface AdminLtiUser {
  issuer: string;
  subject: string;
  displayName: string;
  email?: string | null;
  loginCount: number;
  firstLoginAt?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedActivities: number;
  completedActivityIds: string[];
  hasProgress: boolean;
  profileMissing?: boolean;
  progressIdentity?: string;
  completedActivitiesDetail?: Array<{
    activityId: string;
    completedAt?: string | null;
    updatedAt?: string | null;
  }>;
}

export interface PaginatedResponse<T> {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: T[];
}

export interface AdminLtiUsersQuery {
  page?: number;
  pageSize?: number;
  issuer?: string;
  subject?: string;
  search?: string;
  includeDetails?: boolean;
}

export interface AdminLocalUser extends AdminUser {}

export interface AdminLocalUsersResponse {
  users: AdminLocalUser[];
}

export interface AdminLocalUserCreatePayload {
  username: string;
  password: string;
  roles?: string[];
  isActive?: boolean;
}

export interface AdminLocalUserUpdatePayload {
  roles?: string[];
  isActive?: boolean;
}

export interface AdminLocalUserPasswordResetPayload {
  password: string;
}

export interface AdminLocalUserResponse {
  user: AdminLocalUser;
}

export interface ActivitySelectorHeaderConfig {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  badge?: string;
}

export interface ActivityGenerationAdminConfig {
  systemMessage?: string;
  developerMessage?: string;
}

export interface ActivityConfig {
  activities: any[];
  activitySelectorHeader?: ActivitySelectorHeaderConfig;
  activityGeneration?: ActivityGenerationAdminConfig;
}

export interface ActivityConfigResponse extends ActivityConfig {
  usesDefaultFallback?: boolean;
}

export interface ActivityImportPayload {
  activity: Record<string, unknown>;
}

export interface ActivityImportResponse {
  ok: boolean;
  activity: Record<string, unknown>;
  replaced: boolean;
}

export interface SaveActivityConfigResponse {
  ok: boolean;
  message: string;
}

export interface LandingPageHighlight {
  title: string;
  description: string;
}

export interface LandingPageStep {
  title: string;
  description: string;
}

export interface LandingPageLink {
  label: string;
  href: string;
}

export interface LandingPageContent {
  brandTagline: string;
  navActivitiesLabel: string;
  navIntegrationsLabel: string;
  navLoginLabel: string;
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  heroPrimaryCtaLabel: string;
  heroSecondaryCtaLabel: string;
  heroHighlights: LandingPageHighlight[];
  heroBadgeLabel: string;
  heroBadgeTitle: string;
  heroBadgeDescription: string;
  heroIdealForTitle: string;
  heroIdealForItems: string[];
  experiencesEyebrow: string;
  experiencesTitle: string;
  experiencesDescription: string;
  experiencesCards: LandingPageHighlight[];
  experiencesCardCtaLabel: string;
  integrationsEyebrow: string;
  integrationsTitle: string;
  integrationsDescription: string;
  integrationHighlights: LandingPageHighlight[];
  onboardingTitle: string;
  onboardingSteps: LandingPageStep[];
  onboardingCtaLabel: string;
  closingTitle: string;
  closingDescription: string;
  closingPrimaryCtaLabel: string;
  closingSecondaryCtaLabel: string;
  footerNote: string;
  footerLinks: LandingPageLink[];
}

export interface SaveLandingPageConfigResponse {
  ok: boolean;
  message: string;
}

export interface ActivityGenerationDetailsPayload {
  theme?: string;
  audience?: string;
  objectives?: string;
  deliverable?: string;
  constraints?: string;
}

export interface GenerateActivityPayload {
  model: ModelChoice;
  verbosity: VerbosityChoice;
  thinking: ThinkingChoice;
  details: ActivityGenerationDetailsPayload;
  existingActivityIds?: string[];
  systemMessage?: string;
  developerMessage?: string;
}


export interface ActivityGenerationJobToolCall {
  name: string;
  callId?: string | null;
  arguments: Record<string, unknown>;
  result: unknown;
  argumentsText?: string;
}

export interface ActivityGenerationFeedbackPayload {
  action: "approve" | "revise";
  message?: string | null;
}

export interface ConversationMessage {
  role: string;
  content?: string | null;
  toolCalls?: Array<{
    name: string;
    callId?: string;
    arguments: Record<string, unknown>;
  }> | null;
  toolCallId?: string | null;
  name?: string | null;
  timestamp: string;
}

export interface Conversation {
  id: string;
  jobId: string;
  username: string;
  activityId?: string | null;
  activityTitle?: string | null;
  status: "running" | "complete" | "error";
  messages: ConversationMessage[];
  modelName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListResponse {
  conversations: Conversation[];
}

export interface ConversationDetailResponse {
  conversation: Conversation;
}

export interface ConversationStreamHandlers {
  signal: AbortSignal;
  onConversation?: (conversation: Conversation) => void;
  onJob?: (job: ActivityGenerationJob) => void;
  onError?: (message: string) => void;
}


export type ActivityGenerationJobStatus =
  | "pending"
  | "running"
  | "complete"
  | "error";

export interface ActivityGenerationJob {
  jobId: string;
  status: ActivityGenerationJobStatus;
  message?: string | null;
  reasoningSummary?: string | null;
  activityId?: string | null;
  activityTitle?: string | null;
  activity?: Record<string, unknown> | null;
  error?: string | null;
  awaitingUserAction: boolean;
  pendingToolCall?: ActivityGenerationJobToolCall | null;
  expectingPlan: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityGenerationJobOptions {
  signal?: AbortSignal;
}

function normalizeActivityGenerationJobToolCall(
  raw: unknown
): ActivityGenerationJobToolCall | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const nameRaw = source.name;
  const callIdRaw = source.callId ?? source.call_id;
  const argumentsRaw = source.arguments;
  const resultRaw = source.result;
  const argumentsTextRaw = source.argumentsText ?? source.arguments_text;

  return {
    name: typeof nameRaw === "string" ? nameRaw : "",
    callId:
      typeof callIdRaw === "string"
        ? callIdRaw
        : callIdRaw == null
        ? undefined
        : String(callIdRaw),
    arguments:
      argumentsRaw && typeof argumentsRaw === "object"
        ? (argumentsRaw as Record<string, unknown>)
        : {},
    result: resultRaw,
    argumentsText:
      typeof argumentsTextRaw === "string"
        ? argumentsTextRaw
        : argumentsTextRaw == null
        ? undefined
        : String(argumentsTextRaw),
  };
}

export function normalizeActivityGenerationJob(
  raw: ActivityGenerationJob
): ActivityGenerationJob;
export function normalizeActivityGenerationJob(
  raw: Record<string, unknown>
): ActivityGenerationJob;
export function normalizeActivityGenerationJob(
  raw: Record<string, unknown> | ActivityGenerationJob
): ActivityGenerationJob {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid activity generation job payload");
  }

  const source = raw as Record<string, unknown>;

  const createdAtRaw = source.createdAt ?? source.created_at;
  const updatedAtRaw = source.updatedAt ?? source.updated_at;
  const messageRaw = source.message;
  const reasoningRaw = source.reasoningSummary ?? source.reasoning_summary;
  const activityIdRaw = source.activityId ?? source.activity_id;
  const activityTitleRaw = source.activityTitle ?? source.activity_title;
  const activityRaw = source.activity ?? source.activity_payload;
  const errorRaw = source.error;
  const awaitingRaw = source.awaitingUserAction ?? source.awaiting_user_action;
  const pendingRaw = source.pendingToolCall ?? source.pending_tool_call;
  const expectingRaw = source.expectingPlan ?? source.expecting_plan;

  return {
    jobId:
      typeof source.jobId === "string"
        ? source.jobId
        : typeof source.job_id === "string"
        ? (source.job_id as string)
        : typeof source.id === "string"
        ? (source.id as string)
        : "",
    status:
      (source.status as ActivityGenerationJobStatus) ??
      ("pending" as ActivityGenerationJobStatus),
    message:
      typeof messageRaw === "string" || messageRaw == null
        ? (messageRaw as string | null | undefined)
        : String(messageRaw),
    reasoningSummary:
      typeof reasoningRaw === "string" || reasoningRaw == null
        ? (reasoningRaw as string | null | undefined)
        : String(reasoningRaw),
    activityId:
      typeof activityIdRaw === "string" || activityIdRaw == null
        ? (activityIdRaw as string | null | undefined)
        : String(activityIdRaw),
    activityTitle:
      typeof activityTitleRaw === "string" || activityTitleRaw == null
        ? (activityTitleRaw as string | null | undefined)
        : String(activityTitleRaw),
    activity:
      activityRaw && typeof activityRaw === "object"
        ? (activityRaw as Record<string, unknown>)
        : null,
    error:
      typeof errorRaw === "string" || errorRaw == null
        ? (errorRaw as string | null | undefined)
        : String(errorRaw),
    awaitingUserAction:
      typeof awaitingRaw === "boolean" ? awaitingRaw : Boolean(awaitingRaw),
    pendingToolCall: normalizeActivityGenerationJobToolCall(pendingRaw),
    expectingPlan:
      typeof expectingRaw === "boolean" ? expectingRaw : Boolean(expectingRaw),
    createdAt:
      typeof createdAtRaw === "string"
        ? createdAtRaw
        : createdAtRaw instanceof Date
        ? createdAtRaw.toISOString()
        : new Date().toISOString(),
    updatedAt:
      typeof updatedAtRaw === "string"
        ? updatedAtRaw
        : updatedAtRaw instanceof Date
        ? updatedAtRaw.toISOString()
        : new Date().toISOString(),
  };
}

async function streamConversationByJob(
  jobId: string,
  token: string | null | undefined,
  handlers: ConversationStreamHandlers
): Promise<void> {
  const supportsEventSource =
    typeof window !== "undefined" && typeof window.EventSource === "function";

  const buildStreamUrl = (includeToken: boolean): string => {
    const params = new URLSearchParams();
    if (includeToken && token) {
      params.set("token", token);
    }
    const query = params.toString();
    return query
      ? `${API_BASE_URL}/admin/conversations/job/${jobId}/stream?${query}`
      : `${API_BASE_URL}/admin/conversations/job/${jobId}/stream`;
  };

  const parseEventPayload = (raw: string | null | undefined): unknown => {
    if (!raw) {
      return null;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.warn("Événement SSE conversation invalide", error);
      return null;
    }
  };

  if (supportsEventSource) {
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let source: EventSource | null = null;

        const cleanup = (close = true) => {
          if (settled) {
            return;
          }
          settled = true;
          if (close && source) {
            try {
              source.close();
            } catch (error) {
              console.warn("Erreur lors de la fermeture du flux SSE", error);
            }
          }
          handlers.signal.removeEventListener("abort", abortListener);
        };

        const abortListener = () => {
          cleanup();
          resolve();
        };

        if (handlers.signal.aborted) {
          resolve();
          return;
        }

        handlers.signal.addEventListener("abort", abortListener, { once: true });

        try {
          source = new EventSource(buildStreamUrl(true));
        } catch (error) {
          cleanup(false);
          reject(
            error instanceof Error
              ? error
              : new Error(
                  "Impossible d'établir la connexion temps réel avec l'assistant."
                )
          );
          return;
        }

        const handleConversation = (event: MessageEvent<string>) => {
          const parsed = parseEventPayload(event.data);
          if (parsed && typeof parsed === "object") {
            handlers.onConversation?.(parsed as Conversation);
          }
        };

        const handleJob = (event: MessageEvent<string>) => {
          const parsed = parseEventPayload(event.data);
          if (parsed && typeof parsed === "object") {
            handlers.onJob?.(
              normalizeActivityGenerationJob(parsed as Record<string, unknown>)
            );
          }
        };

        const handleServerError = (event: MessageEvent<string>) => {
          const parsed = parseEventPayload(event.data);
          const message =
            parsed && typeof parsed === "object" && "message" in parsed
              ? String((parsed as { message?: unknown }).message || "")
              : "Erreur lors de la diffusion de la conversation.";
          handlers.onError?.(
            message || "Erreur lors de la diffusion de la conversation."
          );
        };

        const handleClose = () => {
          cleanup();
          resolve();
        };

        source.addEventListener("conversation", handleConversation as EventListener);
        source.addEventListener("job", handleJob as EventListener);
        source.addEventListener("close", handleClose as EventListener);

        source.onerror = (event: Event) => {
          if (
            "data" in event && typeof (event as MessageEvent<string>).data === "string"
          ) {
            handleServerError(event as MessageEvent<string>);
            return;
          }
          if (source && source.readyState === EventSource.CLOSED) {
            handleClose();
            return;
          }
          cleanup();
          reject(
            new Error("Impossible d'établir la connexion temps réel avec l'assistant.")
          );
        };
      });
      return;
    } catch (eventSourceError) {
      if (!handlers.signal.aborted) {
        console.warn(
          "Connexion SSE native indisponible, utilisation du repli fetch",
          eventSourceError
        );
      } else {
        return;
      }
    }
  }

  const response = await fetch(
    buildStreamUrl(false),
    withAdminCredentials(
      {
        headers: {
          Accept: "text/event-stream",
        },
        signal: handlers.signal,
      },
      token
    )
  );

  if (!response.ok || !response.body) {
    const message = await response.text();
    throw new Error(
      message || "Impossible d'établir la connexion temps réel avec l'assistant."
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const processEvent = (rawEvent: string) => {
    if (!rawEvent.trim()) {
      return;
    }

    const lines = rawEvent.split("\n");
    let eventName = "message";
    let dataPayload = "";

    for (const line of lines) {
      if (!line) {
        continue;
      }
      if (line.startsWith(":")) {
        continue;
      }
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataPayload += `${line.slice(5)}\n`;
      }
    }

    const parsed = parseEventPayload(dataPayload);

    if (eventName === "conversation" && parsed && typeof parsed === "object") {
      handlers.onConversation?.(parsed as Conversation);
      return;
    }

    if (eventName === "job" && parsed && typeof parsed === "object") {
      handlers.onJob?.(normalizeActivityGenerationJob(parsed as Record<string, unknown>));
      return;
    }

    if (eventName === "error") {
      const message =
        parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as { message?: unknown }).message || "")
          : "Erreur lors de la diffusion de la conversation.";
      handlers.onError?.(
        message || "Erreur lors de la diffusion de la conversation."
      );
      return;
    }

    if (eventName === "close") {
      throw new Error("STREAM_CLOSED");
    }
  };

  try {
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
        processEvent(chunk);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (handlers.signal.aborted) {
      return;
    }
    if (error instanceof Error && error.message === "STREAM_CLOSED") {
      return;
    }
    throw error;
  }
}

export const activities = {
  getConfig: async (): Promise<ActivityConfigResponse> =>
    fetchJson<ActivityConfigResponse>(`${API_BASE_URL}/activities-config`),
};

export const landingPage = {
  get: async (): Promise<LandingPageContent> =>
    fetchJson<LandingPageContent>(`${API_BASE_URL}/landing-page`),
};

export const admin = {
  activities: {
    get: async (token?: string | null): Promise<ActivityConfigResponse> =>
      fetchJson<ActivityConfigResponse>(
        `${API_BASE_URL}/admin/activities`,
        withAdminCredentials({}, token)
      ),
    export: async (
      activityId: string,
      token?: string | null
    ): Promise<Record<string, unknown>> =>
      fetchJson<Record<string, unknown>>(
        `${API_BASE_URL}/admin/activities/${encodeURIComponent(activityId)}`,
        withAdminCredentials({}, token)
      ),
    import: async (
      payload: ActivityImportPayload,
      token?: string | null
    ): Promise<ActivityImportResponse> =>
      fetchJson<ActivityImportResponse>(
        `${API_BASE_URL}/admin/activities/import`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          token
        )
      ),
    save: async (
      payload: ActivityConfig,
      token?: string | null
    ): Promise<SaveActivityConfigResponse> =>
      fetchJson<SaveActivityConfigResponse>(
        `${API_BASE_URL}/admin/activities`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          token
        )
      ),
    generate: async (
      payload: GenerateActivityPayload,
      token?: string | null,
      options?: ActivityGenerationJobOptions
    ): Promise<ActivityGenerationJob> =>
      fetchJson<ActivityGenerationJob>(
        `${API_BASE_URL}/admin/activities/generate`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: options?.signal,
          },
          token
        )
      ).then(normalizeActivityGenerationJob),
    getGenerationJob: async (
      jobId: string,
      token?: string | null,
      options?: ActivityGenerationJobOptions
    ): Promise<ActivityGenerationJob> =>
      fetchJson<ActivityGenerationJob>(
        `${API_BASE_URL}/admin/activities/generate/${jobId}`,
        withAdminCredentials(
          {
            signal: options?.signal,
          },
          token
        )
      ).then(normalizeActivityGenerationJob),
    respondToGenerationJob: async (
      jobId: string,
      payload: ActivityGenerationFeedbackPayload,
      token?: string | null
    ): Promise<ActivityGenerationJob> =>
      fetchJson<ActivityGenerationJob>(
        `${API_BASE_URL}/admin/activities/generate/${jobId}/respond`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          token
        )
      ).then(normalizeActivityGenerationJob),
  },
  conversations: {
    list: async (
      token?: string | null,
      limit?: number
    ): Promise<ConversationListResponse> => {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      const querySuffix = params.toString();
      const url = querySuffix
        ? `${API_BASE_URL}/admin/conversations?${querySuffix}`
        : `${API_BASE_URL}/admin/conversations`;
      return fetchJson<ConversationListResponse>(
        url,
        withAdminCredentials({}, token)
      );
    },
    delete: async (
      conversationId: string,
      token?: string | null
    ): Promise<void> =>
      fetchJson<void>(
        `${API_BASE_URL}/admin/conversations/${conversationId}`,
        withAdminCredentials(
          {
            method: "DELETE",
          },
          token
        )
      ),
    get: async (
      conversationId: string,
      token?: string | null
    ): Promise<ConversationDetailResponse> =>
      fetchJson<ConversationDetailResponse>(
        `${API_BASE_URL}/admin/conversations/${conversationId}`,
        withAdminCredentials({}, token)
      ),
    getByJobId: async (
      jobId: string,
      token?: string | null
    ): Promise<ConversationDetailResponse> =>
      fetchJson<ConversationDetailResponse>(
        `${API_BASE_URL}/admin/conversations/job/${jobId}`,
        withAdminCredentials({}, token)
      ),
    streamByJob: async (
      jobId: string,
      token: string | null | undefined,
      handlers: ConversationStreamHandlers
    ): Promise<void> =>
      streamConversationByJob(jobId, token, handlers),
  },
  landingPage: {
    get: async (token?: string | null): Promise<LandingPageContent> =>
      fetchJson<LandingPageContent>(
        `${API_BASE_URL}/admin/landing-page`,
        withAdminCredentials({}, token)
      ),
    save: async (
      payload: LandingPageContent,
      token?: string | null
    ): Promise<SaveLandingPageConfigResponse> =>
      fetchJson<SaveLandingPageConfigResponse>(
        `${API_BASE_URL}/admin/landing-page`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          token
        )
      ),
  },
  auth: {
    login: async (payload: AdminLoginPayload): Promise<AdminAuthResponse> =>
      fetchJson<AdminAuthResponse>(`${API_BASE_URL}/admin/auth/login`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        )
      ),
    signupCreator: async (
      payload: CreatorSignupPayload
    ): Promise<AdminAuthResponse> =>
      fetchJson<AdminAuthResponse>(`${API_BASE_URL}/auth/signup`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        )
      ),
    signupStudent: async (
      payload: StudentSignupPayload
    ): Promise<AdminAuthResponse> =>
      fetchJson<AdminAuthResponse>(`${API_BASE_URL}/auth/signup/student`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        )
      ),
    logout: async (token?: string | null): Promise<void> => {
      await fetchJson<void>(
        `${API_BASE_URL}/admin/auth/logout`,
        withAdminCredentials(
          {
            method: "POST",
          },
          token
        )
      );
    },
    me: async (token?: string | null): Promise<AdminMeResponse> =>
      fetchJson<AdminMeResponse>(
        `${API_BASE_URL}/admin/auth/me`,
        withAdminCredentials({}, token)
      ),
  },
  invitations: {
    list: async (token?: string | null): Promise<AdminInvitationListResponse> =>
      fetchJson<AdminInvitationListResponse>(
        `${API_BASE_URL}/admin/invitations`,
        withAdminCredentials({}, token)
      ),
    create: async (
      payload: AdminInvitationCreatePayload,
      token?: string | null
    ): Promise<AdminInvitationCreateResponse> =>
      fetchJson<AdminInvitationCreateResponse>(
        `${API_BASE_URL}/admin/invitations`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          token
        )
      ),
  },
  platforms: {
    list: async (token?: string | null): Promise<AdminPlatformListResponse> =>
      fetchJson<AdminPlatformListResponse>(
        `${API_BASE_URL}/admin/lti-platforms`,
        withAdminCredentials({}, token)
      ),
    save: async (
      payload: AdminPlatformPayload,
      options: { mode?: AdminPlatformSaveMode; token?: string | null } = {}
    ): Promise<AdminPlatformResponse> => {
      const mode = options.mode ?? "replace";
      const method = mode === "create" ? "POST" : mode === "patch" ? "PATCH" : "PUT";
      return fetchJson<AdminPlatformResponse>(
        `${API_BASE_URL}/admin/lti-platforms`,
        withAdminCredentials(
          {
            method,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          options.token
        )
      );
    },
    remove: async (issuer: string, clientId: string, token?: string | null): Promise<void> => {
      const params = new URLSearchParams({ issuer, clientId });
      await fetchJson<void>(
        `${API_BASE_URL}/admin/lti-platforms?${params.toString()}`,
        withAdminCredentials(
          {
            method: "DELETE",
          },
          token
        )
      );
    },
  },
  ltiKeys: {
    get: async (token?: string | null): Promise<AdminLtiKeysetResponse> =>
      fetchJson<AdminLtiKeysetResponse>(
        `${API_BASE_URL}/admin/lti-keys`,
        withAdminCredentials({}, token)
      ),
    upload: async (
      payload: AdminLtiKeyUploadPayload,
      token?: string | null
    ): Promise<AdminLtiKeysetResponse> =>
      fetchJson<AdminLtiKeysetResponse>(
        `${API_BASE_URL}/admin/lti-keys`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          token
        )
      ),
  },
  ltiUsers: {
    list: async (
      query: AdminLtiUsersQuery = {},
      token?: string | null
    ): Promise<PaginatedResponse<AdminLtiUser>> => {
      const params = new URLSearchParams();
      if (query.page) params.set("page", String(query.page));
      if (query.pageSize) params.set("pageSize", String(query.pageSize));
      if (query.issuer) params.set("issuer", query.issuer);
      if (query.subject) params.set("subject", query.subject);
      if (query.search) params.set("search", query.search);
      if (query.includeDetails) params.set("includeDetails", "true");
      const querySuffix = params.toString();
      const url = querySuffix
        ? `${API_BASE_URL}/admin/lti-users?${querySuffix}`
        : `${API_BASE_URL}/admin/lti-users`;
      return fetchJson<PaginatedResponse<AdminLtiUser>>(url, withAdminCredentials({}, token));
    },
  },
  localUsers: {
    list: async (token?: string | null): Promise<AdminLocalUsersResponse> =>
      fetchJson<AdminLocalUsersResponse>(
        `${API_BASE_URL}/admin/users`,
        withAdminCredentials({}, token)
      ),
    create: async (
      payload: AdminLocalUserCreatePayload,
      token?: string | null
    ): Promise<AdminLocalUserResponse> =>
      fetchJson<AdminLocalUserResponse>(
        `${API_BASE_URL}/admin/users`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          token
        )
      ),
    update: async (
      username: string,
      payload: AdminLocalUserUpdatePayload,
      token?: string | null
    ): Promise<AdminLocalUserResponse> =>
      fetchJson<AdminLocalUserResponse>(
        `${API_BASE_URL}/admin/users/${encodeURIComponent(username)}`,
        withAdminCredentials(
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          token
        )
      ),
    resetPassword: async (
      username: string,
      payload: AdminLocalUserPasswordResetPayload,
      token?: string | null
    ): Promise<AdminLocalUserResponse> =>
      fetchJson<AdminLocalUserResponse>(
        `${API_BASE_URL}/admin/users/${encodeURIComponent(username)}/reset-password`,
        withAdminCredentials(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          token
        )
      ),
  },
};

export async function getMissions(): Promise<Mission[]> {
  return fetchJson<Mission[]>(`${API_BASE_URL}/missions`);
}

export async function getMission(id: string): Promise<Mission> {
  return fetchJson<Mission>(`${API_BASE_URL}/missions/${id}`);
}

export async function submitStage(payload: SubmitStagePayload): Promise<SubmitStageResponse> {
  return fetchJson<SubmitStageResponse>(`${API_BASE_URL}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

export async function getProgress(): Promise<ProgressResponse> {
  return fetchJson<ProgressResponse>(`${API_BASE_URL}/progress`, {
    method: "GET",
    credentials: "include",
  });
}

export async function updateActivityProgress(payload: UpdateActivityProgressPayload): Promise<void> {
  await fetchJson(`${API_BASE_URL}/progress/activity`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });
}
