import { useCallback, useEffect, useMemo, useState } from "react";

import { admin, type AdminLtiUser, type PaginatedResponse } from "../../api";
import { getDefaultActivityDefinitions } from "../../config/activities";
import { AdminSkeleton } from "../../components/admin/AdminSkeleton";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

interface ActivityStats {
  totalUsers: number;
  totalCompletions: number;
  completionRate: number;
  activityBreakdown: Array<{
    activityId: string;
    activityTitle: string;
    completions: number;
    rate: number;
  }>;
}

export function AdminActivityTrackingPage(): JSX.Element {
  const { token } = useAdminAuth();
  const catalogActivities = useMemo(
    () => getDefaultActivityDefinitions(),
    []
  );
  const [users, setUsers] = useState<AdminLtiUser[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedActivity, setSelectedActivity] = useState<string>("all");

  const fetchUsers = useCallback(async (page: number = 1, search: string = "") => {
    setLoading(true);
    setError(null);
    try {
      const response: PaginatedResponse<AdminLtiUser> = await admin.ltiUsers.list(
        {
          page,
          pageSize: 20,
          search: search.trim() || undefined,
          includeDetails: true,
        },
        token
      );

      setUsers(response.items);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);

      // Calculate activity statistics
      const totalUsers = response.total;
      const usersWithProgress = response.items.filter(user => user.hasProgress);

      const activityCompletions = new Map<string, number>();

      response.items.forEach(user => {
        user.completedActivityIds.forEach(activityId => {
          activityCompletions.set(activityId, (activityCompletions.get(activityId) || 0) + 1);
        });
      });

      const activityBreakdown = catalogActivities.map(activity => {
        const completions = activityCompletions.get(activity.id) || 0;
        return {
          activityId: activity.id,
          activityTitle: activity.card.title,
          completions,
          rate: totalUsers > 0 ? (completions / totalUsers) * 100 : 0,
        };
      });

      const totalCompletions = Array.from(activityCompletions.values()).reduce((sum, count) => sum + count, 0);

      setStats({
        totalUsers,
        totalCompletions,
        completionRate: totalUsers > 0 ? (usersWithProgress.length / totalUsers) * 100 : 0,
        activityBreakdown,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de récupérer les données utilisateurs.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, catalogActivities]);

  useEffect(() => {
    void fetchUsers(1, searchTerm);
  }, [fetchUsers, searchTerm]);

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    void fetchUsers(page, searchTerm);
  };

  const filteredUsers = selectedActivity === "all"
    ? users
    : users.filter(user => user.completedActivityIds.includes(selectedActivity));

  const formatDate = (dateString?: string | null): string => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
  };

  const formatDateTime = (dateString?: string | null): string => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  };

  return (
    <div className="space-y-6">
      <header className="border-b border-[color:var(--brand-charcoal)]/10 pb-4">
        <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">Suivi d'activités</h2>
        <p className="mt-1 text-sm text-[color:var(--brand-charcoal)]">
          Consultez les statistiques de progression et l'activité des utilisateurs.
        </p>
      </header>

      {/* Statistics Overview */}
      {stats && !loading && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-blue-50 p-4">
            <div className="text-2xl font-bold text-blue-900">{stats.totalUsers}</div>
            <div className="text-sm text-blue-700">Utilisateurs total</div>
          </div>
          <div className="rounded-2xl bg-green-50 p-4">
            <div className="text-2xl font-bold text-green-900">{stats.totalCompletions}</div>
            <div className="text-sm text-green-700">Activités complétées</div>
          </div>
          <div className="rounded-2xl bg-purple-50 p-4">
            <div className="text-2xl font-bold text-purple-900">{stats.completionRate.toFixed(1)}%</div>
            <div className="text-sm text-purple-700">Taux de participation</div>
          </div>
        </div>
      )}

      {/* Activity Breakdown */}
      {stats && !loading && (
        <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[color:var(--brand-black)]">Répartition par activité</h3>
          <div className="space-y-3">
            {stats.activityBreakdown.map((activity) => (
              <div key={activity.activityId} className="flex items-center justify-between py-2">
                <div className="flex-1">
                  <div className="font-medium text-[color:var(--brand-black)]">{activity.activityTitle}</div>
                  <div className="flex items-center gap-4 text-sm text-[color:var(--brand-charcoal)]">
                    <span>{activity.completions} utilisateur{activity.completions !== 1 ? 's' : ''}</span>
                    <span>{activity.rate.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="w-32">
                  <div className="h-2 rounded-full bg-gray-200">
                    <div
                      className="h-2 rounded-full bg-[color:var(--brand-red)]"
                      style={{ width: `${Math.min(100, activity.rate)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters and Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Rechercher un utilisateur..."
            value={searchTerm}
            onChange={handleSearch}
            className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
          />
          <select
            value={selectedActivity}
            onChange={(e) => setSelectedActivity(e.target.value)}
            className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-sm focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
          >
            <option value="all">Toutes les activités</option>
            {catalogActivities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.card.title}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => fetchUsers(currentPage, searchTerm)}
          className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-xs font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
        >
          Rafraîchir
        </button>
      </div>

      {error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-inner">
          <AdminSkeleton lines={8} />
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[color:var(--brand-charcoal)]/30 bg-white/80 p-6 text-center text-sm text-[color:var(--brand-charcoal)]">
          {searchTerm || selectedActivity !== "all" ? "Aucun utilisateur ne correspond aux critères." : "Aucun utilisateur trouvé."}
        </div>
      ) : (
        <>
          {/* Users Table */}
          <div className="w-full overflow-x-auto rounded-3xl border border-white/60 shadow-sm">
            <table className="w-full min-w-full table-fixed divide-y divide-[color:var(--brand-charcoal)]/10 text-sm">
              <thead className="bg-[color:var(--brand-sand)]/60 text-[color:var(--brand-charcoal)]/80">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Utilisateur</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Plateforme</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Activités complétées</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Dernière connexion</th>
                  <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Connexions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--brand-charcoal)]/10 bg-white/95">
                {filteredUsers.map((user) => (
                  <tr key={`${user.issuer}-${user.subject}`} className="transition hover:bg-[color:var(--brand-sand)]/40">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-semibold text-[color:var(--brand-black)]">
                          {user.displayName}
                        </span>
                        {user.email && (
                          <span className="break-words text-xs text-[color:var(--brand-charcoal)]/70">
                            {user.email}
                          </span>
                        )}
                        <span className="break-words text-xs text-[color:var(--brand-charcoal)]/50">
                          ID: {user.subject}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="break-words text-xs text-[color:var(--brand-charcoal)]">
                        {user.issuer}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-[color:var(--brand-black)]">
                          {user.completedActivities} activité{user.completedActivities !== 1 ? 's' : ''}
                        </span>
                        {user.completedActivityIds.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {user.completedActivityIds.map((activityId) => {
                              const activity = catalogActivities.find(a => a.id === activityId);
                              return activity ? (
                                <span
                                  key={activityId}
                                  className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700"
                                >
                                  {activity.card.title}
                                </span>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[color:var(--brand-charcoal)]">
                      {formatDateTime(user.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--brand-charcoal)]">
                      {user.loginCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-3 py-1 text-sm text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              <span className="text-sm text-[color:var(--brand-charcoal)]">
                Page {currentPage} sur {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-3 py-1 text-sm text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}