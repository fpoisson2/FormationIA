import { ReactNode } from "react";
import { Link } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";

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
}: ActivityLayoutProps): JSX.Element {
  const ContentTag = contentAs as ContentElement;
  const titleContainerClass =
    titleAlign === "center" ? "text-center" : "text-center md:text-left";

  return (
    <div
      className={combineClasses(
        "landing-gradient min-h-screen px-6 pb-16 pt-10 text-[color:var(--brand-black)]",
        outerClassName
      )}
      data-activity={activityId}
    >
      <div
        className={combineClasses(
          "mx-auto flex max-w-6xl flex-col gap-12",
          innerClassName
        )}
      >
        {beforeHeader}
        <header
          className={combineClasses(
            "space-y-6 rounded-3xl border border-white/70 bg-white/90 p-8 shadow-sm backdrop-blur",
            headerClassName
          )}
        >
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <Link to="/" className="flex items-center gap-3">
              <img src={logoPrincipal} alt="Cégep Limoilou" className="h-12 w-auto md:h-16" />
              <span className="text-xs uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/70">
                {eyebrow}
              </span>
            </Link>
            {(badge || actions) && (
              <div className="flex flex-col items-center gap-2 md:flex-row md:items-center">
                {badge ? (
                  <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
                    {badge}
                  </span>
                ) : null}
                {actions}
              </div>
            )}
          </div>
          <div className={combineClasses("space-y-3", titleContainerClass)}>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">{title}</h1>
            {subtitle ? (
              <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90 md:text-base">
                {subtitle}
              </p>
            ) : null}
          </div>
          {headerChildren}
        </header>
        <ContentTag
          className={combineClasses("space-y-10", contentClassName)}
        >
          {children}
        </ContentTag>
      </div>
    </div>
  );
}

export default ActivityLayout;
