import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const node = scrollContainerRef.current;
    if (node) {
      node.scrollTop = 0;
    }
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={scrollContainerRef}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6 md:items-center"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] md:max-h-[calc(100dvh-4rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            className="rounded-lg bg-slate-100 px-3 py-1 hover:bg-slate-200"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="p-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
