import type { ReactNode } from "react";

function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

interface ChatBubbleProps {
  role: "ai" | "user";
  title?: string;
  roleLabel?: string;
  isStreaming?: boolean;
  children: ReactNode;
  bubbleClassName?: string;
  containerClassName?: string;
  chipClassName?: string;
}

const ROLE_META = {
  ai: {
    label: "Usager",
    container: "items-start",
    bubble: "bg-white/95 text-[color:var(--brand-black)] border border-white/70 shadow-sm",
    chip: "bg-[color:var(--brand-red)]/10 text-[color:var(--brand-red)]",
  },
  user: {
    label: "IA Clarté",
    container: "items-end",
    bubble: "bg-[color:var(--brand-red)] text-white shadow-lg",
    chip: "bg-white/20 text-white",
  },
} as const;

function ChatBubble({
  role,
  title,
  roleLabel,
  isStreaming = false,
  children,
  bubbleClassName,
  containerClassName,
  chipClassName,
}: ChatBubbleProps): JSX.Element {
  const meta = ROLE_META[role];
  const appliedBubble = bubbleClassName ?? meta.bubble;
  const appliedChip = chipClassName ?? meta.chip;
  const appliedLabel = roleLabel && roleLabel.trim().length > 0 ? roleLabel : meta.label;

  return (
    <div className={joinClasses("flex", meta.container, containerClassName)}>
      <div
        className={joinClasses(
          "relative w-full rounded-3xl px-5 py-4 transition md:max-w-3xl",
          appliedBubble,
          role === "ai" ? "rounded-bl-sm" : "rounded-br-sm"
        )}
      >
        <span
          className={joinClasses(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
            appliedChip
          )}
        >
          {appliedLabel}
          {title ? <span className="font-normal normal-case text-[0.65rem] opacity-80">{title}</span> : null}
        </span>
        <div className="mt-3 space-y-3 text-sm leading-relaxed">{children}</div>
        {isStreaming ? <span className="ml-1 text-xs opacity-70 animate-pulse">▮</span> : null}
      </div>
    </div>
  );
}

export default ChatBubble;
