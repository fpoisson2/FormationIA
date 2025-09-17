import { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";

import InfoCard from "../components/InfoCard";

interface StepOneProps {
  sourceText: string;
  onSourceTextChange: (value: string) => void;
}

function StepOne({ sourceText, onSourceTextChange }: StepOneProps): JSX.Element {
  const navigate = useNavigate();

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onSourceTextChange(event.target.value);
  };

  return (
    <div className="space-y-12">
      <section className="page-section landing-panel grid gap-10 bg-white/95 animate-section md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4 animate-section-delayed">
          <div className="space-y-3">
            <span className="brand-chip bg-[color:var(--brand-red)] text-white/95">Étape 1</span>
            <h2 className="text-2xl leading-tight text-[color:var(--brand-black)]">
              Préparez un contexte clair pour guider l’IA
            </h2>
            <p className="text-sm leading-relaxed text-[color:var(--brand-charcoal)]">
              Sélectionnez un extrait de notes ou de cours qui représente bien vos besoins. Plus le contexte est précis, plus les comparaisons entre modèles seront éclairantes.
            </p>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-charcoal)]" htmlFor="source-text">
            Texte source — 120 à 200 mots
          </label>
          <textarea
            id="source-text"
            value={sourceText}
            onChange={handleChange}
            placeholder="Collez ici le passage que vous souhaitez faire analyser par l’IA. Pensez à préciser le niveau d’étude et l’objectif pédagogique."
            className="min-h-[220px] w-full rounded-3xl border border-white/70 bg-white/80 p-5 text-sm leading-relaxed shadow-inner focus:border-[color:var(--brand-red)] focus:outline-none focus:ring-2 focus:ring-red-200"
          />
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-[color:var(--brand-charcoal)]">
              Astuce : notez vos objectifs d’apprentissage dans le texte. Les modèles s’y référeront pour cadrer leurs réponses.
            </p>
            <button
              type="button"
              onClick={() => navigate("/etape-2")}
              className="cta-button cta-button--primary"
            >
              Passer à l’étape 2
            </button>
          </div>
        </div>
        <div className="space-y-4 animate-section-delayed">
          <InfoCard
            tone="sand"
            title="Pourquoi préparer le contexte ?"
            description="Les modèles génératifs exploitent la requête pour hiérarchiser les informations. Un canevas clair limite les extrapolations et facilite la comparaison entre configurations."
            items={[
              "Mentionnez le public cible et la forme attendue du rendu.",
              "Citez 2 à 3 notions incontournables à conserver.",
              "Indiquez le temps dont vous disposez pour exploiter le résultat.",
            ]}
          />
          <InfoCard
            tone="white"
            title="Repère IA"
            description="Une IA générative ne sait pas pourquoi vous lui parlez — elle déduit tout de votre requête. Investir 2 minutes dans le cadrage augmente drastiquement la qualité des réponses."
          />
        </div>
      </section>
      <div className="section-divider" />
      <section className="grid gap-4 animate-section md:grid-cols-3">
        <InfoCard
          tone="red"
          title="Biais cognitifs"
          description="L’IA peut amplifier vos premières hypothèses. Variez vos formulations pour dévoiler d’autres angles d’analyse."
        />
        <InfoCard
          tone="black"
          title="Transparence"
          description="Surveillez les indices de confiance et les sources proposées. Ils orientent vos validations manuelles."
        />
        <InfoCard
          tone="sand"
          title="Compagnon, pas pilote"
          description="Gardez la main : l’IA accélère l’exploration, mais la sélection finale vous appartient."
        />
      </section>
    </div>
  );
}

export default StepOne;
