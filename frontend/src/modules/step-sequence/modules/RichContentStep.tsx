import { ChangeEvent, useCallback, useContext, useMemo } from "react";

import type { StepComponentProps, StepComponentWithMetadata } from "../types";
import { StepSequenceContext } from "../types";

export interface RichContentMediaItem {
  id: string;
  url: string;
  alt?: string;
  caption?: string;
}

export interface RichContentTipsSidebar {
  type: "tips";
  title?: string;
  tips: string[];
}

export interface RichContentChecklistItem {
  id: string;
  label: string;
  checked?: boolean;
}

export interface RichContentChecklistSidebar {
  type: "checklist";
  title?: string;
  items: RichContentChecklistItem[];
}

export type RichContentSidebar =
  | RichContentTipsSidebar
  | RichContentChecklistSidebar;

export interface RichContentStepContent {
  title?: string;
  body?: string;
  media?: RichContentMediaItem[];
  sidebar?: RichContentSidebar;
}

export interface RichContentStepConfig extends RichContentStepContent {
  onChange?: (content: RichContentStepContent) => void;
}

const EMPTY_CONTENT: RichContentStepContent = {
  title: "",
  body: "",
  media: [],
  sidebar: undefined,
};

function getMediaId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function getChecklistItemId(): string {
  return `item-${getMediaId()}`;
}

export function RichContentStep({
  config,
  onUpdateConfig,
}: StepComponentProps): JSX.Element {
  const context = useContext(StepSequenceContext);
  const isEditModeFromContext = context?.isEditMode ?? false;
  const effectiveOnUpdateConfig = context?.onUpdateConfig ?? onUpdateConfig;

  const typedConfig = useMemo<RichContentStepConfig>(() => {
    if (!config || typeof config !== "object") {
      return { ...EMPTY_CONTENT, media: [] };
    }
    const base = config as RichContentStepConfig;
    const sidebar = base.sidebar
      ? base.sidebar.type === "tips"
        ? {
            type: "tips" as const,
            title: base.sidebar.title ?? "",
            tips: [...(base.sidebar.tips ?? [])],
          }
        : {
            type: "checklist" as const,
            title: base.sidebar.title ?? "",
            items: (base.sidebar.items ?? []).map((item) => ({ ...item })),
          }
      : undefined;
    return {
      title: base.title ?? "",
      body: base.body ?? "",
      media: base.media?.map((item) => ({ ...item })) ?? [],
      sidebar,
      onChange: base.onChange,
    };
  }, [config]);

  const { onChange, ...content } = typedConfig;
  const safeMedia = content.media ?? [];

  const notifyChange = useCallback(
    (nextContent: RichContentStepContent) => {
      onChange?.(nextContent);
      effectiveOnUpdateConfig({ ...nextContent, onChange });
    },
    [effectiveOnUpdateConfig, onChange]
  );

  const handleBasicFieldChange = useCallback(
    (field: keyof Pick<RichContentStepContent, "title" | "body">) =>
      (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        notifyChange({ ...content, [field]: event.target.value });
      },
    [content, notifyChange]
  );

  const handleMediaChange = useCallback(
    (
      index: number,
      patch: Partial<Omit<RichContentMediaItem, "id">> | null
    ) => {
      const nextMedia = [...safeMedia];
      if (patch === null) {
        nextMedia.splice(index, 1);
      } else {
        nextMedia[index] = {
          ...nextMedia[index],
          ...patch,
        } as RichContentMediaItem;
      }
      notifyChange({ ...content, media: nextMedia });
    },
    [content, notifyChange, safeMedia]
  );

  const handleAddMediaFromUrl = useCallback(() => {
    notifyChange({
      ...content,
      media: [
        ...safeMedia,
        {
          id: getMediaId(),
          url: "",
        },
      ],
    });
  }, [content, notifyChange, safeMedia]);

  const handleMediaUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const objectUrl =
        typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(file)
          : "";
      notifyChange({
        ...content,
        media: [
          ...safeMedia,
          {
            id: getMediaId(),
            url: objectUrl || file.name,
            alt: file.name,
          },
        ],
      });
      event.target.value = "";
    },
    [content, notifyChange, safeMedia]
  );

  const handleSidebarTypeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as "none" | "tips" | "checklist";
      if (value === "none") {
        notifyChange({ ...content, sidebar: undefined });
        return;
      }
      if (value === "tips") {
        notifyChange({
          ...content,
          sidebar: {
            type: "tips",
            title: "",
            tips: [""],
          },
        });
        return;
      }
      notifyChange({
        ...content,
        sidebar: {
          type: "checklist",
          title: "",
          items: [
            {
              id: getChecklistItemId(),
              label: "",
              checked: false,
            },
          ],
        },
      });
    },
    [content, notifyChange]
  );

  const handleSidebarTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!content.sidebar) return;
      notifyChange({
        ...content,
        sidebar: {
          ...content.sidebar,
          title: event.target.value,
        } as RichContentSidebar,
      });
    },
    [content, notifyChange]
  );

  const handleSidebarCollectionChange = useCallback(
    (index: number, value: string, field: "tips" | "items") => {
      if (!content.sidebar) return;
      if (content.sidebar.type === "tips" && field === "tips") {
        const tips = [...content.sidebar.tips];
        tips[index] = value;
        notifyChange({
          ...content,
          sidebar: { ...content.sidebar, tips },
        });
        return;
      }
      if (content.sidebar.type === "checklist" && field === "items") {
        const items = content.sidebar.items.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                label: value,
              }
            : item
        );
        notifyChange({
          ...content,
          sidebar: { ...content.sidebar, items },
        });
      }
    },
    [content, notifyChange]
  );

  const handleToggleChecklistItem = useCallback(
    (index: number) => {
      if (!content.sidebar || content.sidebar.type !== "checklist") return;
      const items = content.sidebar.items.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, checked: !item.checked }
          : item
      );
      notifyChange({
        ...content,
        sidebar: { ...content.sidebar, items },
      });
    },
    [content, notifyChange]
  );

  const handleAddSidebarEntry = useCallback(() => {
    if (!content.sidebar) return;
    if (content.sidebar.type === "tips") {
      notifyChange({
        ...content,
        sidebar: {
          ...content.sidebar,
          tips: [...content.sidebar.tips, ""],
        },
      });
      return;
    }
    notifyChange({
      ...content,
      sidebar: {
        ...content.sidebar,
        items: [
          ...content.sidebar.items,
          { id: getChecklistItemId(), label: "", checked: false },
        ],
      },
    });
  }, [content, notifyChange]);

  const handleRemoveSidebarEntry = useCallback(
    (index: number) => {
      if (!content.sidebar) return;
      if (content.sidebar.type === "tips") {
        const tips = content.sidebar.tips.filter((_, tipIndex) => tipIndex !== index);
        notifyChange({
          ...content,
          sidebar: { ...content.sidebar, tips },
        });
        return;
      }
      const items = content.sidebar.items.filter(
        (_, itemIndex) => itemIndex !== index
      );
      notifyChange({
        ...content,
        sidebar: { ...content.sidebar, items },
      });
    },
    [content, notifyChange]
  );

  const renderSidebar = () => {
    if (!content.sidebar) return null;
    if (content.sidebar.type === "tips") {
      return (
        <aside className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
          {content.sidebar.title ? (
            <h3 className="mb-2 font-semibold text-slate-700">
              {content.sidebar.title}
            </h3>
          ) : null}
          <ul className="list-disc space-y-1 pl-4 text-slate-600">
            {content.sidebar.tips.map((tip, index) => (
              <li key={index}>{tip}</li>
            ))}
          </ul>
        </aside>
      );
    }
    return (
      <aside className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
        {content.sidebar.title ? (
          <h3 className="mb-2 font-semibold text-slate-700">
            {content.sidebar.title}
          </h3>
        ) : null}
        <ul className="space-y-2">
          {content.sidebar.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-slate-600">
              <span
                aria-hidden
                className={`h-3 w-3 rounded-full border ${
                  item.checked
                    ? "border-green-500 bg-green-500"
                    : "border-slate-300"
                }`}
              />
              <span className={item.checked ? "line-through" : undefined}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    );
  };

  if (!isEditModeFromContext) {
    return (
      <div className="flex flex-col gap-6 md:flex-row">
        <article className="flex-1 space-y-6">
          {content.title ? (
            <h2 className="text-2xl font-semibold text-slate-900">
              {content.title}
            </h2>
          ) : null}
          {content.body ? (
            <p className="whitespace-pre-line text-base text-slate-700">
              {content.body}
            </p>
          ) : null}
          {safeMedia.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {safeMedia.map((item) => (
                <figure
                  key={item.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  {item.url ? (
                    <img
                      alt={item.alt ?? item.caption ?? "Illustration"}
                      src={item.url}
                      className="w-full rounded-md object-cover"
                    />
                  ) : null}
                  {item.caption || item.alt ? (
                    <figcaption className="mt-2 text-sm text-slate-600">
                      {item.caption ?? item.alt}
                    </figcaption>
                  ) : null}
                </figure>
              ))}
            </div>
          ) : null}
        </article>
        {renderSidebar()}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-[2fr,1fr]">
        <section className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Titre</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              value={content.title ?? ""}
              onChange={handleBasicFieldChange("title")}
              placeholder="Titre de l'étape"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Contenu</span>
            <textarea
              className="h-40 w-full rounded-md border border-slate-300 p-2"
              value={content.body ?? ""}
              onChange={handleBasicFieldChange("body")}
              placeholder="Description détaillée"
            />
          </label>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Médias</p>
            <div className="space-y-4">
              {safeMedia.map((item, index) => (
                <div
                  key={item.id}
                  className="rounded-md border border-slate-200 p-4 shadow-sm"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-600">
                        URL de l'image
                      </span>
                      <input
                        className="w-full rounded-md border border-slate-300 p-2"
                        value={item.url}
                        onChange={(event) =>
                          handleMediaChange(index, { url: event.target.value })
                        }
                        placeholder="https://..."
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-600">
                        Texte alternatif
                      </span>
                      <input
                        className="w-full rounded-md border border-slate-300 p-2"
                        value={item.alt ?? ""}
                        onChange={(event) =>
                          handleMediaChange(index, { alt: event.target.value })
                        }
                        placeholder="Description"
                      />
                    </label>
                  </div>
                  <label className="mt-3 block space-y-1">
                    <span className="text-xs font-medium text-slate-600">
                      Légende (optionnelle)
                    </span>
                    <input
                      className="w-full rounded-md border border-slate-300 p-2"
                      value={item.caption ?? ""}
                      onChange={(event) =>
                        handleMediaChange(index, { caption: event.target.value })
                      }
                      placeholder="Ajouter une légende"
                    />
                  </label>
                  <button
                    type="button"
                    className="mt-3 text-sm text-red-600"
                    onClick={() => handleMediaChange(index, null)}
                  >
                    Supprimer ce média
                  </button>
                </div>
              ))}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm"
                  onClick={handleAddMediaFromUrl}
                >
                  Ajouter un média par URL
                </button>
                <label className="text-sm text-slate-600">
                  <span className="mr-2">ou importer un fichier</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleMediaUpload}
                  />
                </label>
              </div>
            </div>
          </div>
        </section>
        <section className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">
              Type de sidebar
            </span>
            <select
              className="w-full rounded-md border border-slate-300 p-2"
              value={content.sidebar?.type ?? "none"}
              onChange={handleSidebarTypeChange}
            >
              <option value="none">Aucune</option>
              <option value="tips">Astuces</option>
              <option value="checklist">Checklist</option>
            </select>
          </label>
          {content.sidebar ? (
            <div className="space-y-4 rounded-md border border-slate-200 p-4 shadow-sm">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">
                  Titre de la sidebar
                </span>
                <input
                  className="w-full rounded-md border border-slate-300 p-2"
                  value={content.sidebar.title ?? ""}
                  onChange={handleSidebarTitleChange}
                  placeholder="Titre optionnel"
                />
              </label>
              <div className="space-y-3">
                {content.sidebar.type === "tips"
                  ? content.sidebar.tips.map((tip, index) => (
                      <div key={index} className="space-y-1">
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-slate-600">
                            Astuce {index + 1}
                          </span>
                          <input
                            className="w-full rounded-md border border-slate-300 p-2"
                            value={tip}
                            onChange={(event) =>
                              handleSidebarCollectionChange(
                                index,
                                event.target.value,
                                "tips"
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="text-xs text-red-600"
                          onClick={() => handleRemoveSidebarEntry(index)}
                        >
                          Supprimer
                        </button>
                      </div>
                    ))
                  : content.sidebar.items.map((item, index) => (
                      <div
                        key={item.id}
                        className="rounded-md border border-slate-200 p-3"
                      >
                        <label className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={item.checked ?? false}
                            onChange={() => handleToggleChecklistItem(index)}
                          />
                          <span>Élément validé</span>
                        </label>
                        <input
                          className="w-full rounded-md border border-slate-300 p-2 text-sm"
                          value={item.label}
                          onChange={(event) =>
                            handleSidebarCollectionChange(
                              index,
                              event.target.value,
                              "items"
                            )
                          }
                          placeholder={`Tâche ${index + 1}`}
                        />
                        <button
                          type="button"
                          className="mt-2 text-xs text-red-600"
                          onClick={() => handleRemoveSidebarEntry(index)}
                        >
                          Supprimer
                        </button>
                      </div>
                    ))}
              </div>
              <button
                type="button"
                className="text-sm text-blue-600"
                onClick={handleAddSidebarEntry}
              >
                Ajouter un élément
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

(RichContentStep as StepComponentWithMetadata).stepSequenceHideTitleInHeader = true;
