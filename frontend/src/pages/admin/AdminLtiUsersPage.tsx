import { useCallback, useEffect, useMemo, useState } from "react";

import { admin, type AdminLtiUser } from "../../api";
import { AdminSkeleton } from "../../components/admin/AdminSkeleton";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

type SortKey = "lastLoginAt" | "loginCount" | "completedActivities";
type SortDirection = "asc" | "desc";

function formatDate(value?: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function sortUsers(users: AdminLtiUser[], key: SortKey, direction: SortDirection): AdminLtiUser[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...users].sort((a, b) => {
    if (key === "loginCount") {
      return (a.loginCount - b.loginCount) * factor;
    }
    if (key === "completedActivities") {
      return (a.completedActivities - b.completedActivities) * factor;
    }
    const dateA = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
    const dateB = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
    return (dateA - dateB) * factor;
  });
}

export function AdminLtiUsersPage(): JSX.Element {
  const { token } = useAdminAuth();
  const [users, setUsers] = useState<AdminLtiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [issuer, setIssuer] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("lastLoginAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [includeDetails, setIncludeDetails] = useState(false);
  const [issuerOptions, setIssuerOptions] = useState<string[]>([]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await admin.ltiUsers.list(
        {
          page,
          pageSize,
          search: search.trim() || undefined,
          issuer: issuer || undefined,
          includeDetails,
        },
        token
      );
      setUsers(response.items);
      setTotalPages(response.totalPages);
      setIssuerOptions((previous) => {
        const issuers = new Set(previous);
        response.items.forEach((item) => {
          if (item.issuer) {
            issuers.add(item.issuer);
          }
        });
        const next = Array.from(issuers).sort();
        if (next.length === previous.length && next.every((value, index) => value === previous[index])) {
          return previous;
        }
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de récupérer les utilisateurs LTI.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, issuer, includeDetails, token]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const sortedUsers = useMemo(() => sortUsers(users, sortKey, sortDirection), [users, sortKey, sortDirection]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "lastLoginAt" ? "desc" : "desc");
    }
  };

  const sortLabel = (key: SortKey) => {
    if (sortKey !== key) {
      return "↕";
    }
    return sortDirection === "asc" ? "↑" : "↓";
  };

  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  return (
    <div className="space-y-6">
      <header className="border-b border-[color:var(--brand-charcoal)]/10 pb-4">
        <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">Utilisateurs LTI</h2>
        <p className="mt-1 text-sm text-[color:var(--brand-charcoal)]">
          Analyse les connexions et l’activité des comptes synchronisés via les plateformes partenaires.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-3xl border border-white/60 bg-white/90 p-4 shadow-sm md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3 text-sm text-[color:var(--brand-charcoal)] md:flex-row md:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]">Recherche</span>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Nom, courriel ou sujet"
              className="w-full rounded-full border border-[color:var(--brand-charcoal)]/20 bg-white px-4 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]">Issuer</span>
            <select
              value={issuer}
              onChange={(event) => {
                setIssuer(event.target.value);
                setPage(1);
              }}
              className="w-full rounded-full border border-[color:var(--brand-charcoal)]/20 bg-white px-4 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
            >
              <option value="">Tous</option>
              {issuerOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-full bg-[color:var(--brand-sand)]/70 px-4 py-2 text-xs font-medium text-[color:var(--brand-charcoal)]">
            <input
              type="checkbox"
              checked={includeDetails}
              onChange={(event) => {
                setIncludeDetails(event.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-[color:var(--brand-charcoal)]/30 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
            />
            Activités détaillées
          </label>
        </div>
        <div className="flex items-center gap-2 text-xs text-[color:var(--brand-charcoal)]">
          <label className="flex items-center gap-2">
            <span>Par page</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded-full border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-1 focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-inner">
          <AdminSkeleton lines={8} />
          <div className="mt-4">
            <AdminSkeleton lines={8} />
          </div>
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[color:var(--brand-charcoal)]/30 bg-white/80 p-6 text-center text-sm text-[color:var(--brand-charcoal)]">
          Aucun utilisateur à afficher pour ces filtres.
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-3xl border border-white/60 shadow-sm">
          <table className="w-full min-w-full table-fixed divide-y divide-[color:var(--brand-charcoal)]/10 text-sm">
            <thead className="bg-[color:var(--brand-sand)]/60 text-[color:var(--brand-charcoal)]/80">
              <tr>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Utilisateur</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Courriel</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Issuer</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Subject</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => handleSort("loginCount")}
                  >
                    Connexions {sortLabel("loginCount")}
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => handleSort("completedActivities")}
                  >
                    Activités {sortLabel("completedActivities")}
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => handleSort("lastLoginAt")}
                  >
                    Dernière connexion {sortLabel("lastLoginAt")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--brand-charcoal)]/10 bg-white/95">
              {sortedUsers.map((user) => (
                <tr key={`${user.issuer}-${user.subject}`} className="transition hover:bg-[color:var(--brand-sand)]/40">
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-semibold text-[color:var(--brand-black)]">{user.displayName}</span>
                      {user.profileMissing ? (
                        <span className="text-xs text-[color:var(--brand-red)]">Profil incomplet</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="break-words px-4 py-3 text-[color:var(--brand-charcoal)]">{user.email ?? "—"}</td>
                  <td className="break-words px-4 py-3 text-[color:var(--brand-charcoal)]">{user.issuer}</td>
                  <td className="break-words px-4 py-3 text-[color:var(--brand-charcoal)]">{user.subject}</td>
                  <td className="px-4 py-3 text-[color:var(--brand-black)]">{user.loginCount}</td>
                  <td className="px-4 py-3 text-[color:var(--brand-black)]">{user.completedActivities}</td>
                  <td className="px-4 py-3 text-[color:var(--brand-charcoal)]">{formatDate(user.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex flex-col items-center justify-between gap-4 rounded-3xl border border-white/60 bg-white/90 p-4 text-xs text-[color:var(--brand-charcoal)] md:flex-row">
        <div>
          Page {page} sur {Math.max(totalPages, 1)}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={!canGoPrevious}
            className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 font-medium transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)] disabled:cursor-not-allowed disabled:border-transparent disabled:text-[color:var(--brand-charcoal)]/40"
          >
            Précédent
          </button>
          <button
            type="button"
            onClick={() => setPage((value) => value + 1)}
            disabled={!canGoNext}
            className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 font-medium transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)] disabled:cursor-not-allowed disabled:border-transparent disabled:text-[color:var(--brand-charcoal)]/40"
          >
            Suivant
          </button>
        </div>
      </footer>
    </div>
  );
}
