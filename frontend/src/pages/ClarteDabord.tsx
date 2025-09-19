import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Mission, StageAnswer, StageRecord } from "../api";
import { getMissions, submitStage, updateActivityProgress } from "../api";
import ActivityLayout from "../components/ActivityLayout";
import FinalReveal from "../components/FinalReveal";
import MissionSelector from "../components/MissionSelector";
import PromptStage from "../components/PromptStage";

function generateRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ClarteDabord(): JSX.Element {
  const navigate = useNavigate();
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
  const [activityProgressMarked, setActivityProgressMarked] = useState(false);

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
      setActivityProgressMarked(false);
    },
    []
  );

  const resetToSelector = useCallback(() => {
    setSelectedMissionId(null);
    setStageIndex(0);
    setRecords([]);
    setRunId(null);
    setServerError(null);
    setActivityProgressMarked(false);
  }, []);

  const handleReplay = useCallback(() => {
    if (!selectedMission) {
      return;
    }
    setStageIndex(0);
    setRecords([]);
    setRunId(generateRunId());
    setServerError(null);
    setActivityProgressMarked(false);
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

  const handleFinish = useCallback(async () => {
    if (!activityProgressMarked) {
      try {
        await updateActivityProgress({ activityId: "clarte-dabord", completed: true });
        setActivityProgressMarked(true);
      } catch (error) {
        console.error("Unable to persist Clarté d'abord progress", error);
      }
    }
    navigate("/activites", { state: { completed: "clarte-dabord" } });
  }, [activityProgressMarked, navigate, updateActivityProgress]);

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
          onFinish={handleFinish}
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
    <ActivityLayout
      activityId="clarte-dabord"
      eyebrow="Clarté d’abord !"
      title="Identifie ce qu’il fallait dire dès la première consigne"
      subtitle="Tu joues l’IA : l’usager précise son besoin manche après manche. Observe ce qui manquait au brief initial et retiens la checklist idéale."
      badge="Trois manches guidées"
      contentAs="div"
      contentClassName="gap-10"
    >
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
    </ActivityLayout>
  );
}

export default ClarteDabord;
