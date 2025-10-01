import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import {
  admin,
  type ActivityGenerationJob,
  type ActivityGenerationJobToolCall,
  type Conversation,
  type ConversationMessage,
  type GenerateActivityPayload,
} from "../../api";
import { ConversationView } from "../../components/ConversationView";
import { useAdminAuth } from "../../providers/AdminAuthProvider";
import { MODEL_OPTIONS, VERBOSITY_OPTIONS, THINKING_OPTIONS } from "../../config";

interface PendingPlanStep {
  id?: string;
  title?: string;
  objective?: string;
  description?: string | null;
  deliverable?: string | null;
  duration?: string | null;
}

interface PendingPlanResult {
  overview?: string;
  steps?: PendingPlanStep[];
  notes?: string | null;
}

export function ActivityGenerationConversationPage(): JSX.Element {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("jobId");

  const basePath = useMemo(() => location.pathname, [location.pathname]);

  const buildConversationUrl = useCallback(
    (nextJobId?: string | null) => {
      if (nextJobId && nextJobId.trim().length > 0) {
        return `${basePath}?jobId=${encodeURIComponent(nextJobId)}`;
      }
      return basePath;
    },
    [basePath]
  );

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [jobStatus, setJobStatus] = useState<ActivityGenerationJob | null>(null);
  const [isJobLoading, setIsJobLoading] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const pollIntervalRef = useRef<number | null>(null);

  const generatedActivityId = useMemo(() => {
    if (jobStatus?.activityId) {
      return jobStatus.activityId;
    }
    if (conversation?.activityId) {
      return conversation.activityId;
    }
    return null;
  }, [conversation?.activityId, jobStatus?.activityId]);

  const generatedActivityTitle = useMemo(() => {
    if (jobStatus?.activityTitle) {
      return jobStatus.activityTitle;
    }
    if (conversation?.activityTitle) {
      return conversation.activityTitle;
    }
    return null;
  }, [conversation?.activityTitle, jobStatus?.activityTitle]);

  const generatedActivityPath = useMemo(() => {
    const payload = jobStatus?.activity;
    if (payload && typeof payload === "object") {
      const pathValue = (payload as { path?: unknown }).path;
      if (typeof pathValue === "string" && pathValue.trim()) {
        return pathValue;
      }
      const cardValue = (payload as { card?: unknown }).card;
      if (cardValue && typeof cardValue === "object") {
        const ctaValue = (cardValue as { cta?: unknown }).cta;
        if (ctaValue && typeof ctaValue === "object") {
          const toValue = (ctaValue as { to?: unknown }).to;
          if (typeof toValue === "string" && toValue.trim()) {
            return toValue;
          }
        }
      }
    }
    if (generatedActivityId) {
      return `/activites/${generatedActivityId}`;
    }
    return null;
  }, [generatedActivityId, jobStatus?.activity]);

  const resetToNewConversation = useCallback(
    (shouldCloseSidebar = false) => {
      navigate(buildConversationUrl(null));
      setConversation(null);
      setJobStatus(null);
      setError(null);
      setPromptText("");
      setFeedbackMessage("");
      setFeedbackError(null);
      if (shouldCloseSidebar) {
        setIsSidebarOpen(false);
      }
    },
    [buildConversationUrl, navigate]
  );

  // Charge la conversation initiale
  useEffect(() => {
    if (!jobId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadConversation = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await admin.conversations.getByJobId(jobId, token);
        if (!cancelled) {
          setConversation(response.conversation);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Erreur lors du chargement de la conversation"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadConversation();

    return () => {
      cancelled = true;
    };
  }, [jobId, token]);

  // Charge l'historique des conversations
  useEffect(() => {
    let cancelled = false;

    const loadConversations = async () => {
      try {
        const response = await admin.conversations.list(token);
        if (!cancelled) {
          setConversations(response.conversations);
        }
      } catch (err) {
        console.error("Erreur lors du chargement de l'historique:", err);
      }
    };

    void loadConversations();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const refreshJobStatus = useCallback(async () => {
    if (!jobId) return;
    setIsJobLoading(true);
    try {
      const job = await admin.activities.getGenerationJob(jobId, token);
      setJobStatus(job);
    } catch (err) {
      console.error("Erreur lors de la récupération du job:", err);
    } finally {
      setIsJobLoading(false);
    }
  }, [jobId, token]);

  // Charge l'état du job lors de l'arrivée sur la page
  useEffect(() => {
    if (!jobId) {
      setJobStatus(null);
      return;
    }
    void refreshJobStatus();
  }, [jobId, refreshJobStatus]);

  // Polling pour les mises à jour de la conversation et du job
  useEffect(() => {
    if (!jobId || !conversation) return;

    // Ne poll que si la conversation n'est pas terminée
    if (conversation.status === "complete" || conversation.status === "error") {
      return;
    }

    setIsPolling(true);

    const poll = async () => {
      try {
        const response = await admin.conversations.getByJobId(jobId, token);
        setConversation(response.conversation);
        await refreshJobStatus();
      } catch (err) {
        console.error("Erreur lors du polling:", err);
      }
    };

    pollIntervalRef.current = window.setInterval(poll, 3000); // Poll toutes les 3 secondes

    return () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsPolling(false);
    };
  }, [jobId, conversation, token]);

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      navigate(buildConversationUrl(conv.jobId));
      setIsSidebarOpen(false);
      setError(null);
      setFeedbackMessage("");
      setFeedbackError(null);
    },
    [buildConversationUrl, navigate]
  );

  const handleStartNewGeneration = useCallback(async () => {
    if (!promptText.trim() || isGenerating) {
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const payload: GenerateActivityPayload = {
        model: "gpt-5-mini",
        verbosity: "medium",
        thinking: "medium",
        details: {
          theme: promptText.trim(),
        },
      };

      const job = await admin.activities.generate(payload, token);

      // Rediriger vers la conversation nouvellement créée
      navigate(buildConversationUrl(job.jobId));
      setPromptText("");
      setIsSidebarOpen(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erreur lors du démarrage de la génération"
      );
    } finally {
      setIsGenerating(false);
    }
  }, [buildConversationUrl, promptText, isGenerating, token, navigate]);

  const handleSendFeedback = useCallback(
    async (action: "approve" | "revise") => {
      if (!jobId || isSendingFeedback) {
        return;
      }

      const trimmedMessage = feedbackMessage.trim();
      if (action === "revise" && trimmedMessage.length === 0) {
        setFeedbackError(
          "Ajoutez un message pour préciser les ajustements attendus."
        );
        return;
      }

      const expectingPlan = jobStatus?.expectingPlan ??
        jobStatus?.pendingToolCall?.name === "propose_step_sequence_plan";

      const buildFeedbackText = (): string => {
        if (action === "approve") {
          if (expectingPlan) {
            let base = "Le plan proposé est validé.";
            if (trimmedMessage.length > 0) {
              base += ` Notes complémentaires : ${trimmedMessage}`;
            }
            return (
              base
              + " Passe à la création des étapes correspondantes en respectant ce plan."
            );
          }
          let base = "Cette étape est validée.";
          if (trimmedMessage.length > 0) {
            base += ` Commentaire : ${trimmedMessage}`;
          }
          return base + " Tu peux poursuivre avec l'étape suivante.";
        }
        if (expectingPlan) {
          return `Corrige le plan selon les indications suivantes : ${trimmedMessage}`;
        }
        return `Corrige cette étape selon les indications suivantes : ${trimmedMessage}`;
      };

      const feedbackText = buildFeedbackText();

      setIsSendingFeedback(true);
      setFeedbackError(null);

      try {
        const updatedJob = await admin.activities.respondToGenerationJob(
          jobId,
          {
            action,
            message: trimmedMessage || undefined,
          },
          token
        );
        setJobStatus(updatedJob);
        setFeedbackMessage("");
        setConversation((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            messages: [
              ...prev.messages,
              {
                role: "user",
                content: feedbackText,
                timestamp: new Date().toISOString(),
              },
            ],
          };
        });
        const refreshed = await admin.conversations.getByJobId(jobId, token);
        setConversation(refreshed.conversation);
      } catch (err) {
        setFeedbackError(
          err instanceof Error
            ? err.message
            : "Impossible d'envoyer la réponse au modèle."
        );
      } finally {
        setIsSendingFeedback(false);
      }
    },
    [feedbackMessage, isSendingFeedback, jobId, jobStatus?.expectingPlan, jobStatus?.pendingToolCall?.name, token]
  );

  const deleteConversationById = useCallback(
    async (conversationId: string, redirectToHistory = false) => {
      try {
        await admin.conversations.delete(conversationId, token);
        if (conversation && conversation.id === conversationId) {
          setConversation(null);
          setJobStatus(null);
        }
        if (redirectToHistory) {
          navigate(buildConversationUrl(null), { replace: true });
        }
        const history = await admin.conversations.list(token);
        setConversations(history.conversations);
        if (redirectToHistory) {
          await refreshJobStatus();
        }
        return true;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de supprimer la conversation."
        );
        return false;
      }
    },
    [buildConversationUrl, conversation, navigate, refreshJobStatus, token]
  );

  const handleDeleteConversation = useCallback(async () => {
    if (!conversation) {
      return;
    }
    const confirmed = window.confirm(
      "Supprimer définitivement cette conversation ?"
    );
    if (!confirmed) {
      return;
    }
    await deleteConversationById(conversation.id, true);
  }, [conversation, deleteConversationById]);

  const handleDeleteConversationFromList = useCallback(
    async (conversationId: string) => {
      const confirmed = window.confirm(
        "Supprimer définitivement cette conversation ?"
      );
      if (!confirmed) {
        return;
      }
      await deleteConversationById(conversationId, false);
    },
    [deleteConversationById]
  );

  const pendingToolCallContent = useMemo(() => {
    const toolCall = jobStatus?.pendingToolCall as ActivityGenerationJobToolCall | null;
    if (!toolCall) {
      return null;
    }

    if (toolCall.name === "propose_step_sequence_plan") {
      const plan = toolCall.result as PendingPlanResult | null;
      const steps = Array.isArray(plan?.steps) ? plan?.steps ?? [] : [];
      return (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-sky-900">
              Plan proposé
            </h3>
            {plan?.overview ? (
              <p className="text-sm text-sky-900/80">{plan.overview}</p>
            ) : null}
          </div>
          {steps.length > 0 ? (
            <ol className="space-y-3">
              {steps.map((step, index) => (
                <li
                  key={step.id ?? `plan-step-${index}`}
                  className="rounded-2xl border border-sky-200/70 bg-white/95 p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-sky-700">
                    <span>Étape {index + 1}</span>
                    {step.duration ? <span>{step.duration}</span> : null}
                  </div>
                  <p className="text-sm font-semibold text-sky-900">
                    {step.title ?? step.id ?? `Étape ${index + 1}`}
                  </p>
                  {step.objective ? (
                    <p className="text-xs text-sky-900/80">
                      Objectif : {step.objective}
                    </p>
                  ) : null}
                  {step.description ? (
                    <p className="text-xs text-sky-900/70">{step.description}</p>
                  ) : null}
                  {step.deliverable ? (
                    <p className="text-xs text-sky-900/70">
                      Livrable : {step.deliverable}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {plan?.notes ? (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-3 text-xs text-sky-900/70">
              Notes : {plan.notes}
            </div>
          ) : null}
        </div>
      );
    }

    if (toolCall.name === "create_step_sequence_activity") {
      const activityId =
        (typeof toolCall.result === "object" && toolCall.result !== null
          ? (toolCall.result as Record<string, unknown>).id
          : undefined) || toolCall.arguments?.activityId;
      return (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-sky-900">
            Activité générée
          </h3>
          <p className="text-sm text-sky-900/80">
            Identifiant proposé :
            <span className="ml-1 font-semibold text-sky-900">
              {typeof activityId === "string" ? activityId : "(non fourni)"}
            </span>
          </p>
          <div className="rounded-2xl border border-sky-100 bg-white/90 p-3 text-xs text-sky-900/80">
            <pre className="max-h-64 max-w-full overflow-y-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(toolCall.result, null, 2)}
            </pre>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-sky-900">
          Appel d'outil en attente
        </h3>
        <div className="rounded-2xl border border-sky-100 bg-white/95 p-3 text-xs text-sky-900/80">
          <pre className="max-h-64 max-w-full overflow-y-auto whitespace-pre-wrap break-words text-xs">
            {JSON.stringify(toolCall.result ?? toolCall.arguments ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    );
  }, [jobStatus?.pendingToolCall]);

  const onboardingMessages = useMemo<ConversationMessage[]>(() => {
    const firstTimestamp = new Date().toISOString();
    const secondTimestamp = new Date(Date.now() + 1000).toISOString();
    return [
      {
        role: "assistant",
        content:
          "Bonjour! Décrivons ensemble l’activité que vous souhaitez générer. Dites-moi le thème, le public visé et le format désiré, puis je m’occupe du reste.",
        timestamp: firstTimestamp,
      },
      {
        role: "assistant",
        content:
          "Quand vous êtes prêt·e, rédigez votre consigne dans le champ ci-dessous et appuyez sur Entrée pour lancer la génération.",
        timestamp: secondTimestamp,
      },
    ];
  }, []);

  const messagesToDisplay = jobId && conversation ? conversation.messages : onboardingMessages;
  const showLoadingState = Boolean(jobId && isLoading && !conversation);
  const hasBlockingError = Boolean(jobId && error && !conversation);
  const showGlobalErrorBanner = Boolean(jobId && error && conversation);
  const conversationViewIsLoading = Boolean(
    jobId &&
      conversation?.status === "running" &&
      !jobStatus?.awaitingUserAction &&
      (isPolling || isJobLoading)
  );

  return (
    <div className="relative flex min-h-screen bg-gray-50">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] transition lg:hidden"
          aria-hidden="true"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex transform flex-col bg-white shadow-xl transition duration-200 ease-in-out lg:relative lg:inset-y-auto lg:h-auto lg:shadow-none ${
          isSidebarOpen
            ? "w-72 translate-x-0 border-r border-gray-200 lg:w-80"
            : "w-72 -translate-x-full border-r border-gray-200 lg:w-0 lg:-translate-x-full lg:border-transparent"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-[color:var(--brand-black)]">
                Conversations
              </p>
              <p className="text-xs text-gray-500">Historique des demandes</p>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Fermer
            </button>
          </div>
          <div className="border-b border-gray-200 px-4 py-3">
            <button
              type="button"
              onClick={() => {
                resetToNewConversation(true);
              }}
              className="w-full rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600"
            >
              + Nouvelle génération
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-400">
                Aucune conversation enregistrée
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {conversations.map((conv) => {
                  const isActive = conv.jobId === jobId;
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => handleSelectConversation(conv)}
                      className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-gray-50 ${
                        isActive ? "bg-red-50/60" : ""
                      }`}
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[color:var(--brand-black)]">
                          {conv.activityTitle || "Sans titre"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(conv.updatedAt).toLocaleDateString("fr-FR", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {conv.status === "running" && (
                          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-1 text-[10px] font-medium text-yellow-800">
                            <span className="mr-1 h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                            En cours
                          </span>
                        )}
                        {conv.status === "complete" && (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-[10px] font-medium text-green-800">
                            ✓ Terminée
                          </span>
                        )}
                        {conv.status === "error" && (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-1 text-[10px] font-medium text-red-700">
                            ✗ Erreur
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteConversationFromList(conv.id);
                          }}
                          className="text-[10px] font-medium text-red-600 transition hover:text-red-700"
                        >
                          Supprimer
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 px-4 py-4 backdrop-blur-sm shadow-sm sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-3">
              <button
                type="button"
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-lg text-gray-600 transition hover:bg-gray-50"
                aria-label={isSidebarOpen ? "Masquer les conversations" : "Afficher les conversations"}
              >
                ☰
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-semibold text-[color:var(--brand-black)]">
                  {conversation?.activityTitle || "Assistant IA"}
                </h1>
                <p className="text-xs text-gray-500">
                  {jobId ? (
                    conversation ? (
                      conversation.status === "running" ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                          Génération en cours...
                        </span>
                      ) : conversation.status === "complete" ? (
                        "Génération terminée"
                      ) : conversation.status === "error" ? (
                        "La génération a rencontré une erreur"
                      ) : null
                    ) : isLoading ? (
                      "Chargement de la conversation..."
                    ) : (
                      "Conversation introuvable"
                    )
                  ) : (
                    "Démarrez une nouvelle génération d’activité en discutant avec l’assistant."
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {conversation?.status === "complete" && generatedActivityPath ? (
                <button
                  type="button"
                  onClick={() => navigate(generatedActivityPath)}
                  className="rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700"
                >
                  Ouvrir {generatedActivityTitle ?? "l’activité"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => resetToNewConversation()}
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Nouvelle conversation
              </button>
              {conversation ? (
                <button
                  type="button"
                  onClick={handleDeleteConversation}
                  className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                >
                  Supprimer
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {showGlobalErrorBanner ? (
          <div className="border-l-4 border-red-400 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="flex items-start justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-xs font-semibold uppercase tracking-wide text-red-600 transition hover:text-red-700"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {hasBlockingError ? (
              <div className="flex h-full items-center justify-center px-4">
                <div className="max-w-sm rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm">
                  <p className="text-sm font-medium text-red-700">
                    {error}
                  </p>
                  <button
                    type="button"
                    onClick={() => resetToNewConversation()}
                    className="mt-4 rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600"
                  >
                    Revenir à l’accueil de l’assistant
                  </button>
                </div>
              </div>
            ) : showLoadingState ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-sm text-gray-500">
                  Chargement de la conversation...
                </div>
              </div>
            ) : (
              <ConversationView
                messages={messagesToDisplay}
                isLoading={conversationViewIsLoading}
              />
            )}
          </div>

          {jobId && conversation ? (
            <div className="border-t border-gray-100 bg-white/95 px-4 py-4 sm:px-6">
              {jobStatus?.awaitingUserAction ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-500">
                      Validation requise
                    </div>
                    <p className="text-sm text-[color:var(--brand-charcoal)]">
                      L'IA attend votre retour pour poursuivre la génération.
                    </p>
                  </div>
                  {pendingToolCallContent ? (
                    <div className="rounded-3xl border border-sky-200/60 bg-sky-50/70 p-5 shadow-sm">
                      {pendingToolCallContent}
                    </div>
                  ) : null}
                  <div className="space-y-3 rounded-3xl border border-gray-200/70 bg-white/95 p-5 shadow-sm">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[color:var(--brand-black)]">
                        Formuler un retour
                      </p>
                      <p className="text-xs text-[color:var(--brand-charcoal)]/70">
                        Validez pour continuer ou détaillez les ajustements à demander.
                      </p>
                    </div>
                    <textarea
                      value={feedbackMessage}
                      onChange={(event) => setFeedbackMessage(event.target.value)}
                      placeholder="Ajoutez un commentaire (obligatoire pour une demande de révision)."
                      rows={4}
                      className="w-full rounded-2xl border border-gray-300 bg-white p-3 text-sm text-[color:var(--brand-charcoal)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                      disabled={isSendingFeedback}
                    />
                    {feedbackError ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        {feedbackError}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-3 sm:justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          void handleSendFeedback("approve");
                        }}
                        disabled={isSendingFeedback}
                        className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-300"
                      >
                        {isSendingFeedback ? "Envoi en cours..." : "Valider et poursuivre"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleSendFeedback("revise");
                        }}
                        disabled={isSendingFeedback}
                        className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-[color:var(--brand-red)] shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSendingFeedback
                          ? "Envoi en cours..."
                          : "Demander des ajustements"}
                      </button>
                      <div className="text-xs text-gray-500">
                        {isJobLoading
                          ? "Mise à jour du statut en cours..."
                          : jobStatus?.reasoningSummary
                          ? "Résumé du raisonnement disponible ci-dessus."
                          : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : jobStatus?.status === "complete" ? (
                <div className="space-y-3 rounded-3xl border border-green-200/70 bg-green-50/80 p-5 text-sm text-green-900 shadow-sm">
                  <p>
                    La génération est terminée. L’activité «
                    {" "}
                    {generatedActivityTitle ?? generatedActivityId ?? "sans titre"}
                    {" "}
                    » est prête à être testée.
                  </p>
                  {generatedActivityPath ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => navigate(generatedActivityPath)}
                        className="inline-flex items-center justify-center rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-green-700"
                      >
                        Ouvrir l’activité
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/activites")}
                        className="inline-flex items-center justify-center rounded-full border border-green-500 px-4 py-2 text-xs font-semibold text-green-700 transition hover:bg-green-100"
                      >
                        Voir toutes les activités
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-green-800/70">
                      L’identifiant de l’activité est {generatedActivityId ?? "indisponible"}. Accédez-y depuis le catalogue si nécessaire.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-3xl border border-gray-200/70 bg-white/90 p-4 text-xs text-gray-500">
                  {jobStatus?.status === "error"
                    ? jobStatus.message ||
                      "La génération s'est interrompue. Vous pouvez relancer une nouvelle demande."
                    : "Aucune validation n'est requise pour le moment."}
                </div>
              )}
            </div>
          ) : (
            <div className="border-t border-gray-100 bg-white/90 px-4 py-4 sm:px-6">
              <div className="mx-auto w-full max-w-3xl space-y-3 rounded-3xl border border-gray-200/70 bg-white/95 p-4 shadow-sm">
                <textarea
                  value={promptText}
                  onChange={(event) => setPromptText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      handleStartNewGeneration();
                    }
                  }}
                  placeholder="Décrivez l’activité à générer (thème, public, objectifs, contraintes...)."
                  rows={3}
                  className="w-full rounded-2xl border border-gray-300 bg-white p-3 text-sm text-[color:var(--brand-charcoal)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                  disabled={isGenerating}
                />
                {!jobId && error ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {error}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">
                    Cmd+Entrée ou Ctrl+Entrée pour envoyer
                  </p>
                  <button
                    type="button"
                    onClick={handleStartNewGeneration}
                    disabled={!promptText.trim() || isGenerating}
                    className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-300"
                  >
                    {isGenerating ? "Génération..." : "Envoyer"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
