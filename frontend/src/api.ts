import { API_BASE_URL, API_AUTH_KEY } from "./config";

export type FieldType =
  | "bulleted_list"
  | "table_menu_day"
  | "table_menu_full"
  | "textarea_with_counter"
  | "two_bullets"
  | "reference_line";

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

export type FieldSpec =
  | BulletedListFieldSpec
  | TableMenuDayFieldSpec
  | TableMenuFullFieldSpec
  | TextareaWithCounterFieldSpec
  | TwoBulletsFieldSpec
  | ReferenceLineFieldSpec;

export interface MissionStage {
  prompt: string;
  fields: FieldSpec[];
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

  return (await response.json()) as T;
}

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
