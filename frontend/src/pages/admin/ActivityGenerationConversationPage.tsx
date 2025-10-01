import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import {
  admin,
  type ActivityGenerationJob,
  type ActivityGenerationJobToolCall,
  type Conversation,
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
  const [showHistory, setShowHistory] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [showNewGenerationForm, setShowNewGenerationForm] = useState(false);
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
      setShowHistory(false);
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
      setShowNewGenerationForm(false);
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

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-lg font-semibold text-[color:var(--brand-charcoal)]">
            Chargement de la conversation...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center">
          <div className="mb-2 text-lg font-semibold text-red-800">Erreur</div>
          <div className="text-sm text-red-600">{error}</div>
          <button
            onClick={() => navigate("/admin/activity-generation")}
            className="mt-4 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Retour
          </button>
        </div>
      </div>
    );
  }

  // Si pas de jobId, afficher la liste des conversations
  if (!jobId) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
              <button
                onClick={() => navigate("/activites")}
                className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
                title="Retour"
              >
                ← Retour
              </button>
              <div>
                <h1 className="text-xl font-semibold text-[color:var(--brand-black)]">
                  Historique des conversations
                </h1>
                <p className="text-xs text-gray-500">
                  Générations d'activités par IA
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowNewGenerationForm(!showNewGenerationForm)}
              className="rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600"
            >
              {showNewGenerationForm ? "Annuler" : "+ Nouvelle génération"}
            </button>
          </div>
        </header>

        <div className="flex-1 px-4 py-6 sm:px-6 lg:overflow-y-auto">
          {showNewGenerationForm && (
            <div className="mx-auto mb-6 max-w-4xl space-y-4 rounded-3xl border border-white/60 bg-white/95 p-6 shadow-md">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-[color:var(--brand-black)]">
                  Nouvelle génération d'activité
                </h2>
                <p className="text-sm text-gray-600">
                  Décrivez l'activité que vous souhaitez générer en quelques phrases.
                </p>
              </div>
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {error}
                </div>
              )}
              <div className="space-y-3">
                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleStartNewGeneration();
                    }
                  }}
                  placeholder="Ex: Créer une activité sur la photosynthèse pour des étudiants de niveau collégial..."
                  rows={4}
                  className="w-full rounded-2xl border border-gray-300 bg-white p-4 text-sm text-gray-900 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                  disabled={isGenerating}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">
                    Appuyez sur Cmd+Entrée ou Ctrl+Entrée pour envoyer
                  </p>
                  <button
                    onClick={handleStartNewGeneration}
                    disabled={!promptText.trim() || isGenerating}
                    className="rounded-full bg-[color:var(--brand-red)] px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {isGenerating ? "Génération..." : "Générer"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {conversations.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-gray-400">
                <p className="text-sm">Aucune conversation disponible</p>
                <p className="mt-2 text-xs">
                  Cliquez sur "+ Nouvelle génération" pour commencer
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-4">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  className="w-full cursor-pointer rounded-3xl border border-white/60 bg-white/95 p-6 text-left shadow-sm transition hover:shadow-md"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1">
                      <h3 className="mb-2 text-lg font-semibold text-[color:var(--brand-black)]">
                        {conv.activityTitle || "Sans titre"}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {new Date(conv.updatedAt).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {conv.status === "running" && (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800">
                          <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                          En cours
                        </span>
                      )}
                      {conv.status === "complete" && (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                          ✓ Terminée
                        </span>
                      )}
                      {conv.status === "error" && (
                        <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800">
                          ✗ Erreur
                        </span>
                      )}
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteConversationFromList(conv.id);
                        }}
                        className="rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--brand-red)]">
                    Ouvrir la conversation
                    <span aria-hidden="true">→</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center text-gray-400">
          <p className="text-sm">Conversation introuvable</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
            <button
              onClick={() => navigate(buildConversationUrl(null))}
              className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
              title="Retour à l'historique"
            >
              ← Retour
            </button>
            <div>
              <h1 className="text-xl font-semibold text-[color:var(--brand-black)]">
                {conversation.activityTitle || "Génération d'activité"}
              </h1>
              <p className="text-xs text-gray-500">
                {conversation.status === "running" && (
                  <span className="inline-flex items-center">
                    <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-green-500" />
                    En cours...
                  </span>
                )}
                {conversation.status === "complete" && (
                  <span className="text-green-600">✓ Terminée</span>
                )}
                {conversation.status === "error" && (
                  <span className="text-red-600">✗ Erreur</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {conversation?.status === "complete" && generatedActivityPath ? (
              <button
                onClick={() => navigate(generatedActivityPath)}
                className="rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700"
              >
                Ouvrir {generatedActivityTitle ?? "l’activité"}
              </button>
            ) : null}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {showHistory ? "Masquer" : "Historique"}
            </button>
            <button
              onClick={handleDeleteConversation}
              className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              Supprimer
            </button>
          </div>
        </div>
      </header>

      {/* Contenu principal */}
      <div className="flex flex-1 flex-col lg:flex-row lg:overflow-hidden">
        {/* Zone de conversation */}
        <div className="flex flex-1 flex-col bg-white lg:min-h-0 lg:overflow-hidden">
          <div className="flex-1 lg:overflow-hidden">
            <ConversationView
              messages={conversation.messages}
              isLoading={isPolling && conversation.status === "running"}
            />
          </div>
          {jobId && (
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
                        onClick={() => navigate(generatedActivityPath)}
                        className="inline-flex items-center justify-center rounded-full bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-green-700"
                      >
                        Ouvrir l’activité
                      </button>
                      <button
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
          )}
        </div>

        {/* Panneau d'historique (sidebar) */}
        {showHistory && (
          <aside className="mt-6 border-t border-gray-200 bg-white shadow-lg lg:mt-0 lg:w-80 lg:border-t-0 lg:border-l lg:shadow-none">
            <div className="flex flex-col lg:h-full">
              <div className="border-b border-gray-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Conversations récentes
                </h2>
              </div>
              <div className="lg:flex-1 lg:overflow-y-auto">
                {conversations.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-400">
                    Aucune conversation
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {conversations.map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => handleSelectConversation(conv)}
                        className={`w-full px-4 py-3 text-left transition hover:bg-gray-50 ${
                          conv.id === conversation.id ? "bg-blue-50" : ""
                        }`}
                      >
                        <div className="mb-1 text-sm font-medium text-gray-800">
                          {conv.activityTitle || "Sans titre"}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(conv.updatedAt).toLocaleDateString("fr-FR", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
