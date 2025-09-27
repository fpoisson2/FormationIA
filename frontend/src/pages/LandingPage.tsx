import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";
import {
  admin,
  landingPage as landingPageClient,
  type LandingPageContent,
  type LandingPageLink,
} from "../api";
import { useLTI } from "../hooks/useLTI";
import { useAdminAuth } from "../providers/AdminAuthProvider";

const ADMIN_ROLES = ["admin", "superadmin", "administrator"] as const;
const USER_ROLES = [
  "usager",
  "user",
  "participant",
  "learner",
  "etudiant",
  "étudiant",
] as const;
const ADMIN_ROLE_SET = new Set(ADMIN_ROLES);
const ACTIVITY_ROLE_SET = new Set<string>([
  ...ADMIN_ROLES,
  ...USER_ROLES,
]);

const DEFAULT_LANDING_PAGE_CONTENT: LandingPageContent = {
  brandTagline: "Studio pédagogique IA",
  navActivitiesLabel: "Studio d'activités",
  navIntegrationsLabel: "Intégrations",
  navLoginLabel: "Se connecter",
  heroEyebrow: "Créateur d'activités",
  heroTitle: "Concevez des activités pédagogiques autoportantes alimentées par l'IA.",
  heroDescription:
    "Ce studio devient votre espace de conception : décrivez vos objectifs, laissez l'IA générer le parcours, publiez-le en Deep Link dans votre LMS et suivez l'engagement sans friction.",
  heroPrimaryCtaLabel: "Accéder au studio",
  heroSecondaryCtaLabel: "Déployer via LTI Deep Link",
  heroHighlights: [
    {
      title: "Génération assistée",
      description:
        "Construisez une activité complète en quelques minutes : structure, consignes et rétroactions sont proposés automatiquement.",
    },
    {
      title: "Diffusion autoportante",
      description:
        "Chaque activité inclut les supports nécessaires pour être utilisée en autonomie ou intégrée à distance dans vos cours.",
    },
  ],
  heroBadgeLabel: "Nouveauté",
  heroBadgeTitle: "Génération IA + Deep Linking LTI",
  heroBadgeDescription:
    "Composez et distribuez vos activités autoportantes dans votre LMS en un clic.",
  heroIdealForTitle: "Pensé pour",
  heroIdealForItems: [
    "Concepteurs pédagogiques et conseillers TIC",
    "Responsables de formation continue",
    "Équipes numériques des établissements",
  ],
  experiencesEyebrow: "Canevas intelligents",
  experiencesTitle:
    "Des modèles autoportants qui transforment une intention en parcours complet.",
  experiencesDescription:
    "Chaque activité générée fournit un storyboard, des consignes adaptées et des livrables exportables, sans dépendre d'un accompagnement manuel.",
  experiencesCards: [
    {
      title: "Storyboard assisté",
      description:
        "L'IA suggère une progression alignée sur vos objectifs avec des moments d'interaction ciblés.",
    },
    {
      title: "Ressources intégrées",
      description:
        "Textes, rétroactions et exemples contextualisés sont préremplis et personnalisables.",
    },
    {
      title: "Suivi prêt à l'emploi",
      description:
        "Collectez les traces d'apprentissage et exportez les livrables vers vos outils institutionnels.",
    },
  ],
  experiencesCardCtaLabel: "Publier immédiatement",
  integrationsEyebrow: "Intégrations LTI",
  integrationsTitle:
    "Connectez vos activités autoportantes à n'importe quel environnement d'apprentissage.",
  integrationsDescription:
    "Le Deep Linking LTI diffuse vos créations vers le bon groupe tandis que les webhooks alimentent vos tableaux de bord.",
  integrationHighlights: [
    {
      title: "Deep Link dynamique",
      description:
        "Insérez l'activité générée directement dans un cours via LTI 1.3, sans double saisie.",
    },
    {
      title: "Rôles synchronisés",
      description:
        "Les permissions enseignant et étudiant sont gérées automatiquement depuis votre LMS.",
    },
    {
      title: "Suivi consolidé",
      description:
        "Retrouvez l'engagement et les livrables dans vos outils analytiques existants.",
    },
  ],
  onboardingTitle: "Comment déployer ?",
  onboardingSteps: [
    {
      title: "Configurer le studio",
      description:
        "Ajoutez le connecteur LTI et partagez la clé publique fournie par votre équipe numérique.",
    },
    {
      title: "Générer l'activité",
      description:
        "Décrivez objectifs et livrables : l'IA compose un parcours autoportant prêt à l'emploi.",
    },
    {
      title: "Partager en Deep Link",
      description:
        "Sélectionnez l'activité générée et insérez-la dans vos cours via le flux LTI.",
    },
  ],
  onboardingCtaLabel: "Activer le déploiement LTI",
  closingTitle: "Passez de l'idée à l'activité livrable en quelques minutes.",
  closingDescription:
    "Nos spécialistes vous accompagnent pour configurer le studio, cadrer les usages responsables de l'IA et déployer vos activités via LTI Deep Linking.",
  closingPrimaryCtaLabel: "Lancer le studio",
  closingSecondaryCtaLabel: "Planifier une démonstration",
  footerNote: "Studio pédagogique – Plateforme autoportante dédiée à l'enseignement.",
  footerLinks: [{ label: "Se connecter", href: "/connexion" }],
};

function cloneLandingContent(content: LandingPageContent): LandingPageContent {
  return {
    ...content,
    heroHighlights: content.heroHighlights.map((item) => ({ ...item })),
    heroIdealForItems: [...content.heroIdealForItems],
    experiencesCards: content.experiencesCards.map((item) => ({ ...item })),
    integrationHighlights: content.integrationHighlights.map((item) => ({ ...item })),
    onboardingSteps: content.onboardingSteps.map((item) => ({ ...item })),
    footerLinks: content.footerLinks.map((item) => ({ ...item })),
  };
}

function normalizeLandingContent(raw?: LandingPageContent | null): LandingPageContent {
  if (!raw) {
    return cloneLandingContent(DEFAULT_LANDING_PAGE_CONTENT);
  }
  return cloneLandingContent({
    ...DEFAULT_LANDING_PAGE_CONTENT,
    ...raw,
    heroHighlights: raw.heroHighlights ?? DEFAULT_LANDING_PAGE_CONTENT.heroHighlights,
    heroIdealForItems:
      raw.heroIdealForItems ?? DEFAULT_LANDING_PAGE_CONTENT.heroIdealForItems,
    experiencesCards: raw.experiencesCards ?? DEFAULT_LANDING_PAGE_CONTENT.experiencesCards,
    integrationHighlights:
      raw.integrationHighlights ?? DEFAULT_LANDING_PAGE_CONTENT.integrationHighlights,
    onboardingSteps: raw.onboardingSteps ?? DEFAULT_LANDING_PAGE_CONTENT.onboardingSteps,
    footerLinks: raw.footerLinks ?? DEFAULT_LANDING_PAGE_CONTENT.footerLinks,
  });
}

type LandingPageStringField =
  | "brandTagline"
  | "navActivitiesLabel"
  | "navIntegrationsLabel"
  | "navLoginLabel"
  | "heroEyebrow"
  | "heroTitle"
  | "heroDescription"
  | "heroPrimaryCtaLabel"
  | "heroSecondaryCtaLabel"
  | "heroBadgeLabel"
  | "heroBadgeTitle"
  | "heroBadgeDescription"
  | "heroIdealForTitle"
  | "experiencesEyebrow"
  | "experiencesTitle"
  | "experiencesDescription"
  | "experiencesCardCtaLabel"
  | "integrationsEyebrow"
  | "integrationsTitle"
  | "integrationsDescription"
  | "onboardingTitle"
  | "onboardingCtaLabel"
  | "closingTitle"
  | "closingDescription"
  | "closingPrimaryCtaLabel"
  | "closingSecondaryCtaLabel"
  | "footerNote";

function LandingPage(): JSX.Element {
  const navigate = useNavigate();
  const { isLTISession, loading: ltiLoading } = useLTI();
  const { status: adminStatus, user: adminUser, token, isEditMode, setEditMode } =
    useAdminAuth();
  const normalizedAdminRoles = useMemo(() => {
    if (!Array.isArray(adminUser?.roles)) {
      return [] as string[];
    }
    return adminUser.roles
      .map((role) => (typeof role === "string" ? role.toLowerCase() : ""))
      .filter((role): role is string => role.length > 0);
  }, [adminUser?.roles]);
  const canEdit =
    adminStatus === "authenticated" &&
    normalizedAdminRoles.some((role) => ADMIN_ROLE_SET.has(role));
  const canAccessActivities = useMemo(
    () => normalizedAdminRoles.some((role) => ACTIVITY_ROLE_SET.has(role)),
    [normalizedAdminRoles]
  );

  const [content, setContent] = useState<LandingPageContent>(() =>
    cloneLandingContent(DEFAULT_LANDING_PAGE_CONTENT)
  );
  const [draft, setDraft] = useState<LandingPageContent>(() =>
    cloneLandingContent(DEFAULT_LANDING_PAGE_CONTENT)
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (ltiLoading || adminStatus === "loading") {
      return;
    }

    if (isLTISession || (adminStatus === "authenticated" && canAccessActivities && !canEdit)) {
      navigate("/activites", { replace: true });
    }
  }, [
    adminStatus,
    canAccessActivities,
    canEdit,
    isLTISession,
    ltiLoading,
    navigate,
  ]);

  useEffect(() => {
    let cancelled = false;

    const loadContent = async () => {
      setLoading(true);
      try {
        const response = await landingPageClient.get();
        if (cancelled) {
          return;
        }
        const normalized = normalizeLandingContent(response);
        setContent(normalized);
        setDraft(normalized);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.warn("Impossible de charger la configuration de la page d'accueil", err);
          const fallback = cloneLandingContent(DEFAULT_LANDING_PAGE_CONTENT);
          setContent(fallback);
          setDraft(fallback);
          setError(
            "Impossible de charger les textes personnalisés. Les valeurs par défaut sont utilisées."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadContent();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isEditMode) {
      setDraft(cloneLandingContent(content));
    }
  }, [content, isEditMode]);

  const displayContent = isEditMode ? draft : content;
  const currentYear = new Date().getFullYear();

  const handleStringChange = (field: LandingPageStringField) => (value: string) => {
    if (!isEditMode) return;
    setDraft((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleHighlightChange = (
    section: "heroHighlights" | "experiencesCards" | "integrationHighlights",
    index: number,
    key: "title" | "description",
    value: string
  ) => {
    if (!isEditMode) return;
    setDraft((prev) => ({
      ...prev,
      [section]: prev[section].map((item, idx) =>
        idx === index ? { ...item, [key]: value } : item
      ),
    }));
  };

  const handleOnboardingStepChange = (
    index: number,
    key: "title" | "description",
    value: string
  ) => {
    if (!isEditMode) return;
    setDraft((prev) => ({
      ...prev,
      onboardingSteps: prev.onboardingSteps.map((item, idx) =>
        idx === index ? { ...item, [key]: value } : item
      ),
    }));
  };

  const handleIdealForChange = (index: number, value: string) => {
    if (!isEditMode) return;
    setDraft((prev) => {
      const next = [...prev.heroIdealForItems];
      next[index] = value;
      return {
        ...prev,
        heroIdealForItems: next,
      };
    });
  };

  const handleFooterLinkChange = (
    index: number,
    key: "label" | "href",
    value: string
  ) => {
    if (!isEditMode) return;
    setDraft((prev) => ({
      ...prev,
      footerLinks: prev.footerLinks.map((link, idx) =>
        idx === index ? { ...link, [key]: value } : link
      ),
    }));
  };

  const handleEnterEditMode = () => {
    if (!canEdit) return;
    setDraft(cloneLandingContent(content));
    setEditMode(true);
    setError(null);
  };

  const handleCancel = () => {
    setDraft(cloneLandingContent(content));
    setEditMode(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!canEdit || !isEditMode || isSaving) return;

    setIsSaving(true);
    try {
      await admin.landingPage.save(draft, token);
      setContent(cloneLandingContent(draft));
      setEditMode(false);
      setError(null);
    } catch (err) {
      console.error("Erreur lors de la sauvegarde de la page d'accueil:", err);
      alert("Erreur lors de la sauvegarde. Veuillez réessayer.");
    } finally {
      setIsSaving(false);
    }
  };

  const renderFooterLink = (link: LandingPageLink, index: number) => {
    const key = `${link.href}-${index}`;
    if (!link.href) {
      return (
        <span key={key} className="text-[color:var(--brand-charcoal)]/80">
          {link.label}
        </span>
      );
    }
    if (link.href.startsWith("/") ) {
      return (
        <Link key={key} to={link.href} className="hover:text-[color:var(--brand-red)]">
          {link.label}
        </Link>
      );
    }
    return (
      <a
        key={key}
        href={link.href}
        className="hover:text-[color:var(--brand-red)]"
      >
        {link.label}
      </a>
    );
  };

  interface EditableTextProps {
    value: string;
    onChange: (value: string) => void;
    as?: keyof JSX.IntrinsicElements;
    className?: string;
    placeholder?: string;
    multiline?: boolean;
    rows?: number;
    type?: string;
    inputClassName?: string;
    textareaClassName?: string;
  }

  const EditableText = ({
    value,
    onChange,
    as = "span",
    className = "",
    placeholder,
    multiline = false,
    rows = 3,
    type = "text",
    inputClassName,
    textareaClassName,
  }: EditableTextProps): JSX.Element => {
    if (isEditMode) {
      if (multiline) {
        return (
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={rows}
            className={`${textareaClassName ?? "w-full"} resize-none rounded border border-orange-300 bg-white/90 p-2 focus:border-orange-500 focus:outline-none focus:ring-0 ${className}`}
            placeholder={placeholder}
          />
        );
      }
      return (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClassName ?? "w-full"} rounded border border-orange-300 bg-white/90 px-2 py-1 focus:border-orange-500 focus:outline-none focus:ring-0 ${className}`}
          placeholder={placeholder}
        />
      );
    }
    const Element = as as keyof JSX.IntrinsicElements;
    return <Element className={className}>{value}</Element>;
  };

  interface EditableButtonProps {
    label: string;
    onChange: (value: string) => void;
    variant: "primary" | "light";
    to?: string;
    href?: string;
  }

  const EditableButton = ({
    label,
    onChange,
    variant,
    to,
    href,
  }: EditableButtonProps): JSX.Element => {
    const baseClasses =
      variant === "primary"
        ? "cta-button cta-button--primary"
        : "cta-button cta-button--light";
    if (isEditMode) {
      const editClasses =
        variant === "primary"
          ? "rounded-full border border-orange-300 bg-[color:var(--brand-red)]/90 px-4 py-2 text-sm font-semibold text-white focus:border-orange-500 focus:outline-none focus:ring-0"
          : "rounded-full border border-orange-300 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--brand-charcoal)] focus:border-orange-500 focus:outline-none focus:ring-0";
      return (
        <input
          type="text"
          value={label}
          onChange={(event) => onChange(event.target.value)}
          className={editClasses}
        />
      );
    }
    if (to) {
      return (
        <Link to={to} className={baseClasses}>
          {label}
        </Link>
      );
    }
    return (
      <a href={href} className={baseClasses}>
        {label}
      </a>
    );
  };

  return (
    <div className="landing-gradient min-h-screen px-4 pb-24 pt-10 text-[color:var(--brand-black)] sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-16">
        <header className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            {isEditMode ? (
              <div className="flex items-center gap-3">
                <img
                  src={logoPrincipal}
                  alt={`Logo ${displayContent.brandTagline}`}
                  className="h-10 w-auto md:h-12"
                />
                <EditableText
                  value={displayContent.brandTagline}
                  onChange={handleStringChange("brandTagline")}
                  as="span"
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/80"
                  placeholder="Nom de la plateforme"
                  inputClassName="w-auto min-w-[160px]"
                />
              </div>
            ) : (
              <Link to="/" className="flex items-center gap-3">
                <img
                  src={logoPrincipal}
                  alt={`Logo ${displayContent.brandTagline}`}
                  className="h-10 w-auto md:h-12"
                />
                <EditableText
                  value={displayContent.brandTagline}
                  onChange={handleStringChange("brandTagline")}
                  as="span"
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/80"
                  placeholder="Nom de la plateforme"
                  inputClassName="w-auto min-w-[160px]"
                />
              </Link>
            )}
            <div className="flex flex-col gap-3 md:items-end">
              <nav className="flex flex-wrap items-center gap-3 text-sm font-semibold text-[color:var(--brand-charcoal)]/80 md:justify-end">
                {isEditMode ? (
                  <input
                    type="text"
                    value={draft.navLoginLabel}
                    onChange={(event) => handleStringChange("navLoginLabel")(event.target.value)}
                    className="min-w-[140px] rounded-full border border-orange-300 bg-white/90 px-4 py-2 focus:border-orange-500 focus:outline-none"
                    placeholder="Libellé de connexion"
                  />
                ) : (
                  <Link to="/connexion" className="cta-button cta-button--primary">
                    {displayContent.navLoginLabel}
                  </Link>
                )}
              </nav>
              {canEdit && (
                <div className="flex flex-wrap justify-end gap-2">
                  {isEditMode ? (
                    <>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center justify-center rounded-full border border-green-600/20 bg-green-50 px-4 py-2 text-xs font-medium text-green-700 transition hover:border-green-600/40 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSaving ? "Sauvegarde..." : "Sauvegarder"}
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={isSaving}
                        className="inline-flex items-center justify-center rounded-full border border-red-600/20 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 transition hover:border-red-600/40 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleEnterEditMode}
                      disabled={loading}
                      className="inline-flex items-center justify-center rounded-full border border-orange-600/20 bg-orange-50 px-4 py-2 text-xs font-medium text-orange-700 transition hover:border-orange-600/40 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? "Chargement..." : "Mode édition"}
                    </button>
                  )}
                </div>
              )}
              {canEdit && error ? (
                <p className="text-xs font-medium text-red-600">{error}</p>
              ) : null}
            </div>
          </div>
        </header>

        <main className="space-y-16">
          <section className="page-section landing-panel grid gap-12 bg-white/95 md:grid-cols-[2fr,1fr]">
            <div className="space-y-6">
              <EditableText
                value={displayContent.heroEyebrow}
                onChange={handleStringChange("heroEyebrow")}
                as="span"
                className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]"
              />
              <EditableText
                value={displayContent.heroTitle}
                onChange={handleStringChange("heroTitle")}
                as="h1"
                className="text-4xl font-semibold leading-tight md:text-5xl"
              />
              <EditableText
                value={displayContent.heroDescription}
                onChange={handleStringChange("heroDescription")}
                as="p"
                multiline
                rows={4}
                className="text-base leading-relaxed text-[color:var(--brand-charcoal)]"
              />
              <div className="flex flex-col gap-3 sm:flex-row">
                <EditableButton
                  label={displayContent.heroPrimaryCtaLabel}
                  onChange={handleStringChange("heroPrimaryCtaLabel")}
                  variant="primary"
                  to="/activites"
                />
                <EditableButton
                  label={displayContent.heroSecondaryCtaLabel}
                  onChange={handleStringChange("heroSecondaryCtaLabel")}
                  variant="light"
                  to="/connexion"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {displayContent.heroHighlights.map((item, index) => (
                  <div
                    key={`hero-highlight-${index}`}
                    className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm"
                  >
                    <EditableText
                      value={item.title}
                      onChange={(value) =>
                        handleHighlightChange("heroHighlights", index, "title", value)
                      }
                      as="h3"
                      className="text-sm font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80"
                    />
                    <EditableText
                      value={item.description}
                      onChange={(value) =>
                        handleHighlightChange("heroHighlights", index, "description", value)
                      }
                      as="p"
                      multiline
                      rows={3}
                      className="mt-2 text-sm leading-relaxed text-[color:var(--brand-charcoal)]"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="relative flex flex-col justify-between gap-6 rounded-3xl border border-[color:var(--brand-red)]/30 bg-[color:var(--brand-red)]/10 p-6 text-[color:var(--brand-charcoal)] shadow-inner">
              <div>
                <EditableText
                  value={displayContent.heroBadgeLabel}
                  onChange={handleStringChange("heroBadgeLabel")}
                  as="p"
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--brand-red)]/80"
                />
                <EditableText
                  value={displayContent.heroBadgeTitle}
                  onChange={handleStringChange("heroBadgeTitle")}
                  as="h2"
                  className="mt-3 text-2xl font-semibold leading-snug"
                />
                <EditableText
                  value={displayContent.heroBadgeDescription}
                  onChange={handleStringChange("heroBadgeDescription")}
                  as="p"
                  multiline
                  rows={3}
                  className="mt-2 text-sm leading-relaxed"
                />
              </div>
              <div className="rounded-2xl border border-white/60 bg-white/70 p-4">
                <EditableText
                  value={displayContent.heroIdealForTitle}
                  onChange={handleStringChange("heroIdealForTitle")}
                  as="p"
                  className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]/80"
                />
                <ul className="mt-3 space-y-2 text-sm text-[color:var(--brand-charcoal)]">
                  {displayContent.heroIdealForItems.map((item, index) => (
                    <li key={`ideal-${index}`} className="flex items-start gap-2">
                      <span
                        className="mt-1 h-2 w-2 rounded-full bg-[color:var(--brand-red)]"
                        aria-hidden="true"
                      />
                      {isEditMode ? (
                        <input
                          type="text"
                          value={draft.heroIdealForItems[index]}
                          onChange={(event) =>
                            handleIdealForChange(index, event.target.value)
                          }
                          className="w-full rounded border border-orange-300 bg-white/90 px-2 py-1 text-sm focus:border-orange-500 focus:outline-none"
                        />
                      ) : (
                        <span>{item}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section id="activites" className="page-section landing-panel space-y-8 bg-white/90">
            <div className="space-y-3">
              <EditableText
                value={displayContent.experiencesEyebrow}
                onChange={handleStringChange("experiencesEyebrow")}
                as="span"
                className="brand-chip bg-[color:var(--brand-black)] text-white"
              />
              <EditableText
                value={displayContent.experiencesTitle}
                onChange={handleStringChange("experiencesTitle")}
                as="h2"
                className="text-3xl font-semibold leading-tight"
              />
              <EditableText
                value={displayContent.experiencesDescription}
                onChange={handleStringChange("experiencesDescription")}
                as="p"
                multiline
                rows={4}
                className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {displayContent.experiencesCards.map((card, index) => (
                <article
                  key={`experience-card-${index}`}
                  className="flex h-full flex-col gap-3 rounded-3xl border border-white/80 bg-white/80 p-6 shadow-sm"
                >
                  <EditableText
                    value={card.title}
                    onChange={(value) =>
                      handleHighlightChange("experiencesCards", index, "title", value)
                    }
                    as="h3"
                    className="text-xl font-semibold leading-snug"
                  />
                  <EditableText
                    value={card.description}
                    onChange={(value) =>
                      handleHighlightChange("experiencesCards", index, "description", value)
                    }
                    as="p"
                    multiline
                    rows={4}
                    className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]"
                  />
                  <div className="mt-auto flex items-center gap-2 text-sm font-semibold text-[color:var(--brand-red)]">
                    <span aria-hidden="true">→</span>
                    {isEditMode ? (
                      <input
                        type="text"
                        value={draft.experiencesCardCtaLabel}
                        onChange={(event) =>
                          handleStringChange("experiencesCardCtaLabel")(event.target.value)
                        }
                        className="w-full rounded border border-orange-300 bg-white/90 px-2 py-1 focus:border-orange-500 focus:outline-none"
                      />
                    ) : (
                      displayContent.experiencesCardCtaLabel
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section id="integrations" className="page-section landing-panel space-y-8 bg-white/95">
            <div className="space-y-3">
              <EditableText
                value={displayContent.integrationsEyebrow}
                onChange={handleStringChange("integrationsEyebrow")}
                as="span"
                className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]"
              />
              <EditableText
                value={displayContent.integrationsTitle}
                onChange={handleStringChange("integrationsTitle")}
                as="h2"
                className="text-3xl font-semibold leading-tight"
              />
              <EditableText
                value={displayContent.integrationsDescription}
                onChange={handleStringChange("integrationsDescription")}
                as="p"
                multiline
                rows={4}
                className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]"
              />
            </div>
            <div className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
              <div className="grid gap-4 md:grid-cols-2">
                {displayContent.integrationHighlights.map((item, index) => (
                  <div
                    key={`integration-${index}`}
                    className="rounded-3xl border border-white/80 bg-white/80 p-6 shadow-sm"
                  >
                    <EditableText
                      value={item.title}
                      onChange={(value) =>
                        handleHighlightChange("integrationHighlights", index, "title", value)
                      }
                      as="h3"
                      className="text-lg font-semibold leading-snug text-[color:var(--brand-black)]"
                    />
                    <EditableText
                      value={item.description}
                      onChange={(value) =>
                        handleHighlightChange("integrationHighlights", index, "description", value)
                      }
                      as="p"
                      multiline
                      rows={4}
                      className="mt-2 text-sm leading-relaxed text-[color:var(--brand-charcoal)]"
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-4 rounded-3xl border border-white/80 bg-white/70 p-6 shadow-sm">
                <EditableText
                  value={displayContent.onboardingTitle}
                  onChange={handleStringChange("onboardingTitle")}
                  as="h3"
                  className="text-lg font-semibold leading-snug text-[color:var(--brand-black)]"
                />
                <ol className="space-y-3 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
                  {displayContent.onboardingSteps.map((step, index) => (
                    <li key={`onboarding-${index}`} className="flex gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--brand-red)]/10 text-sm font-semibold text-[color:var(--brand-red)]">
                        {index + 1}
                      </span>
                      <div className="space-y-1">
                        <EditableText
                          value={step.title}
                          onChange={(value) =>
                            handleOnboardingStepChange(index, "title", value)
                          }
                          as="p"
                          className="font-semibold text-[color:var(--brand-black)]"
                        />
                        <EditableText
                          value={step.description}
                          onChange={(value) =>
                            handleOnboardingStepChange(index, "description", value)
                          }
                          as="p"
                          multiline
                          rows={3}
                          className="text-[color:var(--brand-charcoal)]/80"
                        />
                      </div>
                    </li>
                  ))}
                </ol>
                <EditableButton
                  label={displayContent.onboardingCtaLabel}
                  onChange={handleStringChange("onboardingCtaLabel")}
                  variant="primary"
                  to="/connexion"
                />
              </div>
            </div>
          </section>

          <section className="page-section landing-panel space-y-6 bg-white/90">
            <div className="flex flex-col gap-4 text-center">
              <EditableText
                value={displayContent.closingTitle}
                onChange={handleStringChange("closingTitle")}
                as="h2"
                className="text-3xl font-semibold leading-tight"
              />
              <EditableText
                value={displayContent.closingDescription}
                onChange={handleStringChange("closingDescription")}
                as="p"
                multiline
                rows={4}
                className="text-sm leading-relaxed text-[color:var(--brand-charcoal)] md:text-base"
              />
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                <EditableButton
                  label={displayContent.closingPrimaryCtaLabel}
                  onChange={handleStringChange("closingPrimaryCtaLabel")}
                  variant="primary"
                  to="/activites"
                />
                <EditableButton
                  label={displayContent.closingSecondaryCtaLabel}
                  onChange={handleStringChange("closingSecondaryCtaLabel")}
                  variant="light"
                  href="mailto:innovation@cegeplimoilou.ca"
                />
              </div>
            </div>
          </section>
        </main>

        <footer className="flex flex-col items-center gap-2 text-center text-xs text-[color:var(--brand-charcoal)]/80 md:flex-row md:justify-between">
          {isEditMode ? (
            <div className="flex items-center gap-2">
              <span>© {currentYear}</span>
              <input
                type="text"
                value={draft.footerNote}
                onChange={(event) => handleStringChange("footerNote")(event.target.value)}
                className="w-full rounded border border-orange-300 bg-white/90 px-2 py-1 focus:border-orange-500 focus:outline-none"
              />
            </div>
          ) : (
            <p>© {currentYear} {displayContent.footerNote}</p>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            {isEditMode
              ? draft.footerLinks.map((link, index) => (
                  <div
                    key={`footer-edit-${index}`}
                    className="flex flex-col gap-1 rounded-lg border border-orange-200 bg-white/70 p-2"
                  >
                    <input
                      type="text"
                      value={link.label}
                      onChange={(event) =>
                        handleFooterLinkChange(index, "label", event.target.value)
                      }
                      className="rounded border border-orange-300 bg-white/90 px-2 py-1 text-xs focus:border-orange-500 focus:outline-none"
                      placeholder="Libellé"
                    />
                    <input
                      type="text"
                      value={link.href}
                      onChange={(event) =>
                        handleFooterLinkChange(index, "href", event.target.value)
                      }
                      className="rounded border border-orange-300 bg-white/90 px-2 py-1 text-xs focus:border-orange-500 focus:outline-none"
                      placeholder="Lien"
                    />
                  </div>
                ))
              : displayContent.footerLinks.map(renderFooterLink)}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default LandingPage;
