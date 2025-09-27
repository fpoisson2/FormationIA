import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";
import { useAdminAuth } from "../providers/AdminAuthProvider";
import { admin } from "../api";
import { useLTI } from "../hooks/useLTI";

const combineClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

type ContentElement = keyof JSX.IntrinsicElements;

interface ActivityLayoutProps {
  activityId: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  badge?: string;
  actions?: ReactNode;
  headerChildren?: ReactNode;
  beforeHeader?: ReactNode;
  children: ReactNode;
  outerClassName?: string;
  innerClassName?: string;
  headerClassName?: string;
  contentClassName?: string;
  contentAs?: ContentElement;
  titleAlign?: "left" | "center";
  showHeader?: boolean;
  withLandingGradient?: boolean;
  useDynamicViewportHeight?: boolean;
  withBasePadding?: boolean;
  withBaseContentSpacing?: boolean;
  withBaseInnerGap?: boolean;
  onHeaderEdit?: (
    field: "eyebrow" | "title" | "subtitle" | "badge",
    value: string
  ) => void;
  activityConfig?: any;
  onSaveActivity?: (config: any) => void;
}

function ActivityLayout({
  activityId,
  eyebrow,
  title,
  subtitle,
  badge,
  actions,
  headerChildren,
  beforeHeader,
  children,
  outerClassName,
  innerClassName,
  headerClassName,
  contentClassName,
  contentAs = "main",
  titleAlign = "left",
  showHeader = true,
  onHeaderEdit,
  activityConfig,
  onSaveActivity,
  withLandingGradient = true,
  useDynamicViewportHeight = false,
  withBasePadding = true,
  withBaseContentSpacing = true,
  withBaseInnerGap = true,
}: ActivityLayoutProps): JSX.Element {
  const { isEditMode, status, token } = useAdminAuth();
  const { isLTISession } = useLTI();
  const isAuthenticated = status === "authenticated" || isLTISession;
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!onSaveActivity || !activityConfig || isSaving) return;

    setIsSaving(true);
    try {
      await onSaveActivity(activityConfig);
    } catch (error) {
      console.error("Erreur lors de la sauvegarde de l'activité:", error);
      alert("Erreur lors de la sauvegarde. Veuillez réessayer.");
    } finally {
      setIsSaving(false);
    }
  };

  const shouldShowEditBanner = isEditMode && !!onSaveActivity;
  const bannerMessage = onHeaderEdit
    ? "Mode édition activé — pensez à enregistrer vos modifications."
    : "Mode édition activé — les changements doivent être sauvegardés.";

  const ContentTag = contentAs as ContentElement;
  const titleContainerClass =
    titleAlign === "center" ? "text-center" : "text-center md:text-left";
  const shouldRenderHeader = showHeader !== false;

  return (
    <div
      className={combineClasses(
        useDynamicViewportHeight ? "min-h-[100dvh]" : "min-h-screen",
        withBasePadding ? "px-4 pb-16 pt-10 sm:px-6" : "",
        "text-[color:var(--brand-black)]",
        withLandingGradient ? "landing-gradient" : "",
        outerClassName
      )}
      data-activity={activityId}
    >
      <div
        className={combineClasses(
          "mx-auto flex max-w-6xl flex-col",
          withBaseInnerGap ? "gap-12" : "",
          innerClassName
        )}
      >
        {shouldShowEditBanner ? (
          <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <div className="flex flex-col gap-3 text-sm text-orange-800 md:flex-row md:items-center md:justify-between">
              <p className="font-medium">{bannerMessage}</p>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center justify-center rounded bg-orange-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Sauvegarde…" : "Sauvegarder"}
              </button>
            </div>
          </div>
        ) : null}
        {beforeHeader}
        {!shouldRenderHeader && actions ? (
          <div className="flex justify-end">
            <div className="rounded-full border border-white/70 bg-white/90 px-4 py-2 shadow-sm backdrop-blur">
              {actions}
            </div>
          </div>
        ) : null}
        {shouldRenderHeader ? (
          <header
            className={combineClasses(
              "space-y-6 rounded-3xl border border-white/70 bg-white/90 p-8 shadow-sm backdrop-blur",
              headerClassName,
              isEditMode && onHeaderEdit ? "border-orange-200 ring-2 ring-orange-100" : ""
            )}
          >
            {isEditMode && onHeaderEdit ? (
              <p className="mb-4 text-xs font-medium uppercase tracking-wider text-orange-700">
                Mode édition activé – modifier les textes de l'en-tête
              </p>
            ) : null}
            <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
              <Link
                to={isAuthenticated ? "/activites" : "/"}
                className="flex w-full flex-wrap items-center gap-3 md:w-auto"
              >
                <img
                  src={logoPrincipal}
                  alt="Cégep Limoilou"
                  className="h-12 w-auto flex-shrink-0 md:h-16"
                />
                {isEditMode && onHeaderEdit ? (
                  <input
                    type="text"
                    value={eyebrow}
                    onChange={(e) => onHeaderEdit('eyebrow', e.target.value)}
                    className="w-full min-w-0 flex-1 text-xs uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/70 bg-transparent border-b border-orange-300 focus:border-orange-500 focus:outline-none md:w-auto"
                    placeholder="Eyebrow"
                  />
                ) : (
                  <span className="block w-full min-w-0 text-xs uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/70 md:inline-block md:w-auto">
                    {eyebrow}
                  </span>
                )}
              </Link>
              {(badge || actions) && (
                <div className="flex w-full flex-col items-center gap-2 md:w-auto md:flex-row md:items-center">
                  {badge ? (
                    isEditMode && onHeaderEdit ? (
                      <input
                        type="text"
                        value={badge}
                        onChange={(e) => onHeaderEdit('badge', e.target.value)}
                        className="brand-chip w-full min-w-0 border border-orange-300 bg-orange-50 text-orange-700 focus:border-orange-500 focus:outline-none md:w-auto"
                        placeholder="Badge"
                      />
                    ) : (
                      <span className="brand-chip w-full justify-center text-[color:var(--brand-red)] bg-[color:var(--brand-red)]/10 md:w-auto md:justify-start">
                        {badge}
                      </span>
                    )
                  ) : null}
                  {actions}
                </div>
              )}
            </div>
            <div className={combineClasses("space-y-3", titleContainerClass)}>
              {isEditMode && onHeaderEdit ? (
                <>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => onHeaderEdit('title', e.target.value)}
                    className="w-full text-3xl font-semibold leading-tight md:text-4xl bg-transparent border-b-2 border-orange-300 focus:border-orange-500 focus:outline-none"
                    placeholder="Titre de l'activité"
                  />
                  {subtitle !== undefined && (
                    <textarea
                      value={subtitle}
                      onChange={(e) => onHeaderEdit('subtitle', e.target.value)}
                      rows={2}
                      className="w-full text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90 md:text-base bg-transparent border border-orange-300 rounded p-2 focus:border-orange-500 focus:outline-none resize-none"
                      placeholder="Sous-titre (optionnel)"
                    />
                  )}
                </>
              ) : (
                <>
                  <h1 className="text-3xl font-semibold leading-tight md:text-4xl">{title}</h1>
                  {subtitle ? (
                    <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90 md:text-base">
                      {subtitle}
                    </p>
                  ) : null}
                </>
              )}
            </div>
            {headerChildren}
          </header>
        ) : null}
        <ContentTag
          className={combineClasses(
            withBaseContentSpacing ? "space-y-10" : "",
            contentClassName
          )}
        >
          {children}
        </ContentTag>
      </div>
    </div>
  );
}

export default ActivityLayout;
