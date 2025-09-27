import { useCallback, useEffect, useMemo, useState } from "react";

import type { StepSequenceModuleMetadata } from "../../modules/step-sequence";
import {
  mergeModuleMetadata,
  type StepSequenceModuleLibraryEntry,
} from "../../modules/step-sequence/moduleLibrary";
import { AdminModal } from "./AdminModal";

interface StepSequenceModuleLibraryModalProps {
  open: boolean;
  entries: StepSequenceModuleLibraryEntry[];
  onClose: () => void;
  onImport: (component: string, metadata: StepSequenceModuleMetadata) => void;
}

type ModuleDraft = {
  coverImage: string;
  description: string;
};

type ModuleDraftMap = Record<string, ModuleDraft>;

function createDrafts(
  entries: StepSequenceModuleLibraryEntry[]
): ModuleDraftMap {
  const drafts: ModuleDraftMap = {};
  for (const entry of entries) {
    drafts[entry.key] = {
      coverImage: entry.metadata.coverImage ?? entry.coverImage,
      description: entry.metadata.description ?? entry.description,
    };
  }
  return drafts;
}

export function StepSequenceModuleLibraryModal({
  open,
  entries,
  onClose,
  onImport,
}: StepSequenceModuleLibraryModalProps): JSX.Element | null {
  const [searchTerm, setSearchTerm] = useState("");
  const [drafts, setDrafts] = useState<ModuleDraftMap>(() => createDrafts(entries));

  useEffect(() => {
    if (open) {
      setDrafts(createDrafts(entries));
      setSearchTerm("");
    }
  }, [entries, open]);

  const filteredEntries = useMemo(() => {
    if (!searchTerm.trim()) {
      return entries;
    }
    const query = searchTerm.toLowerCase();
    return entries.filter((entry) => {
      return (
        entry.title.toLowerCase().includes(query) ||
        entry.description.toLowerCase().includes(query) ||
        entry.key.toLowerCase().includes(query)
      );
    });
  }, [entries, searchTerm]);

  const handleDraftChange = useCallback(
    (key: string, field: keyof ModuleDraft, value: string) => {
      setDrafts((previous) => ({
        ...previous,
        [key]: {
          ...previous[key],
          [field]: value,
        },
      }));
    },
    []
  );

  const handleImport = useCallback(
    (entry: StepSequenceModuleLibraryEntry) => {
      const draft = drafts[entry.key] ?? {
        coverImage: entry.metadata.coverImage ?? entry.coverImage,
        description: entry.metadata.description ?? entry.description,
      };
      const metadata = mergeModuleMetadata(entry.metadata, {
        coverImage: draft.coverImage.trim() || null,
        description: draft.description.trim() || null,
      });
      onImport(entry.key, metadata);
      onClose();
    },
    [drafts, onClose, onImport]
  );

  if (!open) {
    return null;
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      title="Bibliothèque des modules StepSequence"
      description="Parcours les modules disponibles, personnalise l'illustration et la description avant d'importer l'étape dans ta séquence."
      size="lg"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center rounded-full border border-[color:var(--brand-charcoal)]/20 px-4 py-2 text-sm font-medium text-[color:var(--brand-charcoal)] transition hover:border-[color:var(--brand-charcoal)]/40 hover:text-[color:var(--brand-black)]"
        >
          Fermer la bibliothèque
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]">
          Recherche
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Filtrer par nom de module ou mot-clé"
            className="mt-1 w-full rounded-xl border border-[color:var(--brand-charcoal)]/15 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
          />
        </label>
        {filteredEntries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[color:var(--brand-charcoal)]/20 bg-white/60 p-4 text-sm text-[color:var(--brand-charcoal)]">
            Aucun module ne correspond à ta recherche. Essaye d'autres mots-clés ou efface le filtre.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredEntries.map((entry) => {
              const draft = drafts[entry.key] ?? {
                coverImage: entry.metadata.coverImage ?? entry.coverImage,
                description: entry.metadata.description ?? entry.description,
              };
              return (
                <article
                  key={entry.key}
                  className="flex h-full flex-col overflow-hidden rounded-3xl border border-[color:var(--brand-charcoal)]/10 bg-white/80 shadow-sm"
                >
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-[color:var(--brand-charcoal)]/5">
                    <img
                      src={draft.coverImage || entry.coverImage}
                      onError={(event) => {
                        event.currentTarget.src = entry.coverImage;
                      }}
                      alt={`Illustration du module ${entry.title}`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-4 p-4">
                    <header className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                        Module {entry.key}
                      </p>
                      <h3 className="text-base font-semibold text-[color:var(--brand-black)]">
                        {entry.title}
                      </h3>
                    </header>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-[color:var(--brand-charcoal)]">
                      URL de l'image
                      <input
                        type="url"
                        value={draft.coverImage}
                        onChange={(event) =>
                          handleDraftChange(entry.key, "coverImage", event.target.value)
                        }
                        placeholder="https://..."
                        className="rounded-lg border border-[color:var(--brand-charcoal)]/20 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-[color:var(--brand-charcoal)]">
                      Description du module
                      <textarea
                        value={draft.description}
                        onChange={(event) =>
                          handleDraftChange(entry.key, "description", event.target.value)
                        }
                        rows={4}
                        className="flex-1 resize-none rounded-lg border border-[color:var(--brand-charcoal)]/20 px-3 py-2 text-sm text-[color:var(--brand-charcoal)] focus:border-orange-400 focus:outline-none"
                      />
                    </label>
                    <div className="mt-auto flex items-center justify-between text-xs text-[color:var(--brand-charcoal)]/70">
                      <span>Prêt à être importé dans la séquence.</span>
                      <button
                        type="button"
                        onClick={() => handleImport(entry)}
                        className="inline-flex items-center justify-center rounded-full border border-orange-300 bg-orange-500 px-4 py-2 text-xs font-semibold text-white transition hover:border-orange-400 hover:bg-orange-600"
                      >
                        Importer ce module
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AdminModal>
  );
}
