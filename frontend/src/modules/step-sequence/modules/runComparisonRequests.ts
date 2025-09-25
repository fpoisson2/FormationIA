import type { Dispatch, SetStateAction } from "react";

import { API_AUTH_KEY, API_BASE_URL, type ModelConfig } from "../../../config";

export type ComparisonVariant = "A" | "B";

interface VariantStateHandlers {
  setSummary: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
}

export interface VariantRequestParameters {
  config: ModelConfig;
  handlers: VariantStateHandlers;
  preset?: Record<string, unknown>;
}

export interface ComparisonRequestOptions {
  endpoint: string | ((baseUrl: string) => string);
  systemPrompt?: string;
}

const resolveEndpoint = (
  endpoint: ComparisonRequestOptions["endpoint"]
): string => {
  if (typeof endpoint === "function") {
    return endpoint(API_BASE_URL);
  }
  const trimmed = endpoint.trim();
  if (!trimmed) {
    return `${API_BASE_URL.replace(/\/$/, "")}/summary`;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const base = API_BASE_URL.replace(/\/$/, "");
  const path = trimmed.replace(/^\//, "");
  return `${base}/${path}`;
};

const buildRequestBody = (
  prompt: string,
  config: ModelConfig,
  systemPrompt: string | undefined,
  preset: Record<string, unknown> | undefined
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    text: prompt,
    model: config.model,
    verbosity: config.verbosity,
    thinking: config.thinking,
  };

  if (systemPrompt) {
    body.systemPrompt = systemPrompt;
  }

  if (preset) {
    for (const [key, value] of Object.entries(preset)) {
      body[key] = value;
    }
  }

  return body;
};

const createHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (API_AUTH_KEY) {
    headers["X-API-Key"] = API_AUTH_KEY;
  }
  return headers;
};

const streamVariantResponse = async (
  url: string,
  prompt: string,
  options: ComparisonRequestOptions,
  { config, handlers, preset }: VariantRequestParameters
): Promise<void> => {
  const { setSummary, setError, setLoading } = handlers;

  setError(null);
  setSummary("");
  setLoading(true);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: createHeaders(),
      body: JSON.stringify(buildRequestBody(prompt, config, options.systemPrompt, preset)),
    });

    if (!response.ok || !response.body) {
      const message = await response.text();
      throw new Error(message || "Impossible de contacter le serveur");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
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

export const runComparisonRequests = async (
  prompt: string,
  variants: Record<ComparisonVariant, VariantRequestParameters>,
  options: ComparisonRequestOptions
): Promise<void> => {
  const url = resolveEndpoint(options.endpoint);

  await Promise.all(
    (Object.keys(variants) as ComparisonVariant[]).map((key) =>
      streamVariantResponse(url, prompt, options, variants[key])
    )
  );
};
