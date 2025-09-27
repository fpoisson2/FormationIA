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
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const node = bodyScrollRef.current;
    if (node) {
      node.scrollTop = 0;
    }
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6 md:items-center"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl [max-height:calc(100vh-2rem)] supports-[height:100dvh]:max-h-[calc(100dvh-2rem)] sm:[max-height:calc(100vh-3rem)] supports-[height:100dvh]:sm:max-h-[calc(100dvh-3rem)] md:[max-height:calc(100vh-4rem)] supports-[height:100dvh]:md:max-h-[calc(100dvh-4rem)] min-h-0"
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
        <div ref={bodyScrollRef} className="flex-1 overflow-y-auto min-h-0">
          <div className="p-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
