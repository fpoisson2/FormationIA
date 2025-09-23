import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import type { ExplorateurIAModuleConfig, ExplorateurIAModuleProps } from "./registry";
import { registerExplorateurIAModule } from "./registry";

const combineClasses = (
  ...values: Array<string | false | null | undefined>
): string => values.filter(Boolean).join(" ");

export interface CreationSpec {
  action: string | null;
  media: string | null;
  style: string | null;
  theme: string | null;
}

export interface CreationPoolConfig {
  action: string[];
  media: string[];
  style: string[];
  theme: string[];
}

export interface CreationBuilderModuleConfig extends ExplorateurIAModuleConfig {
  type: "creation-builder";
  title?: string;
  instructions?: string;
  pools: CreationPoolConfig;
  submitLabel?: string;
}

const DEFAULT_POOL: CreationPoolConfig = {
  action: ["créer", "rédiger", "composer"],
  media: ["affiche", "article", "capsule audio"],
  style: ["cartoon", "académique", "minimaliste"],
  theme: ["énergie", "ville intelligente", "biodiversité"],
};

export const DEFAULT_CREATION_BUILDER_CONFIG: CreationBuilderModuleConfig = {
  type: "creation-builder",
  title: "Assemblez votre défi de création",
  instructions:
    "Choisissez un verbe d'action, un média, un style et un thème pour générer une consigne personnalisée.",
  pools: DEFAULT_POOL,
  submitLabel: "Valider ma consigne",
};

function sanitizePool(pool: Partial<CreationPoolConfig> | undefined): CreationPoolConfig {
  return {
    action: Array.isArray(pool?.action) && pool?.action.length
      ? pool.action.map((entry) => String(entry))
      : [...DEFAULT_POOL.action],
    media: Array.isArray(pool?.media) && pool?.media.length
      ? pool.media.map((entry) => String(entry))
      : [...DEFAULT_POOL.media],
    style: Array.isArray(pool?.style) && pool?.style.length
      ? pool.style.map((entry) => String(entry))
      : [...DEFAULT_POOL.style],
    theme: Array.isArray(pool?.theme) && pool?.theme.length
      ? pool.theme.map((entry) => String(entry))
      : [...DEFAULT_POOL.theme],
  };
}

function sanitizeCreationConfig(
  config: unknown
): CreationBuilderModuleConfig {
  if (!config || typeof config !== "object") {
    return { ...DEFAULT_CREATION_BUILDER_CONFIG };
  }
  const base = config as Partial<CreationBuilderModuleConfig>;
  return {
    type: "creation-builder",
    title:
      typeof base.title === "string"
        ? base.title
        : DEFAULT_CREATION_BUILDER_CONFIG.title,
    instructions:
      typeof base.instructions === "string"
        ? base.instructions
        : DEFAULT_CREATION_BUILDER_CONFIG.instructions,
    submitLabel:
      typeof base.submitLabel === "string"
        ? base.submitLabel
        : DEFAULT_CREATION_BUILDER_CONFIG.submitLabel,
    pools: sanitizePool(base.pools),
  };
}

function createInitialSpec(payload: unknown): CreationSpec {
  if (payload && typeof payload === "object") {
    const raw = payload as CreationSpec;
    return {
      action: typeof raw.action === "string" ? raw.action : null,
      media: typeof raw.media === "string" ? raw.media : null,
      style: typeof raw.style === "string" ? raw.style : null,
      theme: typeof raw.theme === "string" ? raw.theme : null,
    };
  }
  return { action: null, media: null, style: null, theme: null };
}

function CreationBuilderModule({
  config,
  payload,
  onAdvance,
  isEditMode,
  onUpdateConfig,
}: ExplorateurIAModuleProps) {
  const typedConfig = useMemo(() => sanitizeCreationConfig(config), [config]);
  const initialSpec = useMemo(() => createInitialSpec(payload), [payload]);
  const [spec, setSpec] = useState<CreationSpec>(initialSpec);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    setSpec(initialSpec);
  }, [initialSpec]);

  const ready = spec.action && spec.media && spec.style && spec.theme;

  const handleSetField = useCallback(
    (key: keyof CreationSpec, value: string | null) => {
      setSpec((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const handleDrop = useCallback(
    (key: keyof CreationSpec, value: string) => {
      handleSetField(key, value);
    },
    [handleSetField]
  );

  const handleValidate = useCallback(() => {
    if (!ready) {
      return;
    }
    onAdvance({ ...spec });
  }, [onAdvance, ready, spec]);

  const handleShuffle = useCallback(() => {
    const pools = typedConfig.pools;
    const pick = (items: string[]) =>
      items[Math.floor(Math.random() * items.length)] ?? null;
    setSpec({
      action: pick(pools.action),
      media: pick(pools.media),
      style: pick(pools.style),
      theme: pick(pools.theme),
    });
    setPreviewKey((value) => value + 1);
  }, [typedConfig.pools]);

  const handleResetSpec = useCallback(() => {
    setSpec({ action: null, media: null, style: null, theme: null });
  }, []);

  const handlePoolChange = useCallback(
    (field: keyof CreationPoolConfig, value: string) => {
      const entries = value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
      onUpdateConfig({
        ...typedConfig,
        pools: {
          ...typedConfig.pools,
          [field]: entries.length ? entries : typedConfig.pools[field],
        },
      });
    },
    [onUpdateConfig, typedConfig]
  );

  const handleInstructionsChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onUpdateConfig({ ...typedConfig, instructions: event.target.value });
    },
    [onUpdateConfig, typedConfig]
  );

  const handleTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onUpdateConfig({ ...typedConfig, title: event.target.value });
    },
    [onUpdateConfig, typedConfig]
  );

  const handleSubmitLabelChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onUpdateConfig({ ...typedConfig, submitLabel: event.target.value });
    },
    [onUpdateConfig, typedConfig]
  );

  if (isEditMode) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Titre</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              value={typedConfig.title ?? ""}
              onChange={handleTitleChange}
              placeholder="Titre pédagogique"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Texte du bouton</span>
            <input
              className="w-full rounded-md border border-slate-300 p-2"
              value={typedConfig.submitLabel ?? ""}
              onChange={handleSubmitLabelChange}
              placeholder="Valider ma consigne"
            />
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-700">Instructions</span>
          <textarea
            className="h-24 w-full rounded-md border border-slate-300 p-2"
            value={typedConfig.instructions ?? ""}
            onChange={handleInstructionsChange}
            placeholder="Décrivez les attentes de l'étape."
          />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          {(Object.keys(typedConfig.pools) as Array<keyof CreationPoolConfig>).map(
            (key) => (
              <label key={key} className="block space-y-1 text-sm">
                <span className="font-medium text-slate-700">
                  {key}
                </span>
                <textarea
                  className="h-32 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
                  value={typedConfig.pools[key].join("\n")}
                  onChange={(event) => handlePoolChange(key, event.target.value)}
                  placeholder="Une valeur par ligne"
                />
              </label>
            )
          )}
        </div>
      </div>
    );
  }

  const pools = typedConfig.pools;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
      <section className="space-y-4">
        {typedConfig.title ? (
          <h2 className="text-lg font-semibold text-slate-900">{typedConfig.title}</h2>
        ) : null}
        {typedConfig.instructions ? (
          <p className="text-sm text-slate-600">{typedConfig.instructions}</p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(pools) as Array<keyof CreationPoolConfig>).map((slot) => (
            <div key={slot} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {slot}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {pools[slot].map((item) => (
                  <DraggablePill
                    key={`${slot}-${item}`}
                    label={item}
                    onPick={() => handleSetField(slot, item)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DropSlot
            label="Action"
            value={spec.action ?? undefined}
            onSelect={(value) => handleDrop("action", value)}
            onClear={() => handleSetField("action", null)}
          />
          <DropSlot
            label="Média"
            value={spec.media ?? undefined}
            onSelect={(value) => handleDrop("media", value)}
            onClear={() => handleSetField("media", null)}
          />
          <DropSlot
            label="Style"
            value={spec.style ?? undefined}
            onSelect={(value) => handleDrop("style", value)}
            onClear={() => handleSetField("style", null)}
          />
          <DropSlot
            label="Thème"
            value={spec.theme ?? undefined}
            onSelect={(value) => handleDrop("theme", value)}
            onClear={() => handleSetField("theme", null)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleShuffle}
            className="rounded-full border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Mélanger
          </button>
          <button
            type="button"
            onClick={handleResetSpec}
            className="rounded-full border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Réinitialiser
          </button>
        </div>
      </section>
      <aside className="space-y-4">
        <CreationPreview spec={spec} key={previewKey} />
        <button
          type="button"
          onClick={handleValidate}
          disabled={!ready}
          className={combineClasses(
            "w-full rounded-xl px-4 py-2 text-sm font-semibold text-white transition",
            ready
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-emerald-400/60 cursor-not-allowed"
          )}
        >
          {typedConfig.submitLabel ?? "Valider"}
        </button>
      </aside>
    </div>
  );
}

function DraggablePill({
  label,
  onPick,
}: {
  label: string;
  onPick: () => void;
}) {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData("text/plain", label);
  };
  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      onClick={onPick}
      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm hover:bg-emerald-50"
    >
      {label}
    </button>
  );
}

function DropSlot({
  label,
  value,
  onSelect,
  onClear,
}: {
  label: string;
  value?: string;
  onSelect: (value: string) => void;
  onClear: () => void;
}) {
  const [isOver, setIsOver] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsOver(false);
    const dropped = event.dataTransfer.getData("text/plain");
    if (dropped) {
      onSelect(dropped);
    }
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      className={combineClasses(
        "min-h-[72px] rounded-2xl border border-dashed border-slate-300 bg-white p-4",
        isOver && "border-emerald-400 bg-emerald-50"
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      {value ? (
        <div className="mt-2 flex items-center justify-between">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
            {value}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-sm text-slate-500 hover:text-slate-700"
            aria-label={`Retirer ${value}`}
          >
            ✕
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">Glissez un élément ici.</p>
      )}
    </div>
  );
}

function CreationPreview({ spec }: { spec: CreationSpec }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Prévisualisation
      </div>
      <div className="mt-3 space-y-2 text-sm text-slate-700">
        <p>
          {spec.action ? (
            <strong>{spec.action}</strong>
          ) : (
            <span className="text-slate-400">[action]</span>
          )}{" "}
          {spec.media ? spec.media : <span className="text-slate-400">[média]</span>}
          , dans un style {" "}
          {spec.style ? spec.style : <span className="text-slate-400">[style]</span>}
          {" "} sur le thème {" "}
          {spec.theme ? spec.theme : <span className="text-slate-400">[thème]</span>}.
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          Ajustez chaque paramètre pour personnaliser la consigne à votre contexte.
        </div>
      </div>
    </div>
  );
}

registerExplorateurIAModule("creation-builder", CreationBuilderModule);
