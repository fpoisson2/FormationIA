import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  admin,
  type AdminLocalUser,
  type AdminLocalUserCreatePayload,
  type AdminLocalUserUpdatePayload,
} from "../../api";
import { AdminModal } from "../../components/admin/AdminModal";
import { AdminSkeleton } from "../../components/admin/AdminSkeleton";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

interface LocalUserFormState {
  username: string;
  password: string;
  roles: string[];
  isActive: boolean;
}

const AVAILABLE_ROLES = [
  { value: "admin", label: "Administrateur", description: "Accès complet aux pages d'administration" },
  { value: "usager", label: "Usager", description: "Accès aux activités de formation" },
] as const;

// Note: Les guards acceptent aussi ces variantes pour compatibilité :
// Admin: "superadmin", "administrator"
// Usager: "user", "participant", "learner", "etudiant", "étudiant"

function createFormState(user?: AdminLocalUser | null): LocalUserFormState {
  return {
    username: user?.username ?? "",
    password: "",
    roles: user?.roles ?? ["admin"],
    isActive: user?.isActive ?? true,
  };
}


export function AdminLocalUsersPage(): JSX.Element {
  const { token, user: currentUser, refresh } = useAdminAuth();
  const [users, setUsers] = useState<AdminLocalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [formState, setFormState] = useState<LocalUserFormState>(() => createFormState());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminLocalUser | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await admin.localUsers.list(token);
      setUsers(response.users);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de récupérer les comptes internes.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const closeModal = () => {
    setModalOpen(false);
    setFormState(createFormState());
    setFormError(null);
    setSelectedUser(null);
  };

  const openCreateModal = () => {
    setMode("create");
    setFormState(createFormState());
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (user: AdminLocalUser) => {
    setMode("edit");
    setSelectedUser(user);
    setFormState(createFormState(user));
    setFormError(null);
    setModalOpen(true);
  };

  const openPasswordModal = (user: AdminLocalUser) => {
    setSelectedUser(user);
    setPasswordValue("");
    setPasswordError(null);
    setPasswordModalOpen(true);
  };

  const closePasswordModal = () => {
    setSelectedUser(null);
    setPasswordValue("");
    setPasswordError(null);
    setPasswordModalOpen(false);
  };

  const upsertUser = (user: AdminLocalUser) => {
    setUsers((current) => {
      const index = current.findIndex((item) => item.username === user.username);
      if (index === -1) {
        return [...current, user].sort((a, b) => a.username.localeCompare(b.username));
      }
      const next = [...current];
      next[index] = user;
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const username = formState.username.trim();
      if (!username) {
        setFormError("Le nom d’utilisateur est obligatoire.");
        setSaving(false);
        return;
      }
      const payloadRoles = formState.roles.length > 0 ? formState.roles : undefined;
      if (mode === "create") {
        const password = formState.password.trim();
        if (password.length < 8) {
          setFormError("Le mot de passe doit contenir au moins 8 caractères.");
          setSaving(false);
          return;
        }
        const payload: AdminLocalUserCreatePayload = {
          username,
          password,
          isActive: formState.isActive,
          roles: payloadRoles,
        };
        const response = await admin.localUsers.create(payload, token);
        upsertUser(response.user);
      } else if (selectedUser) {
        const payload: AdminLocalUserUpdatePayload = {
          isActive: formState.isActive,
          roles: payloadRoles,
        };
        const response = await admin.localUsers.update(username, payload, token);
        upsertUser(response.user);
        if (currentUser?.username === username) {
          void refresh();
        }
      }
      closeModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Enregistrement impossible.";
      setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser) {
      return;
    }
    const password = passwordValue.trim();
    if (password.length < 8) {
      setPasswordError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    try {
      await admin.localUsers.resetPassword(selectedUser.username, { password }, token);
      setPasswordModalOpen(false);
      setPasswordValue("");
      setPasswordError(null);
      if (currentUser?.username === selectedUser.username) {
        void refresh();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de mettre à jour le mot de passe.";
      setPasswordError(message);
    }
  };

  return (
    <div className="space-y-6">
      <header className="border-b border-[color:var(--brand-charcoal)]/10 pb-4">
        <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">Comptes internes</h2>
        <p className="mt-1 text-sm text-[color:var(--brand-charcoal)]">
          Crée des accès administrateur ou facilitateur pour tes collègues et maintiens leurs droits d’accès.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600"
        >
          + Nouveau compte
        </button>
        <button
          type="button"
          onClick={() => {
            void fetchUsers();
          }}
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
          <AdminSkeleton lines={6} />
          <div className="mt-4">
            <AdminSkeleton lines={6} />
          </div>
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[color:var(--brand-charcoal)]/30 bg-white/80 p-6 text-center text-sm text-[color:var(--brand-charcoal)]">
          Aucun compte interne n’a encore été créé.
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-3xl border border-white/60 shadow-sm">
          <table className="w-full min-w-full table-fixed divide-y divide-[color:var(--brand-charcoal)]/10 text-sm">
            <thead className="bg-[color:var(--brand-sand)]/60 text-[color:var(--brand-charcoal)]/80">
              <tr>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Utilisateur</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Rôles</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Statut</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Origine</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--brand-charcoal)]/10 bg-white/95">
              {users.map((user) => (
                <tr key={user.username} className="transition hover:bg-[color:var(--brand-sand)]/40">
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-semibold text-[color:var(--brand-black)]">{user.username}</span>
                      <span className="text-xs text-[color:var(--brand-charcoal)]/70">
                        Créé le {formatDate(user.createdAt)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {user.roles.map((role) => (
                        <span
                          key={role}
                          className="inline-flex items-center rounded-full bg-[color:var(--brand-sand)]/70 px-3 py-1 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]"
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-green-700">
                        Actif
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
                        Inactif
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[color:var(--brand-charcoal)]">
                    {user.fromEnv ? "Configuration" : "Interface"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(user)}
                        className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-3 py-1 text-xs font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => openPasswordModal(user)}
                        className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-3 py-1 text-xs font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
                      >
                        Mot de passe
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminModal
        open={modalOpen}
        onClose={closeModal}
        title={mode === "create" ? "Créer un compte interne" : `Modifier ${selectedUser?.username ?? "le compte"}`}
        description={
          mode === "create"
            ? "Attribue un mot de passe fort et les rôles attendus."
            : "Active ou ajuste les rôles d’un compte existant."
        }
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-sm font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
            >
              Annuler
            </button>
            <button
              type="submit"
              form="admin-local-user-form"
              disabled={saving}
              className="rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-400"
            >
              {saving ? "Enregistrement…" : mode === "create" ? "Créer" : "Mettre à jour"}
            </button>
          </div>
        }
      >
        {formError ? <p className="rounded-3xl bg-red-50 p-3 text-xs text-red-600">{formError}</p> : null}
        <form id="admin-local-user-form" className="grid gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            Nom d’utilisateur
            <input
              type="text"
              value={formState.username}
              onChange={(event) => setFormState((prev) => ({ ...prev, username: event.target.value }))}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="ex: admin"
              required
              disabled={mode === "edit"}
            />
          </label>
          {mode === "create" ? (
            <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
              Mot de passe initial
              <input
                type="password"
                value={formState.password}
                onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
                placeholder="Au moins 8 caractères"
                required
              />
            </label>
          ) : null}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
              Rôles d'accès
            </label>
            <div className="space-y-2">
              {AVAILABLE_ROLES.map((role) => (
                <label key={role.value} className="flex items-start gap-3 rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white p-3 transition hover:border-[color:var(--brand-red)]/40">
                  <input
                    type="checkbox"
                    checked={formState.roles.includes(role.value)}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setFormState((prev) => ({ ...prev, roles: [...prev.roles, role.value] }));
                      } else {
                        setFormState((prev) => ({ ...prev, roles: prev.roles.filter(r => r !== role.value) }));
                      }
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-[color:var(--brand-charcoal)]/30 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[color:var(--brand-black)]">{role.label}</div>
                    <div className="text-xs text-[color:var(--brand-charcoal)]/70">{role.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            <input
              type="checkbox"
              checked={formState.isActive}
              onChange={(event) => setFormState((prev) => ({ ...prev, isActive: event.target.checked }))}
              className="h-4 w-4 rounded border-[color:var(--brand-charcoal)]/30 text-[color:var(--brand-red)] focus:ring-[color:var(--brand-red)]"
            />
            Compte actif
          </label>
        </form>
      </AdminModal>

      <AdminModal
        open={passwordModalOpen}
        onClose={closePasswordModal}
        title={`Réinitialiser ${selectedUser?.username ?? "le mot de passe"}`}
        description="Définis un nouveau mot de passe temporaire pour ce compte."
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closePasswordModal}
              className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-sm font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
            >
              Annuler
            </button>
            <button
              type="submit"
              form="admin-password-form"
              className="rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600"
            >
              Mettre à jour
            </button>
          </div>
        }
      >
        {passwordError ? <p className="rounded-3xl bg-red-50 p-3 text-xs text-red-600">{passwordError}</p> : null}
        <form id="admin-password-form" className="space-y-4" onSubmit={handlePasswordSubmit}>
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            Nouveau mot de passe
            <input
              type="password"
              value={passwordValue}
              onChange={(event) => setPasswordValue(event.target.value)}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="Au moins 8 caractères"
              required
            />
          </label>
        </form>
      </AdminModal>
    </div>
  );
}

function formatDate(value?: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}
