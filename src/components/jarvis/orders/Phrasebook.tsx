// ROZMÓWKI — co można powiedzieć J.A.R.V.I.S.-owi, do kliknięcia.
//
// Panel istnieje, bo możliwości, których nie widać, nie istnieją. Stałe
// rozkazy nie mają własnego przycisku ani pola w formularzu głównym: są
// zdaniem, które trzeba wpaść na to, żeby wypowiedzieć. Lista przykładów
// zamienia „czy on to w ogóle umie" w „kliknij i zobacz".
//
// ZDANIA SĄ PRAWDZIWE, NIE POGLĄDOWE. Kliknięcie puszcza je przez
// `routeText` — DOKŁADNIE tę samą drogę, którą idzie mowa z mikrofonu i
// tekst z czatu. Gdyby przykład przestał działać po zmianie w narzędziach,
// przestanie działać także tutaj, zamiast dalej ładnie wyglądać w tabelce.
// Dlatego nie ma tu własnego dopasowywania komend ani skrótu do API.
import { useState } from "react";
import { Play } from "lucide-react";
import { useVoiceCommands } from "@/components/jarvis/VoiceCommandContext";
import { cn } from "@/lib/utils";

type Phrase = {
  text: string;
  /** Co się stanie — jedno zdanie, gdy sam przykład tego nie tłumaczy. */
  note?: string;
};

type Group = {
  title: string;
  /** Po co ta grupa istnieje; czytane przed przykładami, nie po nich. */
  intro: string;
  phrases: Phrase[];
};

const GROUPS: Group[] = [
  {
    title: "Rozkazy // ruch ceny",
    intro:
      "Warunek na zmianę w zadanym oknie. Próg podaje się zawsze dodatni — kierunek niesie samo zdanie.",
    phrases: [
      { text: "Powiadom mnie, gdy Bitcoin spadnie o 5 procent" },
      { text: "Daj znać, jak Ethereum urośnie o 10 procent w ciągu trzech dni" },
      { text: "Odezwij się, jeśli NVIDIA tąpnie o 8 procent w tygodniu" },
      {
        text: "Powiadom mnie, gdy Pb95 ruszy się o 150 złotych na metrze sześciennym",
        note: "Ruch w dowolną stronę — łapie i podwyżkę, i obniżkę.",
      },
    ],
  },
  {
    title: "Rozkazy // poziom ceny",
    intro: "Warunek na samą cenę, bez okna. Prawdziwy tak długo, jak cena zostaje po tej stronie.",
    phrases: [
      { text: "Daj mi znać, kiedy Bitcoin przebije sto tysięcy dolarów" },
      {
        text: "Powiadom mnie, gdy olej napędowy stanieje poniżej 5200",
        note: "Ceny hurtowe są w złotych za metr sześcienny, nie za litr.",
      },
      { text: "Chcę wiedzieć, kiedy CD Projekt spadnie poniżej 180 złotych" },
      { text: "Odezwij się, gdy dolar przekroczy cztery dwadzieścia" },
    ],
  },
  {
    title: "Rozkazy // z terminem",
    intro: "Rozkaz, który sam wygasa. Zostaje na liście z adnotacją, zamiast po cichu zniknąć.",
    phrases: [
      { text: "Obserwuj Solanę przez tydzień i powiedz, gdyby spadła o 10 procent" },
      { text: "Przez najbliższe dziesięć dni pilnuj ceny diesla poniżej 5100" },
    ],
  },
  {
    title: "Co pilnujesz",
    intro: "Przegląd zobowiązań, które system wziął na siebie.",
    phrases: [
      { text: "Co obserwujesz?" },
      { text: "Jakie mam aktywne rozkazy?" },
      { text: "Czy pilnujesz jeszcze Bitcoina?" },
      { text: "Ile razy odpalił się rozkaz na złoto?" },
    ],
  },
  {
    title: "Odwołanie i wyciszenie",
    intro:
      "Wyciszony rozkaz zostaje na liście i da się go włączyć z powrotem. Odwołany znika na dobre.",
    phrases: [
      { text: "Odwołaj rozkaz na Bitcoina" },
      { text: "Przestań pilnować diesla" },
      { text: "Wycisz na razie alert o złocie, ale go nie kasuj" },
    ],
  },
  {
    title: "Prognozy",
    intro:
      "Odpowiedź z własnego typera, policzonego na Twoich notowaniach — nie z ogólnej wiedzy modelu.",
    phrases: [
      { text: "Czy przewidujesz wzrost kursu Bitcoina?" },
      { text: "Co może się wydarzyć z cenami paliw w najbliższych dniach?" },
      { text: "Jaka jest twoja prognoza dla WIG20?" },
      {
        text: "To pilnuj tego i daj znać, jak się sprawdzi",
        note: "Naturalny ciąg dalszy: pytanie o prognozę, a zaraz po nim rozkaz.",
      },
    ],
  },
];

export function Phrasebook() {
  const { routeText } = useVoiceCommands();
  const [busy, setBusy] = useState<string | null>(null);

  async function fire(text: string) {
    if (busy) return;
    setBusy(text);
    try {
      await routeText(text);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-5 @max-[420px]:p-4">
      <p className="min-w-0 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
        Kliknięcie wysyła zdanie tą samą drogą co mikrofon i czat — odpowiedź pojawi się w
        playgroundzie poniżej. Wszystko tutaj można też po prostu powiedzieć, z dowolnego modułu.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-5 @max-[720px]:grid-cols-1">
        {GROUPS.map((group) => (
          <section key={group.title} className="min-w-0">
            <h3 className="font-display text-[9px] uppercase tracking-[0.25em] text-primary">
              {group.title}
            </h3>
            <p className="mt-1 min-w-0 break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
              {group.intro}
            </p>

            <ul className="mt-2.5 space-y-1.5">
              {group.phrases.map((phrase) => (
                <li key={phrase.text} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => void fire(phrase.text)}
                    disabled={busy !== null}
                    className={cn(
                      "flex w-full min-w-0 items-start gap-2 rounded border px-2.5 py-1.5 text-left transition",
                      "border-primary/20 hover:border-primary/50 hover:bg-primary/5",
                      "disabled:opacity-40",
                      busy === phrase.text && "border-primary/60 bg-primary/10",
                    )}
                  >
                    <Play
                      className="mt-0.5 h-3 w-3 shrink-0 text-primary"
                      strokeWidth={2}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 break-words font-mono text-[11px] text-foreground/90">
                      „{phrase.text}"
                      {phrase.note && (
                        <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                          {phrase.note}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-6 min-w-0 rounded border border-primary/15 bg-primary/[0.03] px-3 py-2.5">
        <h3 className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
          czego nie obejmiesz rozkazem
        </h3>
        <ul className="mt-1.5 space-y-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
          <li className="min-w-0 break-words">
            <strong className="text-foreground/80">Nic śróddziennego.</strong> Rozkazy sprawdzają
            nocne joby: rynki o 20:00, paliwa o 7:30 i 15:30 w dni robocze. Najmniejsze okno to
            jeden dzień, bo takie są notowania w cache.
          </li>
          <li className="min-w-0 break-words">
            <strong className="text-foreground/80">Jeden meldunek na dobę z rozkazu.</strong>{" "}
            Warunek „poniżej progu" jest prawdziwy również jutro — bez wyciszenia wracałby w kółko.
          </li>
          <li className="min-w-0 break-words">
            <strong className="text-foreground/80">Tylko ceny.</strong> Rozkaz na news, na zadanie
            albo na zmianę zdania typera jeszcze nie istnieje.
          </li>
          <li className="min-w-0 break-words">
            <strong className="text-foreground/80">Tylko śledzone instrumenty.</strong> Cokolwiek
            spoza słownika zostanie odrzucone z komunikatem, a nie przyjęte po cichu — rozkaz na
            instrument, którego system nie zaciąga, nigdy by się nie wyzwolił.
          </li>
        </ul>
      </div>
    </div>
  );
}
