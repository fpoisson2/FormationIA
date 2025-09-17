interface DiffProps {
  a: string;
  b: string;
}

function Diff({ a, b }: DiffProps): JSX.Element {
  const aWords = a.split(/\s+/);
  const bWords = b.split(/\s+/);
  const maxLength = Math.max(aWords.length, bWords.length);

  return (
    <div className="rounded-3xl border border-white/60 bg-white/80 shadow-sm">
      <div className="grid grid-cols-2 gap-2 rounded-t-3xl bg-[color:var(--brand-black)]/90 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/80">
        <span>Modèle A</span>
        <span>Modèle B</span>
      </div>
      <div className="max-h-60 space-y-1 overflow-auto p-4 text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
        {Array.from({ length: maxLength }).map((_, index) => {
          const wordA = aWords[index] ?? "";
          const wordB = bWords[index] ?? "";
          const same = wordA === wordB;
          return (
            <div key={index} className="grid grid-cols-2 gap-2">
              <span className={same ? "" : "rounded-full bg-[rgba(237,30,32,0.12)] px-2 py-1"}>{wordA}</span>
              <span className={same ? "" : "rounded-full bg-[rgba(66,247,251,0.18)] px-2 py-1"}>{wordB}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Diff;
