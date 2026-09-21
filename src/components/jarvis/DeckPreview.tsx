// Podgląd prezentacji — slajdy rysowane w przeglądarce wprost z DeckSpec.
//
// CO TO ZASTĄPIŁO. Wcześniej .pptx nie dało się pokazać w przeglądarce, więc
// Forge renderował każdą prezentację DRUGI RAZ, do PDF-a, i to jego wyświetlał
// <iframe>. Kosztowało to drugi pełny render przy każdym pliku, drugi obiekt
// w storage, przebudowę tego obiektu po dociągnięciu obrazów — i utrzymywanie
// całego renderera PDF wraz z osadzaniem fontów wyłącznie na potrzeby
// podglądu. Tutaj nie ma renderu: jest specyfikacja, która i tak leży w bazie,
// i te same tokeny motywu, z których korzysta renderer pptx.
//
// CZEGO TU NIE MA, ŚWIADOMIE: zdjęć. Grafiki żyją zaszyte w bajtach .pptx, a
// nie osobno w storage — podgląd pokazuje więc ramkę z opisem tematu zdjęcia
// zamiast samego zdjęcia. To jest realny ubytek wobec starego podglądu PDF i
// nie ma sensu go ukrywać: ramka mówi wprost, co w tym miejscu jest w pliku.
//
// Geometria jest ŚWIADOMIE przybliżona. Dokładne współrzędne w calach zostają
// w rendererze pptx — to on produkuje plik i on jest źródłem prawdy. Tutaj
// odtwarzamy ten sam układ w procentach, żeby podgląd czytał się jak
// prezentacja, a nie żeby udawać renderer. Próba trzymania jednych
// współrzędnych dla obu skończyłaby się tym, czego chcieliśmy uniknąć:
// sprzęgnięciem dwóch różnych problemów w jeden kod.
import { ImageIcon } from "lucide-react";

import { cssColor, DOC_COLORS, DOC_FONTS } from "@/lib/agents/docTheme";
import type { DeckSpec, DeckSlide } from "@/lib/agents/docSpec";

/** Slajd trzyma proporcje 16:9 niezależnie od szerokości kontenera. */
const Slide = ({ children, dark }: { children: React.ReactNode; dark?: boolean }) => (
  <div
    className="relative w-full overflow-hidden rounded-lg shadow-lg"
    style={{
      aspectRatio: "16 / 9",
      background: cssColor(dark ? DOC_COLORS.dark : DOC_COLORS.paper),
      fontFamily: DOC_FONTS.cssStack,
    }}
  >
    {children}
  </div>
);

/** Miejsce po zdjęciu, którego podgląd nie ma — z tematem, o który poproszono. */
const ImageSlot = ({ subject }: { subject: string }) => (
  <div
    className="flex h-full w-full flex-col items-center justify-center gap-2 rounded p-3 text-center"
    style={{ background: cssColor(DOC_COLORS.surface) }}
  >
    <ImageIcon className="h-6 w-6 shrink-0" style={{ color: cssColor(DOC_COLORS.muted) }} />
    <span
      className="min-w-0 break-words text-[10px] leading-snug"
      style={{ color: cssColor(DOC_COLORS.muted) }}
    >
      {subject}
    </span>
  </div>
);

function TitleSlide({ spec }: { spec: DeckSpec }) {
  const heroSubject = spec.heroImageQuery ?? spec.heroImagePrompt;
  return (
    <Slide dark>
      <div className="flex h-full">
        <div className="flex min-w-0 flex-1 flex-col justify-center px-[6%]">
          <div
            className="mb-[3%] h-[3px] w-[12%]"
            style={{ background: cssColor(DOC_COLORS.accent) }}
          />
          <h2
            className="min-w-0 break-words text-[clamp(14px,3.2cqw,34px)] leading-tight font-semibold"
            style={{ color: cssColor(DOC_COLORS.paper) }}
          >
            {spec.title}
          </h2>
          {spec.subtitle && (
            <p
              className="mt-[2%] min-w-0 break-words text-[clamp(9px,1.4cqw,15px)]"
              style={{ color: cssColor(DOC_COLORS.muted) }}
            >
              {spec.subtitle}
            </p>
          )}
          <p
            className="mt-[4%] text-[clamp(7px,1cqw,11px)] tracking-[0.2em] uppercase"
            style={{ color: cssColor(DOC_COLORS.muted) }}
          >
            {spec.slides.length} slajdów
          </p>
        </div>
        {heroSubject && (
          <div className="w-[38%] shrink-0 p-[2%]">
            <ImageSlot subject={heroSubject} />
          </div>
        )}
      </div>
    </Slide>
  );
}

function ContentSlide({
  slide,
  index,
  total,
  deckTitle,
}: {
  slide: DeckSlide;
  index: number;
  total: number;
  deckTitle: string;
}) {
  const subject = slide.imageQuery ?? slide.imagePrompt;
  // Zdjęcie raz z lewej, raz z prawej — dokładnie tak, jak robi to renderer
  // pptx. Slajdy z obrazem zawsze w tym samym miejscu czytają się jak
  // odbitka z szablonu (czym, strukturalnie, są).
  const imageOnLeft = subject ? index % 2 === 1 : false;
  const text = (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-[2%]">
      <h3
        className="min-w-0 break-words text-[clamp(11px,2.1cqw,24px)] leading-tight font-semibold"
        style={{ color: cssColor(DOC_COLORS.dark) }}
      >
        {slide.heading}
      </h3>
      {slide.content && (
        <p
          className="min-w-0 break-words text-[clamp(8px,1.2cqw,13px)] leading-relaxed"
          style={{ color: cssColor(DOC_COLORS.body) }}
        >
          {slide.content}
        </p>
      )}
      {slide.bullets && slide.bullets.length > 0 && (
        <ul className="min-w-0 space-y-[1%]">
          {slide.bullets.map((b, i) => (
            <li
              key={i}
              className="flex min-w-0 gap-2 text-[clamp(8px,1.2cqw,13px)] leading-snug"
              style={{ color: cssColor(DOC_COLORS.body) }}
            >
              <span style={{ color: cssColor(DOC_COLORS.accent) }}>•</span>
              <span className="min-w-0 break-words">{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Slide>
      <div
        className="absolute inset-y-0 left-0 w-[1.3%]"
        style={{ background: cssColor(DOC_COLORS.accent) }}
      />
      <div className="flex h-full items-stretch gap-[3%] pt-[6%] pr-[4%] pb-[4%] pl-[6%]">
        {imageOnLeft && subject && (
          <div className="w-[33%] shrink-0">
            <ImageSlot subject={subject} />
          </div>
        )}
        {text}
        {!imageOnLeft && subject && (
          <div className="w-[33%] shrink-0">
            <ImageSlot subject={subject} />
          </div>
        )}
      </div>
      <div
        className="absolute top-[3%] right-[4%] text-[clamp(6px,0.9cqw,10px)] tracking-widest"
        style={{ color: cssColor(DOC_COLORS.muted) }}
      >
        {deckTitle.toUpperCase()} · {String(index + 2).padStart(2, "0")}/
        {String(total).padStart(2, "0")}
      </div>
      <div
        className="absolute top-[4%] left-[4%] flex h-[7%] w-[3.5%] items-center justify-center text-[clamp(6px,0.9cqw,10px)] font-semibold"
        style={{ background: cssColor(DOC_COLORS.accent), color: cssColor(DOC_COLORS.paper) }}
      >
        {index + 1}
      </div>
    </Slide>
  );
}

export function DeckPreview({ spec }: { spec: DeckSpec }) {
  const total = spec.slides.length + 1;
  return (
    // @container: slajdy skalują typografię do SZEROKOŚCI TEGO KONTENERA
    // (jednostki cqw wyżej), a nie do orientacji urządzenia — panel podglądu
    // bywa wąski na szerokim ekranie i odwrotnie.
    <div className="@container no-scrollbar h-full space-y-4 overflow-x-hidden overflow-y-auto p-4">
      <TitleSlide spec={spec} />
      {spec.slides.map((slide, i) => (
        <ContentSlide key={i} slide={slide} index={i} total={total} deckTitle={spec.title} />
      ))}
      <p className="pb-2 text-center text-[10px] text-muted-foreground">
        Podgląd układu i treści. Zdjęcia są w pobranym pliku — tutaj zaznaczone ramką.
      </p>
    </div>
  );
}
