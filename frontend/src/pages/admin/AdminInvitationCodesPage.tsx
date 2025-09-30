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

  const fetchInvitations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await admin.invitations.list(token);
      setInvitations(normalizeInvitations(response.invitations));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible de récupérer les codes d'invitation.";
      setError(message);
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

  const handleGenerate = async (role: InvitationRole) => {
    setCreatingRole(role);
    setError(null);
    try {
      const response = await admin.invitations.create({ role }, token);
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
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void handleGenerate("student");
            }}
            disabled={creatingRole === "student"}
            className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-400"
          >
            {creatingRole === "student"
              ? "Génération…"
              : "Nouveau code étudiant"}
          </button>
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
                return (
                  <tr key={`${invitation.code}-${invitation.createdAt}`} className="align-top">
                    <td className="px-4 py-4 font-mono text-sm font-semibold text-[color:var(--brand-black)]">
                      {invitation.code}
                    </td>
                    <td className="px-4 py-4 text-[color:var(--brand-charcoal)]">
                      {roleLabel}
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
