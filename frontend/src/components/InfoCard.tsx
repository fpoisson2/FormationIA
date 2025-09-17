type InfoCardTone = "red" | "black" | "sand" | "white";

interface InfoCardProps {
  title: string;
  description: string;
  items?: string[];
  tone?: InfoCardTone;
}

const toneStyles: Record<InfoCardTone, string> = {
  red: "bg-[rgba(237,30,32,0.12)] text-[color:var(--brand-black)] border border-[rgba(237,30,32,0.2)]",
  black: "bg-[color:var(--brand-black)] text-white border border-white/10",
  sand: "bg-white/80 text-[color:var(--brand-black)] border border-white/60",
  white: "bg-white text-[color:var(--brand-black)] border border-white/60",
};

function InfoCard({ title, description, items, tone = "sand" }: InfoCardProps): JSX.Element {
  return (
    <div className={`rounded-3xl p-6 shadow-sm backdrop-blur ${toneStyles[tone]}`}>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-2 w-8 rounded-full bg-[color:var(--brand-red)]" />
        <h3 className="text-base font-semibold uppercase tracking-wide">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed">{description}</p>
      {items && (
        <ul className="mt-4 space-y-2 text-sm leading-relaxed">
          {items.map((item, index) => (
            <li key={index} className="flex gap-3">
              <span className="mt-2 inline-flex h-2 w-2 flex-shrink-0 rounded-full bg-[color:var(--brand-red)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default InfoCard;
