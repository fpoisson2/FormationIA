import { useEffect, useMemo, useRef } from "react";
import type { ConversationMessage, ConversationMessageToolCall } from "../api";

interface FormattedSegment {
  content: string;
  bold: boolean;
}

function splitBoldSegments(line: string): FormattedSegment[] {
  const segments: FormattedSegment[] = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        content: line.slice(lastIndex, match.index),
        bold: false,
      });
    }

    const rawContent = match[1];
    const trimmedContent = rawContent.trim();
    segments.push({
      content: trimmedContent || rawContent,
      bold: true,
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    segments.push({
      content: line.slice(lastIndex),
      bold: false,
    });
  }

  if (segments.length === 0) {
    segments.push({ content: line, bold: false });
  }

  return segments;
}

interface ConversationViewProps {
  messages: ConversationMessage[];
  isLoading?: boolean;
  autoExpandDetails?: boolean;
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
}

function MessageBubble({
  message,
  autoExpand,
}: {
  message: ConversationMessage;
  autoExpand: boolean;
}): JSX.Element {
  const { role, content, toolCalls, reasoningSummary } = message;

  const isAwaitingPlaceholder = message.id === "awaiting-assistant-response";
  const reasoningDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const toolDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const previousAutoExpandRef = useRef(false);

  useEffect(() => {
    if (autoExpand) {
      if (reasoningDetailsRef.current) {
        reasoningDetailsRef.current.open = true;
      }
      if (toolDetailsRef.current) {
        toolDetailsRef.current.open = true;
      }
    } else if (previousAutoExpandRef.current) {
      if (reasoningDetailsRef.current) {
        reasoningDetailsRef.current.open = false;
      }
      if (toolDetailsRef.current) {
        toolDetailsRef.current.open = false;
      }
    }
    previousAutoExpandRef.current = autoExpand;
  }, [autoExpand]);

  const formattedToolCalls = useMemo(() => {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [] as Array<{ key: string; label: string; payload: string }>;
    }

    return toolCalls.map((toolCall: ConversationMessageToolCall, index) => {
      const key = toolCall.callId || `${toolCall.name}-${index}`;

      const resolvedLabel = toolCall.name || "appel_d_outil";

      if (typeof toolCall.argumentsText === "string") {
        const trimmed = toolCall.argumentsText.trim();
        if (trimmed) {
          return { key, label: resolvedLabel, payload: trimmed };
        }
      }

      const args = toolCall.arguments;
      if (typeof args === "string") {
        return { key, label: resolvedLabel, payload: args };
      }
      if (args == null) {
        return { key, label: resolvedLabel, payload: "" };
      }

      try {
        return {
          key,
          label: resolvedLabel,
          payload: JSON.stringify(args, null, 2),
        };
      } catch (error) {
        console.warn("Impossible de formater les arguments de l'appel d'outil", error);
        return {
          key,
          label: resolvedLabel,
          payload: String(args),
        };
      }
    });
  }, [toolCalls]);

  const reasoningSummaryLines = useMemo(() => {
    if (typeof reasoningSummary !== "string") {
      return null;
    }
    const trimmed = reasoningSummary.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.split(/\r?\n/);
  }, [reasoningSummary]);

  // Détermine le style selon le rôle
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const isTool = role === "tool";
  const isSystem = role === "system" || role === "developer";

  if (isAssistant && isAwaitingPlaceholder) {
    return (
      <div className="mb-6 flex justify-start">
        <div className="max-w-full sm:max-w-[720px]">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--brand-red)]">
            <span className="relative inline-flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--brand-red)]/40" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[color:var(--brand-red)]" />
            </span>
            Réponse de l’IA en cours
          </div>
          <div className="mt-3 rounded-3xl border border-[color:var(--brand-red)]/30 bg-white/90 px-5 py-4 text-sm text-[color:var(--brand-charcoal)] shadow-sm">
            {content}
          </div>
        </div>
      </div>
    );
  }

  // Messages système/développeur (cachés ou affichés discrètement)
  if (isSystem) {
    return (
      <div className="mb-4 text-center">
        <div className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
          Configuration système
        </div>
      </div>
    );
  }

  // Messages utilisateur
  if (isUser) {
    return (
      <div className="mb-6 flex justify-end">
        <div className="max-w-full sm:max-w-[640px]">
          <div className="mb-1 flex justify-end text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {formatTimestamp(message.timestamp)}
          </div>
          <div className="rounded-3xl bg-gradient-to-r from-[color:var(--brand-red)] to-[#ff6b6b] px-5 py-3 text-sm font-medium text-white shadow-md shadow-[rgba(255,64,94,0.25)]">
            <p className="whitespace-pre-wrap break-words leading-relaxed">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  // Messages assistant
  if (isAssistant) {
    return (
      <div className="mb-6 flex justify-start">
        <div className="max-w-full sm:max-w-[720px]">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-lg text-[color:var(--brand-red)] shadow-sm shadow-[rgba(0,0,0,0.08)]">
              🤖
            </span>
            {formatTimestamp(message.timestamp)}
          </div>
          <div className="rounded-3xl border border-gray-200 bg-white/95 px-5 py-4 shadow-md backdrop-blur">
            {content && (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                {content}
              </p>
            )}
            {reasoningSummaryLines && (
              <details
                ref={reasoningDetailsRef}
                className="mt-3 rounded-2xl border border-orange-100 bg-orange-50/50 p-3 text-xs"
              >
                <summary className="cursor-pointer font-semibold text-orange-800">
                  🧠 Résumé du raisonnement
                </summary>
                <div className="mt-2 space-y-1 text-left text-[13px] leading-relaxed text-orange-800">
                  {reasoningSummaryLines.map((line, index) => {
                    const segments = splitBoldSegments(line);
                    return (
                      <p key={index} className="whitespace-pre-wrap break-words">
                        {segments.map((segment, segmentIndex) => {
                          if (!segment.content) {
                            return null;
                          }
                          if (segment.bold) {
                            return (
                              <strong key={`${index}-${segmentIndex}`} className="font-semibold">
                                {segment.content}
                              </strong>
                            );
                          }
                          return (
                            <span key={`${index}-${segmentIndex}`}>{segment.content}</span>
                          );
                        })}
                      </p>
                    );
                  })}
                </div>
              </details>
            )}
            {formattedToolCalls.length > 0 && (
              <details
                ref={toolDetailsRef}
                className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 text-xs"
              >
                <summary className="cursor-pointer font-semibold text-blue-800">
                  🔧 Appels d'outils ({formattedToolCalls.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {formattedToolCalls.map(({ key, label, payload }) => (
                    <div
                      key={key}
                      className="rounded-2xl border border-blue-100 bg-white/90 p-3 text-[13px] shadow-sm"
                    >
                      <div className="font-semibold text-blue-800">{label}</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[12px] text-blue-700">
                        {payload}
                      </pre>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Messages d'outils (résultats de tool calls)
  if (isTool) {
    return (
      <div className="mb-6 flex justify-start">
        <div className="max-w-full sm:max-w-[720px]">
          <div className="rounded-2xl border border-green-200 bg-green-50/50 px-4 py-3 shadow-sm">
            <div className="mb-2 text-xs font-semibold text-green-800">
              ✓ Résultat {message.name ? `de ${message.name}` : ""}
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-green-700">
              {content}
            </pre>
          </div>
          <div className="mt-1 text-left text-xs text-gray-400">
            {formatTimestamp(message.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  // Fallback pour les autres types de messages
  return (
    <div className="mb-4">
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
        <div className="font-semibold">{role}</div>
        <div className="mt-1">{content}</div>
      </div>
    </div>
  );
}

export function ConversationView({
  messages,
  isLoading = false,
  autoExpandDetails = false,
}: ConversationViewProps): JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomMarkerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  // Filtre les messages système et développeur pour ne pas les afficher
  const visibleMessages = useMemo(() => {
    const filtered = messages.filter((msg) => {
      // On garde tous les messages sauf system et developer
      if (msg.role === "system" || msg.role === "developer") {
        return false;
      }
      if (msg.role === "tool") {
        return false;
      }
      const content = typeof msg.content === "string" ? msg.content.trim() : "";
      if (
        msg.role === "assistant" &&
        content.startsWith("Appel de la fonction") &&
        Array.isArray(msg.toolCalls) &&
        msg.toolCalls.length > 0 &&
        msg.toolCalls.every((toolCall) => {
          const args = toolCall?.arguments;
          if (args == null) return true;
          if (typeof args === "string") {
            const trimmed = args.trim();
            if (!trimmed) return true;
            // Conserver les messages qui semblent contenir un JSON complet
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
              return false;
            }
            return trimmed.length < 48;
          }
          return false;
        })
      ) {
        return false;
      }
      return true;
    });

    const deduped: ConversationMessage[] = [];
    const indexById = new Map<string, number>();
    const indexBySignature = new Map<string, number>();

    for (const msg of filtered) {
      const id = typeof msg.id === "string" ? msg.id.trim() : "";
      if (id) {
        const existingIndex = indexById.get(id);
        if (existingIndex != null) {
          deduped[existingIndex] = msg;
          continue;
        }
        indexById.set(id, deduped.length);
        deduped.push(msg);
        continue;
      }

      const content = typeof msg.content === "string" ? msg.content.trim() : "";
      const toolSignature = Array.isArray(msg.toolCalls)
        ? msg.toolCalls
            .map((call) => `${call.name ?? ""}:${call.callId ?? ""}:${call.argumentsText ?? ""}`)
            .join("|")
        : "";
      const signature = `${msg.role}:${msg.timestamp ?? ""}:${content}:${toolSignature}`;
      const existingSignatureIndex = indexBySignature.get(signature);
      if (existingSignatureIndex != null) {
        deduped[existingSignatureIndex] = msg;
        continue;
      }
      indexBySignature.set(signature, deduped.length);
      deduped.push(msg);
    }

    return deduped;
  }, [messages]);

  const lastAssistantIndex = useMemo(() => {
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index];
      if (
        message.role === "assistant" &&
        message.id !== "awaiting-assistant-response"
      ) {
        return index;
      }
    }
    return -1;
  }, [visibleMessages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const updateShouldStickToBottom = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      shouldStickToBottomRef.current = distanceFromBottom <= 160;
    };

    updateShouldStickToBottom();
    container.addEventListener("scroll", updateShouldStickToBottom);

    return () => {
      container.removeEventListener("scroll", updateShouldStickToBottom);
    };
  }, []);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }

    if (bottomMarkerRef.current) {
      bottomMarkerRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }

    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      return;
    }

    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }, [visibleMessages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-gray-400">
          <p className="text-sm">Aucun message pour le moment</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-6 sm:px-6 lg:px-10"
      >
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-end">
          {visibleMessages.map((message, index) => {
            const key = message.id ?? `${message.role}-${message.timestamp ?? index}-${index}`;
            const isAwaitingPlaceholder = message.id === "awaiting-assistant-response";
            const shouldAutoExpand = Boolean(
              autoExpandDetails &&
                index === lastAssistantIndex &&
                message.role === "assistant" &&
                !isAwaitingPlaceholder
            );
            return <MessageBubble key={key} message={message} autoExpand={shouldAutoExpand} />;
          })}
          {isLoading && (
            <div className="mb-6 flex justify-start">
              <div className="rounded-3xl border border-gray-200 bg-white px-5 py-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                  <div
                    className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: "0.1s" }}
                  />
                  <div
                    className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: "0.2s" }}
                  />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomMarkerRef} />
        </div>
      </div>
    </div>
  );
}
