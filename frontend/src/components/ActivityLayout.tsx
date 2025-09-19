import { ReactNode } from "react";
import { Link } from "react-router-dom";

import logoPrincipal from "../assets/logo_principal.svg";

interface ActivityLayoutProps {
  activityId?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  leadingContent?: ReactNode;
  headerActions?: ReactNode;
  headerChildren?: ReactNode;
  headerBody?: ReactNode;
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  headerClassName?: string;
  contentClassName?: string;
}

function ActivityLayout({
  activityId,
  eyebrow,
  title,
  subtitle,
  badge,
  leadingContent,
  headerActions,
  headerChildren,
  headerBody,
  children,
  className,
  containerClassName,
  headerClassName,
  contentClassName,
}: ActivityLayoutProps): JSX.Element {
  const dataAttributes = activityId ? { "data-activity-id": activityId } : undefined;
  const outerClasses = `landing-gradient min-h-screen px-6 py-16 text-[color:var(--brand-black)] ${
    className ?? ""
  }`;
  const containerClasses = `mx-auto max-w-6xl space-y-10 ${containerClassName ?? ""}`;
  const headerClasses = `space-y-6 rounded-3xl border border-white/70 bg-white/90 p-8 shadow-sm backdrop-blur ${
    headerClassName ?? ""
  }`;
  const mainClasses = `space-y-10 ${contentClassName ?? ""}`;
  const showActionGroup = Boolean(badge) || Boolean(headerActions);

  return (
    <div className={outerClasses} {...dataAttributes}>
      <div className={containerClasses}>
        {leadingContent}
        <header className={headerClasses}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <Link to="/" className="flex items-center gap-3">
              <img src={logoPrincipal} alt="Cégep Limoilou" className="h-12 w-auto md:h-14" />
              {eyebrow ? (
                <span className="text-xs uppercase tracking-[0.3em] text-[color:var(--brand-charcoal)]/70">
                  {eyebrow}
                </span>
              ) : null}
            </Link>
            {showActionGroup ? (
              <div className="flex flex-col items-center gap-3 md:flex-row md:items-center md:gap-4">
                {badge ? (
                  <span className="brand-chip bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]">
                    {badge}
                  </span>
                ) : null}
                {headerActions}
              </div>
            ) : null}
          </div>
          {headerBody ?? (
            <div className="space-y-3 text-center md:text-left">
              <h1 className="text-3xl font-semibold md:text-4xl">{title}</h1>
              {subtitle ? (
                <p className="mx-auto max-w-3xl text-sm leading-relaxed text-[color:var(--brand-charcoal)] md:text-base">
                  {subtitle}
                </p>
              ) : null}
            </div>
          )}
          {headerChildren}
        </header>
        <main className={mainClasses}>{children}</main>
      </div>
    </div>
  );
}

export default ActivityLayout;
