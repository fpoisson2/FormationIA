import {
  ChangeEvent,
  useCallback,
  useContext,
  useMemo,
} from "react";

import InfoCard from "../../../components/InfoCard";
import type { StepComponentProps } from "../types";
import { StepSequenceContext } from "../types";

export type InfoCardTone = "red" | "black" | "sand" | "white";

export interface InfoCardsStepCardConfig {
  title: string;
  description: string;
  tone?: InfoCardTone;
  items?: string[];
}

export interface InfoCardsStepConfig {
  eyebrow?: string;
  title?: string;
  description?: string;
  columns?: number;
  cards?: InfoCardsStepCardConfig[];
}

const normalizeTone = (tone: unknown): InfoCardTone | undefined => {
  if (tone === "red" || tone === "black" || tone === "sand" || tone === "white") {
    return tone;
  }
  return undefined;
};

const normalizeCard = (
  card: InfoCardsStepCardConfig | undefined
): InfoCardsStepCardConfig | null => {
  if (!card || typeof card !== "object") {
    return null;
  }
  const { title, description, tone, items } = card as InfoCardsStepCardConfig;
  if (typeof title !== "string" || typeof description !== "string") {
    return null;
  }
  const normalizedItems = Array.isArray(items)
    ? items
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : undefined;
  return {
    title: title.trim(),
    description: description.trim(),
    tone: normalizeTone(tone) ?? "sand",
    ...(normalizedItems && normalizedItems.length > 0
      ? { items: normalizedItems }
      : {}),
  };
};

const normalizeConfig = (config: unknown): Required<Omit<InfoCardsStepConfig, "cards">> & {
  cards: InfoCardsStepCardConfig[];
} => {
  if (!config || typeof config !== "object") {
    return {
      eyebrow: "",
      title: "",
      description: "",
      columns: 3,
      cards: [],
    };
  }
  const base = config as InfoCardsStepConfig;
  const safeColumns =
    typeof base.columns === "number" && base.columns >= 1 && base.columns <= 4
      ? Math.floor(base.columns)
      : undefined;
  const normalizedCards = (base.cards ?? [])
    .map((card) => normalizeCard(card))
    .filter((card): card is InfoCardsStepCardConfig => Boolean(card));
  return {
    eyebrow: typeof base.eyebrow === "string" ? base.eyebrow : "",
    title: typeof base.title === "string" ? base.title : "",
    description: typeof base.description === "string" ? base.description : "",
    columns: safeColumns ?? Math.min(Math.max(normalizedCards.length, 1), 3),
    cards: normalizedCards,
  };
};

const columnClassNames: Record<number, string> = {
  1: "grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

const createEmptyCard = (): InfoCardsStepCardConfig => ({
  title: "",
  description: "",
  tone: "sand",
  items: [],
});

const clampCardCount = (count: number): number => {
  if (Number.isNaN(count)) {
    return 1;
  }
  return Math.min(Math.max(Math.floor(count), 1), 6);
};

const clampColumns = (columns: number): number => {
  if (Number.isNaN(columns)) {
    return 1;
  }
  return Math.min(Math.max(Math.floor(columns), 1), 4);
};

export function InfoCardsStep({
  config,
  isEditMode,
  onUpdateConfig,
}: StepComponentProps): JSX.Element {
  const context = useContext(StepSequenceContext);
  const isDesignerMode = context?.isEditMode ?? isEditMode;
  const effectiveOnUpdateConfig = context?.onUpdateConfig ?? onUpdateConfig;

  const { eyebrow, title, description, cards, columns } = useMemo(
    () => normalizeConfig(config),
    [config]
  );

  const columnClass = columnClassNames[columns] ?? columnClassNames[3];
  const hasContent = cards.length > 0;

  const commitConfig = useCallback(
    (nextConfig: {
      eyebrow: string;
      title: string;
      description: string;
      columns: number;
      cards: InfoCardsStepCardConfig[];
    }) => {
      const sanitizedCards = nextConfig.cards.map((card) => {
        const normalizedItems = card.items
          ?.map((item) => (typeof item === "string" ? item : ""))
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        return {
          title: card.title,
          description: card.description,
          tone: normalizeTone(card.tone) ?? "sand",
          ...(normalizedItems && normalizedItems.length > 0
            ? { items: normalizedItems }
            : {}),
        } satisfies InfoCardsStepCardConfig;
      });

      effectiveOnUpdateConfig({
        eyebrow: nextConfig.eyebrow,
        title: nextConfig.title,
        description: nextConfig.description,
        columns: clampColumns(nextConfig.columns),
        cards: sanitizedCards,
      });
    },
    [effectiveOnUpdateConfig]
  );

  const handleFieldChange = useCallback(
    (field: "eyebrow" | "title" | "description") =>
      (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        commitConfig({
          eyebrow,
          title,
          description,
          columns,
          cards,
          [field]: event.target.value,
        });
      },
    [commitConfig, eyebrow, title, description, columns, cards]
  );

  const handleColumnsChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      commitConfig({
        eyebrow,
        title,
        description,
        columns: clampColumns(Number(event.target.value)),
        cards,
      });
    },
    [commitConfig, eyebrow, title, description, cards]
  );

  const handleCardCountChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const desiredCount = clampCardCount(Number(event.target.value));
      const nextCards = cards.map((card) => ({ ...card }));
      if (desiredCount > nextCards.length) {
        while (nextCards.length < desiredCount) {
          nextCards.push(createEmptyCard());
        }
      } else if (desiredCount < nextCards.length) {
        nextCards.length = desiredCount;
      }
      commitConfig({
        eyebrow,
        title,
        description,
        columns,
        cards: nextCards,
      });
    },
    [cards, columns, commitConfig, description, eyebrow, title]
  );

  const handleCardFieldChange = useCallback(
    (
      index: number,
      field: keyof Pick<InfoCardsStepCardConfig, "title" | "description">
    ) =>
      (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const nextCards = cards.map((card, cardIndex) =>
          cardIndex === index ? { ...card, [field]: event.target.value } : card
        );
        commitConfig({
          eyebrow,
          title,
          description,
          columns,
          cards: nextCards,
        });
      },
    [cards, columns, commitConfig, description, eyebrow, title]
  );

  const handleCardToneChange = useCallback(
    (index: number) => (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as InfoCardTone;
      const nextCards = cards.map((card, cardIndex) =>
        cardIndex === index ? { ...card, tone: value } : card
      );
      commitConfig({
        eyebrow,
        title,
        description,
        columns,
        cards: nextCards,
      });
    },
    [cards, columns, commitConfig, description, eyebrow, title]
  );

  const handleCardItemsChange = useCallback(
    (index: number) => (event: ChangeEvent<HTMLTextAreaElement>) => {
      const rawItems = event.target.value.split("\n");
      const nextCards = cards.map((card, cardIndex) =>
        cardIndex === index ? { ...card, items: rawItems } : card
      );
      commitConfig({
        eyebrow,
        title,
        description,
        columns,
        cards: nextCards,
      });
    },
    [cards, columns, commitConfig, description, eyebrow, title]
  );

  return (
    <section className="space-y-6">
      {isDesignerMode && (
        <div className="space-y-6 rounded-3xl border border-dashed border-[color:var(--brand-charcoal)]/20 bg-white/80 p-6">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-[color:var(--brand-charcoal)]">
                <span>Surtitre</span>
                <input
                  className="w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                  value={eyebrow}
                  onChange={handleFieldChange("eyebrow")}
                  placeholder="Surtitre affiché au-dessus du titre"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-[color:var(--brand-charcoal)]">
                <span>Titre</span>
                <input
                  className="w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                  value={title}
                  onChange={handleFieldChange("title")}
                  placeholder="Titre principal du bloc"
                />
              </label>
            </div>
            <label className="block space-y-2 text-sm font-medium text-[color:var(--brand-charcoal)]">
              <span>Description</span>
              <textarea
                className="h-28 w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                value={description}
                onChange={handleFieldChange("description")}
                placeholder="Texte introductif du bloc"
              />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-[color:var(--brand-charcoal)]">
                <span>Nombre de cartes</span>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={cards.length || 1}
                  onChange={handleCardCountChange}
                  className="w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-[color:var(--brand-charcoal)]">
                <span>Nombre de colonnes</span>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={columns}
                  onChange={handleColumnsChange}
                  className="w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                />
              </label>
            </div>
          </div>

          <div className="space-y-4">
            {cards.length === 0 && (
              <p className="text-sm text-[color:var(--brand-charcoal)]">
                Ajoutez au moins une carte pour configurer le contenu du bloc.
              </p>
            )}
            {cards.map((card, index) => {
              const itemsValue = (card.items ?? []).join("\n");
              return (
                <div
                  key={`${card.title || "card"}-${index}`}
                  className="space-y-4 rounded-2xl border border-[color:var(--brand-charcoal)]/15 bg-white/90 p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--brand-black)]">
                      Carte {index + 1}
                    </h3>
                    <span className="text-xs uppercase text-[color:var(--brand-charcoal)]/80">
                      Ton : {card.tone ?? "sand"}
                    </span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2 text-sm font-medium text-[color:var(--brand-charcoal)]">
                      <span>Titre</span>
                      <input
                        className="w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                        value={card.title}
                        onChange={handleCardFieldChange(index, "title")}
                        placeholder="Titre de la carte"
                      />
                    </label>
                    <label className="space-y-2 text-sm font-medium text-[color:var(--brand-charcoal)]">
                      <span>Tonalité</span>
                      <select
                        className="w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                        value={card.tone ?? "sand"}
                        onChange={handleCardToneChange(index)}
                      >
                        <option value="sand">Sable</option>
                        <option value="white">Blanc</option>
                        <option value="black">Noir</option>
                        <option value="red">Rouge</option>
                      </select>
                    </label>
                  </div>
                  <label className="block space-y-2 text-sm font-medium text-[color:var(--brand-charcoal)]">
                    <span>Description</span>
                    <textarea
                      className="h-24 w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                      value={card.description}
                      onChange={handleCardFieldChange(index, "description")}
                      placeholder="Texte principal de la carte"
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium text-[color:var(--brand-charcoal)]">
                    <span>Liste d'éléments (un par ligne)</span>
                    <textarea
                      className="h-24 w-full rounded-xl border border-[color:var(--brand-charcoal)]/20 bg-white/90 p-3 text-sm text-[color:var(--brand-black)] shadow-sm focus:border-[color:var(--brand-red)] focus:outline-none"
                      value={itemsValue}
                      onChange={handleCardItemsChange(index)}
                      placeholder={"Élément 1\nÉlément 2"}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(eyebrow || title || description) && (
        <div className="space-y-2">
          {eyebrow && (
            <span className="brand-chip bg-[color:var(--brand-black)]/90 text-white/90">
              {eyebrow}
            </span>
          )}
          {title && (
            <h2 className="text-2xl font-semibold leading-snug text-[color:var(--brand-black)]">
              {title}
            </h2>
          )}
          {description && (
            <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              {description}
            </p>
          )}
        </div>
      )}

      {hasContent ? (
        <div className={`grid grid-cols-1 gap-4 animate-section ${columnClass}`}>
          {cards.map((card, index) => (
            <InfoCard
              key={`${card.title}-${index}`}
              tone={card.tone}
              title={card.title}
              description={card.description}
              items={card.items}
            />
          ))}
        </div>
      ) : (
        isDesignerMode && (
          <div className="rounded-3xl border border-dashed border-[color:var(--brand-charcoal)]/20 bg-white/60 p-6 text-sm text-[color:var(--brand-charcoal)]">
            Ajoutez des cartes d'information via la configuration pour afficher ce bloc.
          </div>
        )
      )}
    </section>
  );
}

InfoCardsStep.stepSequenceWrapper = "default";
