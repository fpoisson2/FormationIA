import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useState } from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface AdminModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS: Record<NonNullable<AdminModalProps["size"]>, string> = {
  sm: "w-full max-w-[18.5rem] sm:max-w-md",
  md: "w-full max-w-[20rem] sm:max-w-2xl",
  lg: "w-full max-w-[21rem] sm:max-w-4xl",
};

export function AdminModal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
}: AdminModalProps): JSX.Element | null {
  const [viewportOffset, setViewportOffset] = useState(0);

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      return;
    }

    setViewportOffset(window.scrollY);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="absolute inset-x-0 z-50"
      style={{ top: viewportOffset }}
    >
      <div className="flex min-h-[100dvh] items-start justify-center overflow-y-auto bg-black/40 px-3 py-6 sm:items-center sm:px-4 sm:py-8">
        <div
          className={`${SIZE_CLASS[size]} max-h-[90vh] overflow-y-auto rounded-2xl border border-white/60 bg-white/95 p-5 shadow-2xl backdrop-blur sm:rounded-3xl sm:p-6`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-modal-title"
        >
          <div className="flex items-start justify-between gap-4 sm:gap-6">
            <div>
              <h2 id="admin-modal-title" className="text-xl font-semibold text-[color:var(--brand-black)]">
                {title}
              </h2>
              {description ? (
                <p className="mt-1 text-sm leading-relaxed text-[color:var(--brand-charcoal)]/90">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-transparent p-2 text-lg text-[color:var(--brand-charcoal)]/80 transition hover:bg-[color:var(--brand-charcoal)]/10"
              aria-label="Fermer la fenêtre"
            >
              ×
            </button>
          </div>
          <div className="mt-5 space-y-4 text-[color:var(--brand-charcoal)] sm:mt-6">{children}</div>
          {footer ? (
            <div className="mt-6 flex flex-col gap-3 border-t border-[color:var(--brand-charcoal)]/10 pt-4 text-right md:flex-row md:justify-end">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
