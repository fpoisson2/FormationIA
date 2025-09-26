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
}

export interface MultipleChoiceFieldSpec extends BaseFieldSpec {
  type: "multiple_choice";
  options: ChoiceFieldOption[];
  minSelections?: number;
  maxSelections?: number;
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

export interface ActivityConfig {
  activities: any[];
  activitySelectorHeader?: ActivitySelectorHeaderConfig;
}

export interface ActivityConfigResponse extends ActivityConfig {
  usesDefaultFallback?: boolean;
}

export interface SaveActivityConfigResponse {
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
}

export interface ActivityGenerationToolCall {
  name: string;
  callId?: string | null;
  arguments: Record<string, unknown>;
  argumentsText?: string | null;
  definition?: StepSequenceToolDefinition;
}

export interface ActivityGenerationResponse {
  toolCall: ActivityGenerationToolCall;
  reasoningSummary?: string | null;
}

export const activities = {
  getConfig: async (): Promise<ActivityConfigResponse> =>
    fetchJson<ActivityConfigResponse>(`${API_BASE_URL}/activities-config`),
};

export const admin = {
  activities: {
    get: async (token?: string | null): Promise<ActivityConfigResponse> =>
      fetchJson<ActivityConfigResponse>(
        `${API_BASE_URL}/admin/activities`,
        withAdminCredentials({}, token)
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
      token?: string | null
    ): Promise<ActivityGenerationResponse> =>
      fetchJson<ActivityGenerationResponse>(
        `${API_BASE_URL}/admin/activities/generate`,
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
