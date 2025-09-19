import { useEffect, useMemo, useState } from "react";

import logoPrincipal from "../assets/logo_principal.svg";
import { API_AUTH_KEY, API_BASE_URL } from "../config";
import { useLTI } from "../hooks/useLTI";
import { useActivityCompletion } from "../hooks/useActivityCompletion";
import type { ActivityProps } from "../config/activities";

type Stage = "briefing" | "arena-writing" | "arena-results";

type MissionDefaults = {
  objective: string;
  context: string;
  checkpoints: string[];
  starterPrompt: string;
};

interface Mission {
  id: string;
  title: string;
  badge: string;
  level: "Débutant" | "Intermédiaire" | "Avancé";
  description: string;
  targetScore: number;
  defaults: MissionDefaults;
}

interface AiScoreReport {
  total: number;
  clarity: number;
  specificity: number;
  structure: number;
  length: number;
  comments: string;
  advice: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const MISSIONS: Mission[] = [
  {
    id: "brief-clarity",
    title: "Mission 1 · Atelier campus",
    badge: "🎯 Clarté",
    level: "Débutant",
    description:
      "Préparer un atelier de révision pour aider la cohorte de Techniques de l’informatique à réussir l’intra.",
    targetScore: 75,
    defaults: {
      objective:
        "Construire un plan d’atelier d’une heure incluant une activité d’ouverture, un segment pratique et une conclusion claire.",
      context:
        "Tu es pair-aidant au centre d’aide. L’atelier aura lieu en fin de journée avec 18 collègues un peu fatigués.",
      checkpoints: [
        "Mentionner les trois segments clés (départ, activités, clôture).",
        "Garder un ton motivant et concret pour un groupe collégial.",
        "Indiquer comment recueillir les questions de dernière minute.",
      ],
      starterPrompt:
        "Rôle: Tu es un tuteur pair qui anime un atelier dynamique.\nTâche: Proposer un plan d’atelier de 60 minutes pour revoir les structures de données avant l’intra.\nPublic: Étudiantes et étudiants de première année au cégep.\nContraintes: Prévoir trois segments (accroche, pratique guidée, conclusion). Mentionner un outil collaboratif utilisé.\nFormat attendu: Liste numérotée avec durées estimées.\nRéponds uniquement avec le plan.",
    },
  },
  {
    id: "audience-adapt",
    title: "Mission 2 · Résumé associatif",
    badge: "🧭 Adaptation",
    level: "Intermédiaire",
    description:
      "Rédiger un résumé pour l’infolettre de l’association étudiante à partir d’un article sur le sommeil et les écrans.",
    targetScore: 82,
    defaults: {
      objective:
        "Synthétiser l’article en trois points faciles à lire et proposer une mini-action pour la vie de campus.",
      context:
        "Le résumé sera envoyé par courriel à des étudiantes et étudiants de première année. Temps de lecture cible : 4 minutes.",
      checkpoints: [
        "Employer un ton bienveillant et accessible.",
        "Inclure une analogie liée à la routine collégiale (ex: soirée d’étude).",
        "Avertir d’un point de vigilance ou d’une limite de l’étude.",
      ],
      starterPrompt:
        "Rôle: Tu écris pour l’infolettre de l’association étudiante.\nTâche: Résumer un article du service de psychologie sur l’impact des écrans tard le soir.\nPublic: Collégiennes et collégiens de première année.\nContraintes: 130 mots maximum, analogie liée à la vie de campus, mentionner une limite.\nFormat attendu: trois paragraphes courts (idée clé, analogie, action proposée).\nRéponds uniquement avec le résumé.",
    },
  },
  {
    id: "creative-brief",
    title: "Mission 3 · Courriel de stage",
    badge: "🚀 Créativité",
    level: "Avancé",
    description:
      "Annonce un léger retard à ton superviseur de stage tout en proposant un plan d’action crédible.",
    targetScore: 88,
    defaults: {
      objective:
        "Informer d’un retard de trois jours sur le rapport de stage en rassurant sur les étapes suivantes.",
      context:
        "Tu es en Techniques de laboratoire. L’accès au labo a été restreint, d’où le retard.",
      checkpoints: [
        "Rester professionnel·le et factuel·le.",
        "Proposer deux mesures compensatoires et un nouveau jalon précis.",
        "Inviter à un court point Teams pour valider le plan.",
      ],
      starterPrompt:
        "Rôle: Tu es un·e stagiaire transparent·e et proactif·ve.\nTâche: Rédiger un courriel à ton superviseur pour annoncer un retard de 3 jours sur le rapport de stage et proposer un plan B.\nPublic: Superviseur de stage en entreprise.\nContraintes: Rester factuel, proposer deux mesures d’atténuation, fixer un nouveau jalon et proposer une rencontre Teams de 15 minutes.\nFormat attendu: Objet + courriel structuré en 4 paragraphes.\nRéponds uniquement avec le courriel.",
    },
  },
];

const DEFAULT_MISSION = MISSIONS[0];

function PromptDojo({ completionId, navigateToActivities }: ActivityProps): JSX.Element {
  const [missionId, setMissionId] = useState(DEFAULT_MISSION.id);
  const mission = useMemo(() => MISSIONS.find((item) => item.id === missionId) ?? DEFAULT_MISSION, [missionId]);
  const [stage, setStage] = useState<Stage>("briefing");

  const [promptText, setPromptText] = useState(mission.defaults.starterPrompt);
  const [aiScore, setAiScore] = useState<AiScoreReport | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const { isLTISession, submitScore, context, error: ltiError } = useLTI();

  const completionResetDeps = useMemo(() => [mission.id], [mission.id]);
  const canCompleteMission = Boolean(aiScore && aiScore.total >= mission.targetScore);

  const { markCompleted, ltiScoreSubmitted } = useActivityCompletion({
    activityId: completionId,
    onCompleted: () => navigateToActivities(),
    autoComplete: {
      condition: canCompleteMission,
    },
    lti: isLTISession
      ? {
          isSession: isLTISession,
          submitScore,
          canSubmit: canCompleteMission,
          buildPayload: () => {
            if (!aiScore) {
              return null;
            }
            return {
              missionId: mission.id,
              success: true,
              scoreGiven: 1.0,
              scoreMaximum: 1.0,
              activityProgress: "Completed",
              gradingProgress: "FullyGraded",
              metadata: {
                aiScore: aiScore.total,
                targetScore: mission.targetScore,
                missionTitle: mission.title,
                badge: mission.badge,
              },
            };
          },
        }
      : undefined,
    resetOn: completionResetDeps,
  });

  const handleFinish = async () => {
    if (!aiScore || aiScore.total < mission.targetScore) {
      return;
    }

    await markCompleted({ triggerCompletionCallback: true });
  };

  useEffect(() => {
    setPromptText(mission.defaults.starterPrompt);
    setAiScore(null);
    setScoreError(null);
    setStage("briefing");
  }, [mission]);

  const missionProgress = aiScore
    ? clamp(Math.round((aiScore.total / mission.targetScore) * 100), 0, 120)
    : 0;

  const wordTotal = useMemo(() => (promptText ? promptText.trim().split(/\s+/).length : 0), [promptText]);

  const cleanJson = (raw: string) =>
    raw
      .replace(/Résumé du raisonnement[\s\S]*$/i, "")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

  const parseAiScore = (raw: string): AiScoreReport => {
    const cleaned = cleanJson(raw);
    const data = JSON.parse(cleaned) as Partial<AiScoreReport> & Record<string, unknown>;

    const toNumber = (value: unknown, field: keyof AiScoreReport) => {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) {
        throw new Error(`Valeur invalide pour ${field}`);
      }
      return Math.round(numberValue);
    };

    return {
      total: toNumber(data.total, "total"),
      clarity: toNumber(data.clarity, "clarity"),
      specificity: toNumber(data.specificity, "specificity"),
      structure: toNumber(data.structure, "structure"),
      length: toNumber(data.length, "length"),
      comments: typeof data.comments === "string" ? data.comments : "",
      advice: Array.isArray(data.advice)
        ? data.advice.filter((item): item is string => typeof item === "string").slice(0, 3)
        : [],
    };
  };

  const evaluatePrompt = async () => {
    if (!promptText.trim()) {
      setScoreError("Écris ton prompt avant de demander un score.");
      return;
    }

    setScoreLoading(true);
    setScoreError(null);

    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (API_AUTH_KEY) headers["X-API-Key"] = API_AUTH_KEY;

      const response = await fetch(`${API_BASE_URL}/summary`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: `Tu es un évaluateur pédagogique spécialisé dans la rédaction de prompts. Analyse la mission suivante et attribue un score global ainsi que quatre sous-scores (0-100). Réponds uniquement avec un JSON strict, sans commentaire supplémentaire.\n\nMission: ${mission.title}\nNiveau: ${mission.level}\nBadge: ${mission.badge}\nScore cible: ${mission.targetScore}\n\nPrompt à évaluer:\n${promptText}\n\nFormat attendu (JSON strict): {"total":int,"clarity":int,"specificity":int,"structure":int,"length":int,"comments":"string","advice":["string",...]}\n- "comments" : synthèse en 2 phrases max.\n- "advice" : liste de pistes concrètes (3 max).\n- Utilise des entiers pour les scores.\n- Pas d’autre texte hors du JSON.`,
          model: "gpt-5-nano",
          verbosity: "low",
          thinking: "minimal",
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

      const parsed = parseAiScore(raw);
      setAiScore(parsed);
      setStage("arena-results");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inattendue";
      setScoreError(message);
    } finally {
      setScoreLoading(false);
    }
  };

  const downloadPrompt = () => {
    const blob = new Blob([promptText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `prompt_dojo_${mission.id}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderBriefing = () => (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
      <section className="rounded-3xl border border-white/70 bg-white p-8 shadow-sm">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <div className="space-y-2">
              <span className="text-xs uppercase tracking-[0.35em] text-[color:var(--brand-charcoal)]/70">Briefing du dojo</span>
              <h2 className="text-3xl font-semibold text-[color:var(--brand-black)]">Choisis ta mission</h2>
              <p className="max-w-2xl text-sm text-[color:var(--brand-charcoal)]/85">
                Chaque mission te plonge dans une situation vécue au cégep. Sélectionne ton défi, puis franchis les étapes pour
                décrocher le badge.
              </p>
            </div>

            <div className="space-y-3">
              <p className="inline-flex items-center gap-2 rounded-full bg-[color:var(--brand-red)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">
                {mission.badge}
              </p>
              <div className="space-y-1">
                <h3 className="text-xl font-semibold text-[color:var(--brand-black)]">{mission.title}</h3>
                <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90">{mission.description}</p>
              </div>
            </div>

            <ul className="space-y-2 text-sm text-[color:var(--brand-charcoal)]">
              <li className="flex items-start gap-2">
                <TargetIcon className="mt-0.5 h-4 w-4" />
                <span>{mission.defaults.objective}</span>
              </li>
              <li className="flex items-start gap-2">
                <LightbulbIcon className="mt-0.5 h-4 w-4" />
                <span>{mission.defaults.context}</span>
              </li>
            </ul>

            <div>
              <button
                type="button"
                onClick={() => setStage("arena-writing")}
                className="inline-flex items-center gap-2 rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
              >
                <StarsIcon className="h-4 w-4" /> Commencer la mission
              </button>
            </div>
          </div>

          <aside className="flex flex-col justify-between gap-6 rounded-3xl bg-[color:var(--brand-black)]/90 p-6 text-white/90">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-white/60">Objectif</p>
              <p className="text-3xl font-semibold">{mission.targetScore}/100</p>
              <p className="text-sm text-white/70">Atteins ce score IA pour gagner le badge.</p>
            </div>
            <div className="space-y-1 text-sm text-white/80">
              {mission.defaults.checkpoints.map((tip) => (
                <p key={tip}>• {tip}</p>
              ))}
            </div>
          </aside>
        </div>
      </section>

      {MISSIONS.length > 1 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-[color:var(--brand-black)]">Explorer d’autres missions</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {MISSIONS.filter((item) => item.id !== mission.id).map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setMissionId(item.id)}
                className="flex h-full flex-col gap-3 rounded-2xl border border-white/70 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="inline-flex items-center gap-2 rounded-full bg-[color:var(--brand-red)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-red)]">
                  {item.badge}
                </span>
                <div className="space-y-1">
                  <p className="text-base font-semibold text-[color:var(--brand-black)]">{item.title}</p>
                  <p className="text-sm text-[color:var(--brand-charcoal)]/80">{item.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  const renderArena = () => {
    const isWritingStage = stage === "arena-writing";
    const isResultsStage = stage === "arena-results";
    const canFinishMission = Boolean(aiScore && aiScore.total >= mission.targetScore);

    return (
      <div className="min-h-screen bg-[color:var(--brand-sand)] px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <header className="rounded-3xl border border-white/60 bg-white/95 p-5 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <img src={logoPrincipal} alt="Cégep Limoilou" className="h-10 w-auto" />
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/60">Mission</p>
                  <h1 className="text-xl font-semibold text-[color:var(--brand-black)]">{mission.title}</h1>
                  <p className="text-sm text-[color:var(--brand-charcoal)]/80">{mission.description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStage("briefing")}
                className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-red)]/40 px-3 py-1.5 text-xs font-semibold text-[color:var(--brand-red)] transition hover:border-[color:var(--brand-red)]"
              >
                <RefreshIcon className="h-4 w-4" /> Changer de mission
              </button>
            </div>
            <ul className="mt-4 space-y-1 text-sm text-[color:var(--brand-charcoal)]">
              {mission.defaults.checkpoints.map((tip) => (
                <li key={tip}>• {tip}</li>
              ))}
            </ul>
          </header>

          {isWritingStage && (
            <section className="rounded-3xl border border-white/60 bg-white/95 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-[color:var(--brand-black)]">Écris ton prompt</h2>
                <span className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/60">{wordTotal} mots</span>
              </div>
              <textarea
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
                placeholder="Compose ton prompt ici en t’inspirant des éléments de mission."
                className="mt-3 h-64 w-full rounded-2xl border border-[color:var(--brand-charcoal)]/10 bg-white px-4 py-3 text-sm leading-relaxed text-[color:var(--brand-charcoal)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={evaluatePrompt}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-300 sm:w-auto"
                  disabled={scoreLoading}
                >
                  {scoreLoading ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <TargetIcon className="h-4 w-4" />}
                  {scoreLoading ? "Analyse en cours…" : "Demander le score IA"}
                </button>
                <button
                  type="button"
                  onClick={downloadPrompt}
                  className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-red)]/40 px-4 py-2 text-xs font-semibold text-[color:var(--brand-red)] transition hover:border-[color:var(--brand-red)]"
                >
                  <DownloadIcon className="h-4 w-4" /> Exporter
                </button>
              </div>
              {scoreError && <p className="mt-3 rounded-2xl bg-red-50 p-3 text-xs text-red-600">{scoreError}</p>}
            </section>
          )}

          {isResultsStage && (
            <section className="rounded-3xl border border-white/60 bg-white/95 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[color:var(--brand-charcoal)]/60">Score IA</p>
                  <p className="text-3xl font-semibold text-[color:var(--brand-black)]">
                    {aiScore ? `${aiScore.total}/100` : "--"}
                  </p>
                  <p className="text-xs text-[color:var(--brand-charcoal)]/70">Objectif : {mission.targetScore}/100</p>
                </div>
                <div className="hidden sm:block">
                  <ProgressBar value={missionProgress} success={Boolean(aiScore && aiScore.total >= mission.targetScore)} />
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <MetricBadge
                  label="Clarté"
                  value={aiScore ? aiScore.clarity : "--"}
                  ok={Boolean(aiScore && aiScore.clarity >= 70)}
                />
                <MetricBadge
                  label="Spécificité"
                  value={aiScore ? aiScore.specificity : "--"}
                  ok={Boolean(aiScore && aiScore.specificity >= 70)}
                />
                <MetricBadge
                  label="Structure"
                  value={aiScore ? aiScore.structure : "--"}
                  ok={Boolean(aiScore && aiScore.structure >= 70)}
                />
                <MetricBadge
                  label="Longueur"
                  value={aiScore ? `${aiScore.length}` : "--"}
                  ok={Boolean(aiScore && aiScore.length >= 70)}
                />
              </div>
              {aiScore && (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-emerald-300/40 bg-emerald-500/10 p-4 text-sm text-emerald-800">
                    {aiScore.comments && <p className="font-semibold">{aiScore.comments}</p>}
                    {aiScore.advice.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm">
                        {aiScore.advice.map((item, index) => (
                          <li key={`${item}-${index}`}>• {item}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* LTI Success Indicator */}
                  {isLTISession && aiScore.total >= mission.targetScore && (
                    <div className="rounded-2xl border border-blue-300/40 bg-blue-500/10 p-4 text-sm text-blue-800">
                      <div className="flex items-center gap-2">
                        {ltiScoreSubmitted ? (
                          <>
                            <CheckIcon className="h-4 w-4 text-green-600" />
                            <span className="font-semibold">Réussite envoyée à Moodle</span>
                          </>
                        ) : (
                          <>
                            <SpinnerIcon className="h-4 w-4 animate-spin" />
                            <span className="font-semibold">Envoi du résultat à Moodle...</span>
                          </>
                        )}
                      </div>
                      {ltiScoreSubmitted && context && (
                        <p className="mt-1 text-xs">
                          Ta réussite de cette activité a été automatiquement transmise à ton cours Moodle.
                        </p>
                      )}
                    </div>
                  )}

                  {/* LTI Error Indicator */}
                  {ltiError && isLTISession && (
                    <div className="rounded-2xl border border-red-300/40 bg-red-500/10 p-4 text-sm text-red-800">
                      <p className="font-semibold">Problème de connexion Moodle</p>
                      <p className="mt-1 text-xs">{ltiError}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setStage("arena-writing")}
                      className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-red)]/40 px-4 py-2 text-xs font-semibold text-[color:var(--brand-red)] transition hover:border-[color:var(--brand-red)]"
                    >
                      <SparklesIcon className="h-4 w-4" /> Reprendre la rédaction
                    </button>
                    <button
                      type="button"
                      onClick={handleFinish}
                      disabled={!canFinishMission}
                      className="inline-flex items-center gap-2 rounded-full bg-[color:var(--brand-red)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-300"
                    >
                      <StarsIcon className="h-4 w-4" /> Terminer
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    );
  };

  return stage === "briefing" ? renderBriefing() : renderArena();
}

interface MetricBadgeProps {
  label: string;
  value: string | number;
  ok: boolean;
}

function MetricBadge({ label, value, ok }: MetricBadgeProps): JSX.Element {
  return (
    <div
      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-xs font-semibold transition ${
        ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-[color:var(--brand-charcoal)]/10 bg-white/80 text-[color:var(--brand-charcoal)]"
      }`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

interface ProgressBarProps {
  value: number;
  success: boolean;
}

function ProgressBar({ value, success }: ProgressBarProps): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
        <span>{success ? "Objectif atteint" : "Progression"}</span>
        <span>{Math.min(value, 120)}%</span>
      </div>
      <div className="h-3 rounded-full bg-[color:var(--brand-charcoal)]/10">
        <div
          className={`h-full rounded-full transition-all ${
            success ? "bg-emerald-500" : "bg-[color:var(--brand-red)]"
          }`}
          style={{ width: `${clamp(value, 0, 120)}%` }}
        />
      </div>
    </div>
  );
}

interface IconProps {
  className?: string;
}

function TargetIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
    </svg>
  );
}

function LightbulbIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M12 3a6 6 0 0 0-3 11.3V17h6v-2.7A6 6 0 0 0 12 3z" />
      <path d="M9 21h6" />
    </svg>
  );
}

function SparklesIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M12 3v3M12 18v3M5.5 5.5 7 7m10 10 1.5 1.5M3 12h3m15 0h3" />
      <path d="M16 8 14 14l-6 2 2-6z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarsIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M12 4 13.5 8.5 18 10 13.5 11.5 12 16 10.5 11.5 6 10l4.5-1.5z" strokeLinejoin="round" />
      <path d="M6 18l1 2 2 .5-1-2L6 18zM17 3l.5 1.5L19 5l-1.5.5L17 3z" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="M8 11l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M21 12a9 9 0 0 1-15.9 5.4" />
      <path d="M3 12a9 9 0 0 1 15.9-5.4" />
      <path d="M21 4v6h-6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 20v-6h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M21 12a9 9 0 0 1-9 9" strokeLinecap="round" />
      <path d="M3 12a9 9 0 0 1 9-9" strokeLinecap="round" opacity={0.3} />
    </svg>
  );
}

function CheckIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M5 13 9 17 19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default PromptDojo;
