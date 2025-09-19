import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  admin,
  type AdminPlatform,
  type AdminPlatformPayload,
  type AdminPlatformSaveMode,
} from "../../api";
import { AdminModal } from "../../components/admin/AdminModal";
import { AdminSkeleton } from "../../components/admin/AdminSkeleton";
import { useAdminAuth } from "../../providers/AdminAuthProvider";

interface PlatformFormState {
  issuer: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  deploymentId: string;
  deploymentIds: string;
  audience: string;
}

function createFormState(platform?: AdminPlatform | null): PlatformFormState {
  const deploymentIds = Array.from(new Set(platform?.deploymentIds ?? [])).join("\n");
  return {
    issuer: platform?.issuer ?? "",
    clientId: platform?.clientId ?? "",
    authorizationEndpoint: platform?.authorizationEndpoint ?? "",
    tokenEndpoint: platform?.tokenEndpoint ?? "",
    jwksUri: platform?.jwksUri ?? "",
    deploymentId: platform?.deploymentId ?? "",
    deploymentIds,
    audience: platform?.audience ?? "",
  };
}

function normalizePayload(state: PlatformFormState): AdminPlatformPayload {
  const deployments = new Set<string>();
  const deploymentId = state.deploymentId.trim();
  if (deploymentId) {
    deployments.add(deploymentId);
  }
  const extraDeployments = state.deploymentIds
    .split(/\r?\n|,/) // handle newline or comma separated values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  extraDeployments.forEach((value) => deployments.add(value));

  const deploymentIds = Array.from(deployments);

  return {
    issuer: state.issuer.trim(),
    clientId: state.clientId.trim(),
    authorizationEndpoint: state.authorizationEndpoint.trim() || null,
    tokenEndpoint: state.tokenEndpoint.trim() || null,
    jwksUri: state.jwksUri.trim() || null,
    deploymentId: deploymentId || null,
    deploymentIds,
    audience: state.audience.trim() || null,
  };
}

export function AdminPlatformsPage(): JSX.Element {
  const { token } = useAdminAuth();
  const [platforms, setPlatforms] = useState<AdminPlatform[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<AdminPlatform | null>(null);
  const [formState, setFormState] = useState<PlatformFormState>(() => createFormState());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchPlatforms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await admin.platforms.list(token);
      setPlatforms(response.platforms);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de récupérer les plateformes.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchPlatforms();
  }, [fetchPlatforms]);

  const closeModal = () => {
    setModalOpen(false);
    setEditingPlatform(null);
    setFormState(createFormState());
    setFormError(null);
  };

  const openCreateModal = () => {
    setEditingPlatform(null);
    setFormState(createFormState());
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (platform: AdminPlatform) => {
    setEditingPlatform(platform);
    setFormState(createFormState(platform));
    setFormError(null);
    setModalOpen(true);
  };

  const upsertPlatformInList = (platform: AdminPlatform) => {
    setPlatforms((current) => {
      const existingIndex = current.findIndex(
        (item) => item.issuer === platform.issuer && item.clientId === platform.clientId
      );
      if (existingIndex === -1) {
        return [...current, platform].sort((a, b) => {
          const issuerCompare = a.issuer.localeCompare(b.issuer);
          if (issuerCompare !== 0) {
            return issuerCompare;
          }
          return a.clientId.localeCompare(b.clientId);
        });
      }
      const next = [...current];
      next[existingIndex] = platform;
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = normalizePayload(formState);
      if (!payload.issuer || !payload.clientId) {
        setFormError("L’issuer et le client ID sont requis.");
        setSaving(false);
        return;
      }
      const mode: AdminPlatformSaveMode = editingPlatform ? "replace" : "create";
      const response = await admin.platforms.save(payload, { mode, token });
      upsertPlatformInList(response.platform);
      closeModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Échec de l’enregistrement de la plateforme.";
      setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (platform: AdminPlatform) => {
    const confirmMessage = `Supprimer la plateforme ${platform.issuer} (${platform.clientId}) ?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    try {
      await admin.platforms.remove(platform.issuer, platform.clientId, token);
      setPlatforms((current) =>
        current.filter((item) => !(item.issuer === platform.issuer && item.clientId === platform.clientId))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de supprimer la plateforme.";
      setError(message);
    }
  };

  const modalTitle = editingPlatform ? "Modifier la plateforme LTI" : "Ajouter une plateforme LTI";
  const modalDescription = editingPlatform
    ? "Les modifications seront appliquées immédiatement."
    : "Enregistre les informations fournies par ton fournisseur LTI.";
  const isReadOnly = editingPlatform?.readOnly ?? false;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-[color:var(--brand-charcoal)]/10 pb-4">
        <div>
          <h2 className="text-2xl font-semibold text-[color:var(--brand-black)]">Plateformes LTI</h2>
          <p className="mt-1 text-sm text-[color:var(--brand-charcoal)]">
            Déclare les plateformes de confiance et maintiens leurs paramètres d’authentification.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600"
          >
            + Nouvelle plateforme
          </button>
          <button
            type="button"
            onClick={() => {
              void fetchPlatforms();
            }}
            className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-xs font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
          >
            Rafraîchir
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-inner">
          <AdminSkeleton lines={6} />
          <div className="mt-4">
            <AdminSkeleton lines={6} />
          </div>
        </div>
      ) : platforms.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[color:var(--brand-charcoal)]/30 bg-white/80 p-6 text-center text-sm text-[color:var(--brand-charcoal)]">
          Aucune plateforme configurée pour le moment.
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-white/60 shadow-sm">
          <table className="min-w-full divide-y divide-[color:var(--brand-charcoal)]/10 text-sm">
            <thead className="bg-[color:var(--brand-sand)]/60 text-[color:var(--brand-charcoal)]/80">
              <tr>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Issuer</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Client ID</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Audience</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Déploiements</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wide">Statut</th>
                <th className="px-4 py-3 text-right font-semibold uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--brand-charcoal)]/10 bg-white/95">
              {platforms.map((platform) => (
                <tr key={`${platform.issuer}-${platform.clientId}`} className="transition hover:bg-[color:var(--brand-sand)]/40">
                  <td className="px-4 py-3 font-medium text-[color:var(--brand-black)]">{platform.issuer}</td>
                  <td className="px-4 py-3 text-[color:var(--brand-charcoal)]">{platform.clientId}</td>
                  <td className="px-4 py-3 text-[color:var(--brand-charcoal)]">
                    {platform.audience ? platform.audience : <span className="text-xs italic text-[color:var(--brand-charcoal)]/60">(non défini)</span>}
                  </td>
                  <td className="px-4 py-3 text-[color:var(--brand-charcoal)]">
                    {platform.deploymentIds.length > 0 ? platform.deploymentIds.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {platform.readOnly ? (
                      <span className="inline-flex items-center rounded-full bg-[color:var(--brand-charcoal)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80">
                        Lecture seule
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-green-700">
                        Éditable
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(platform)}
                        className="rounded-full border border-[color:var(--brand-charcoal)]/20 px-3 py-1 text-xs font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-red)]/40 hover:text-[color:var(--brand-red)]"
                      >
                        Détails
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleDelete(platform);
                        }}
                        className="rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        disabled={platform.readOnly}
                      >
                        Supprimer
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
        title={modalTitle}
        description={modalDescription}
        size="lg"
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
              form="admin-platform-form"
              disabled={saving || isReadOnly}
              className="rounded-full bg-[color:var(--brand-red)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-400"
            >
              {isReadOnly ? "Lecture seule" : saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        }
      >
        {formError ? (
          <p className="rounded-3xl bg-red-50 p-3 text-xs text-red-600">{formError}</p>
        ) : null}
        <form id="admin-platform-form" className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            Issuer
            <input
              type="url"
              value={formState.issuer}
              onChange={(event) => setFormState((prev) => ({ ...prev, issuer: event.target.value }))}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="https://lti.example"
              required
              disabled={isReadOnly}
            />
          </label>
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            Client ID
            <input
              type="text"
              value={formState.clientId}
              onChange={(event) => setFormState((prev) => ({ ...prev, clientId: event.target.value }))}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="Identifiant fourni"
              required
              disabled={isReadOnly}
            />
          </label>
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            URL d’autorisation
            <input
              type="url"
              value={formState.authorizationEndpoint}
              onChange={(event) => setFormState((prev) => ({ ...prev, authorizationEndpoint: event.target.value }))}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="https://platform.example/auth"
              disabled={isReadOnly}
            />
          </label>
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            Token endpoint
            <input
              type="url"
              value={formState.tokenEndpoint}
              onChange={(event) => setFormState((prev) => ({ ...prev, tokenEndpoint: event.target.value }))}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="https://platform.example/token"
              disabled={isReadOnly}
            />
          </label>
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            JWKS URI
            <input
              type="url"
              value={formState.jwksUri}
              onChange={(event) => setFormState((prev) => ({ ...prev, jwksUri: event.target.value }))}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="https://platform.example/jwks"
              disabled={isReadOnly}
            />
          </label>
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            Audience
            <input
              type="text"
              value={formState.audience}
              onChange={(event) => setFormState((prev) => ({ ...prev, audience: event.target.value }))}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="Audience optionnelle"
              disabled={isReadOnly}
            />
          </label>
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            Deployment ID principal
            <input
              type="text"
              value={formState.deploymentId}
              onChange={(event) => setFormState((prev) => ({ ...prev, deploymentId: event.target.value }))}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="ex: deployment-123"
              disabled={isReadOnly}
            />
          </label>
          <label className="sm:col-span-2 flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-[color:var(--brand-charcoal)]">
            Autres deployment IDs (un par ligne)
            <textarea
              value={formState.deploymentIds}
              onChange={(event) => setFormState((prev) => ({ ...prev, deploymentIds: event.target.value }))}
              rows={3}
              className="rounded-2xl border border-[color:var(--brand-charcoal)]/20 bg-white px-3 py-2 text-sm text-[color:var(--brand-black)] focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder={"deployment-456\ndeployment-789"}
              disabled={isReadOnly}
            />
          </label>
        </form>
        {isReadOnly ? (
          <p className="rounded-2xl bg-[color:var(--brand-sand)]/70 p-3 text-xs text-[color:var(--brand-charcoal)]">
            Cette plateforme est gérée automatiquement et ne peut pas être modifiée depuis l’interface.
          </p>
        ) : null}
      </AdminModal>
    </div>
  );
}
