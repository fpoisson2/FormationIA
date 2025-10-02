import { useCallback, useEffect, useMemo, useState } from "react";

import {
  admin,
  type AdminInvitationCode,
} from "../../api";
import { AdminSkeleton } from "../../components/admin/AdminSkeleton";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

const ROLE_LABELS: Record<string, string> = {
  student: "Étudiant·e",
  creator: "Créateur·trice",
};

type InvitationRole = "student" | "creator";

interface ActivityOption {
  id: string;
  label: string;
}

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const normalizeInvitations = (
  entries: AdminInvitationCode[] | undefined | null
): AdminInvitationCode[] => {
  const list = Array.isArray(entries) ? entries : [];
  return [...list].sort((a, b) => {
    const left = (a.createdAt ?? "").toString();
    const right = (b.createdAt ?? "").toString();
    return right.localeCompare(left);
  });
};

export function AdminInvitationCodesPage(): JSX.Element {
  const { token } = useAdminAuth();
  const [invitations, setInvitations] = useState<AdminInvitationCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingRole, setCreatingRole] = useState<InvitationRole | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<string>("");

  const fetchInvitations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invitationResponse, activitiesResponse] = await Promise.all([
        admin.invitations.list(token),
        admin.activities.get(token),
      ]);
      setInvitations(normalizeInvitations(invitationResponse.invitations));

      const rawActivities = Array.isArray(activitiesResponse.activities)
        ? (activitiesResponse.activities as Array<Record<string, any>>)
        : [];
      const options = rawActivities
        .map((activity) => {
          const idValue =
            typeof activity?.id === "string" && activity.id.trim().length > 0
              ? activity.id.trim()
              : null;
          if (!idValue) {
            return null;
          }
          const card = activity?.card as Record<string, any> | undefined;
          const cardTitle =
            card && typeof card.title === "string" && card.title.trim().length > 0
              ? card.title.trim()
              : null;
          const activityTitle =
            typeof activity?.title === "string" && activity.title.trim().length > 0
              ? activity.title.trim()
              : null;
          return {
            id: idValue,
            label: cardTitle ?? activityTitle ?? idValue,
          } as ActivityOption;
        })
        .filter((option): option is ActivityOption => Boolean(option));
      options.sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
      setActivityOptions(options);
      setSelectedActivityId((current) => {
        if (current && options.some((option) => option.id === current)) {
          return current;
        }
        return options[0]?.id ?? "";
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible de récupérer les codes d'invitation ou la liste des activités.";
      setError(message);
      setActivityOptions([]);
      setSelectedActivityId("");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchInvitations();
  }, [fetchInvitations]);

  useEffect(() => {
    if (!copiedCode) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setCopiedCode(null);
    }, 2000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [copiedCode]);

  const handleGenerate = async (role: InvitationRole, activityId?: string) => {
    setCreatingRole(role);
    setError(null);
    const targetActivityId =
      role === "student"
        ? (activityId ?? "").trim() || selectedActivityId
        : undefined;
    if (role === "student" && !targetActivityId) {
      setError("Sélectionne une activité avant de générer un code étudiant.");
      setCreatingRole(null);
      return;
    }
    try {
      const payload: { role: string; activityId?: string } = { role };
      if (role === "student" && targetActivityId) {
        payload.activityId = targetActivityId;
      }
      const response = await admin.invitations.create(payload, token);
      setInvitations((current) =>
        normalizeInvitations([response.invitation, ...current])
      );
      setCopiedCode(response.invitation.code);
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(response.invitation.code);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible de générer un code d'invitation.";
      setError(message);
    } finally {
      setCreatingRole(null);
    }
  };

  const handleCopy = async (code: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
      setCopiedCode(code);
    } catch (err) {
      console.warn("Impossible de copier le code", err);
      setCopiedCode(null);
    }
  };

  const hasInvitations = invitations.length > 0;

  const availableInvitations = useMemo(
    () => invitations.filter((invitation) => !invitation.consumedAt),
    [invitations]
  );

  const activityLabelById = useMemo(() => {
    const map = new Map<string, string>();
    activityOptions.forEach((option) => {
      map.set(option.id, option.label);
    });
    return map;
  }, [activityOptions]);

  return (
    <div className="space-y-6">
      <header className="border-b border-[color:var(--brand-charcoal)]/10 pb-4">
        <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">
          Codes d'invitation
        </h2>
        <p className="mt-1 text-sm text-[color:var(--brand-charcoal)]">
          Génére des accès étudiants ou créateur·trice et partage les codes
          uniques avec tes collègues et apprenantes ou apprenants.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
            <select
              value={selectedActivityId}
              onChange={(event) => setSelectedActivityId(event.target.value)}
              disabled={creatingRole === "student" || activityOptions.length === 0}
              className="w-full rounded-full border border-[color:var(--brand-charcoal)]/20 bg-white px-4 py-2 text-sm text-[color:var(--brand-charcoal)] shadow-sm transition focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-red)]/20 sm:w-64"
            >
              {activityOptions.length === 0 ? (
                <option value="">Aucune activité disponible</option>
              ) : (
                activityOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={() => {
                void handleGenerate("student", selectedActivityId);
              }}
              disabled={
                creatingRole === "student" || !selectedActivityId || activityOptions.length === 0
              }
              className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-300"
            >
              {creatingRole === "student"
                ? "Génération…"
                : "Nouveau code étudiant"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              void handleGenerate("creator");
            }}
            disabled={creatingRole === "creator"}
            className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-[color:var(--brand-red)] transition hover:bg-[color:var(--brand-red)]/10 disabled:cursor-not-allowed disabled:border-red-200 disabled:text-red-200"
          >
            {creatingRole === "creator"
              ? "Génération…"
              : "Nouveau code créateur"}
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-[color:var(--brand-charcoal)]/80">
          <span>
            {availableInvitations.length} code(s) disponible(s) à partager
          </span>
          <button
            type="button"
            onClick={() => {
              void fetchInvitations();
            }}
            className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/30 px-3 py-1 font-semibold text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
          >
            Actualiser
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/60 bg-white/90 p-6">
          <AdminSkeleton lines={6} />
        </div>
      ) : hasInvitations ? (
        <div className="overflow-hidden rounded-3xl border border-white/60 bg-white/95 shadow-lg">
          <table className="min-w-full divide-y divide-[color:var(--brand-charcoal)]/10 text-sm">
            <thead className="bg-[color:var(--brand-sand)]/30 text-left uppercase tracking-wide text-[color:var(--brand-charcoal)]/70">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Code
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Rôle
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Activité
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Statut
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Généré le
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--brand-charcoal)]/10 bg-white/80">
              {invitations.map((invitation) => {
                const roleLabel = ROLE_LABELS[invitation.role] ?? invitation.role;
                const status = invitation.consumedAt
                  ? `Utilisé par ${invitation.consumedBy ?? "un compte"}`
                  : "Disponible";
                const isCopied = copiedCode === invitation.code;
                const activityLabel = invitation.activityId
                  ? activityLabelById.get(invitation.activityId) ?? invitation.activityId
                  : "—";
                return (
                  <tr key={`${invitation.code}-${invitation.createdAt}`} className="align-top">
                    <td className="px-4 py-4 font-mono text-sm font-semibold text-[color:var(--brand-black)]">
                      {invitation.code}
                    </td>
                    <td className="px-4 py-4 text-[color:var(--brand-charcoal)]">
                      {roleLabel}
                    </td>
                    <td className="px-4 py-4 text-[color:var(--brand-charcoal)]">
                      {activityLabel}
                    </td>
                    <td className="px-4 py-4 text-[color:var(--brand-charcoal)]">
                      {status}
                    </td>
                    <td className="px-4 py-4 text-[color:var(--brand-charcoal)]/80">
                      {formatDateTime(invitation.createdAt)}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void handleCopy(invitation.code);
                          }}
                          className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/20 px-3 py-1 text-xs font-semibold text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
                        >
                          {isCopied ? "Copié !" : "Copier"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-3xl border border-[color:var(--brand-charcoal)]/10 bg-white/90 p-8 text-center text-sm text-[color:var(--brand-charcoal)]">
          <p className="font-semibold text-[color:var(--brand-black)]">
            Aucun code généré pour le moment
          </p>
          <p className="mt-2">
            Utilise les boutons ci-dessus pour créer un accès étudiant ou créateur à partager.
          </p>
        </div>
      )}
    </div>
  );
}

export default AdminInvitationCodesPage;
