import type { ReactNode } from "react";

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
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
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
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div
        className={`w-full ${SIZE_CLASS[size]} rounded-3xl border border-white/60 bg-white/95 p-6 shadow-2xl backdrop-blur`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
      >
        <div className="flex items-start justify-between gap-6">
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
        <div className="mt-6 space-y-4 text-[color:var(--brand-charcoal)]">{children}</div>
        {footer ? (
          <div className="mt-6 flex flex-col gap-3 border-t border-[color:var(--brand-charcoal)]/10 pt-4 text-right md:flex-row md:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
