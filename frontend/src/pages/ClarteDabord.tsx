import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Mission, StageAnswer, StageRecord } from "../api";
import { getMissions, submitStage } from "../api";
import FinalReveal from "../components/FinalReveal";
import MissionSelector from "../components/MissionSelector";
import PromptStage from "../components/PromptStage";
import logoPrincipal from "../assets/logo_principal.svg";

function generateRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ClarteDabord(): JSX.Element {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [stageIndex, setStageIndex] = useState(0);
  const [records, setRecords] = useState<StageRecord[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getMissions();
        if (!cancelled) {
          setMissions(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || "Impossible de charger les missions.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  const selectedMission = useMemo(() => {
    if (!selectedMissionId) {
      return null;
    }
    return missions.find((mission) => mission.id === selectedMissionId) ?? null;
  }, [missions, selectedMissionId]);

  const startMission = useCallback(
    (missionId: string) => {
      setSelectedMissionId(missionId);
      setStageIndex(0);
      setRecords([]);
      setRunId(generateRunId());
      setServerError(null);
    },
    []
  );

  const resetToSelector = useCallback(() => {
    setSelectedMissionId(null);
    setStageIndex(0);
    setRecords([]);
    setRunId(null);
    setServerError(null);
  }, []);

  const handleReplay = useCallback(() => {
    if (!selectedMission) {
      return;
    }
    setStageIndex(0);
    setRecords([]);
    setRunId(generateRunId());
    setServerError(null);
  }, [selectedMission]);

  const handleSubmitStage = useCallback(
    async (values: StageAnswer) => {
      if (!selectedMission) {
        return;
      }
      setIsSubmitting(true);
      setServerError(null);
      try {
        const response = await submitStage({
          missionId: selectedMission.id,
          stageIndex,
          payload: values,
          runId: runId ?? undefined,
        });
        if (!runId) {
          setRunId(response.runId);
        }
        setRecords((prev) => [
          ...prev,
          {
            stageIndex,
            prompt: selectedMission.stages[stageIndex]?.prompt ?? "",
            values,
          },
        ]);
        setStageIndex((prev) => prev + 1);
      } catch (err) {
        setServerError((err as Error).message || "Impossible d’enregistrer la manche.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [runId, selectedMission, stageIndex]
  );

  const handleNextMission = useCallback(() => {
    if (!selectedMission) {
      return;
    }
    const currentIndex = missions.findIndex((mission) => mission.id === selectedMission.id);
    if (currentIndex === -1) {
      return;
    }
    const nextMission = missions[currentIndex + 1];
    if (nextMission) {
      startMission(nextMission.id);
    } else {
      resetToSelector();
    }
  }, [missions, resetToSelector, selectedMission, startMission]);

  const missionContent = () => {
    if (!selectedMission) {
      return null;
    }
    if (stageIndex >= selectedMission.stages.length) {
      const currentIndex = missions.findIndex((mission) => mission.id === selectedMission.id);
      const hasNextMission = currentIndex !== -1 && currentIndex < missions.length - 1;
      return (
        <FinalReveal
          mission={selectedMission}
          records={records}
          onReplay={handleReplay}
          onBack={resetToSelector}
          onNextMission={hasNextMission ? handleNextMission : undefined}
        />
      );
    }

    const existing = records.find((record) => record.stageIndex === stageIndex)?.values;

    return (
      <PromptStage
        mission={selectedMission}
        stageIndex={stageIndex}
        history={records}
        initialValues={existing}
        onSubmit={handleSubmitStage}
        onBack={resetToSelector}
        isSubmitting={isSubmitting}
        serverError={serverError ?? undefined}
      />
    );
  };

  return (
    <div className="landing-gradient min-h-screen px-6 py-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="space-y-6 rounded-3xl border border-white/70 bg-white/90 p-8 shadow-sm backdrop-blur">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <Link to="/" className="flex items-center gap-3">
              <img src={logoPrincipal} alt="Cégep Limoilou" className="h-12 w-auto md:h-14" />
              <span className="text-xs uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/70">
                Clarté d’abord !
              </span>
            </Link>
            <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
              Trois manches guidées
            </span>
          </div>
          <div className="space-y-2 text-center md:text-left">
            <h1 className="text-3xl font-semibold md:text-4xl">
              Identifie ce qu’il fallait dire dès la première consigne
            </h1>
            <p className="mx-auto max-w-3xl text-sm text-[color:var(--brand-charcoal)] md:text-base">
              Tu joues l’IA : l’usager précise son besoin manche après manche. Observe ce qui manquait au brief initial et retiens la checklist idéale.
            </p>
          </div>
        </header>

        {loading ? (
          <div className="rounded-3xl border border-white/60 bg-white/90 p-6 text-center text-sm text-[color:var(--brand-charcoal)]">
            Chargement des missions…
          </div>
        ) : error ? (
          <div className="space-y-4 rounded-3xl border border-white/60 bg-white/90 p-6 text-center shadow-sm">
            <p className="text-sm font-semibold text-red-600">{error}</p>
            <button
              type="button"
              className="cta-button cta-button--light"
              onClick={() => {
                setSelectedMissionId(null);
                setReloadCount((count) => count + 1);
              }}
            >
              Réessayer
            </button>
          </div>
        ) : !selectedMission ? (
          <MissionSelector missions={missions} onSelect={startMission} />
        ) : (
          missionContent()
        )}
      </div>
    </div>
  );
}

export default ClarteDabord;
