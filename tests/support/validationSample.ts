/**
 * A hand-labelled sample: for each entry, whether a careful teacher would want a warning, judged from
 * knowledge of German and not from this dictionary. `fix` is the correction expected among the offers.
 * Written by the developer, so it is a check of plausibility and not an independent gold standard.
 */
export interface Sample {
  german: string;
  article: string;
  turkish: string;
  /** A real problem the checker should raise. */
  flag: boolean;
  fix?: string;
}

const clean = (text: string): Sample[] =>
  text.trim().split('\n').map((line) => {
    const [german, article, turkish] = line.split(';');
    return { german: german!, article: article!, turkish: turkish ?? 'x', flag: false };
  });
const wrong = (text: string): Sample[] =>
  text.trim().split('\n').map((line) => {
    const [german, article, fix, turkish] = line.split(';');
    return { german: german!, article: article!, turkish: turkish ?? 'x', flag: true, fix: fix! };
  });

export const SAMPLE: readonly Sample[] = [
  // Right as written: nouns.
  ...clean(`Geldautomat;der
Moos;das
Chor;der;koro
Bank;die
See;der;göl
See;die;deniz
Mutter;die
Vater;der
Kind;das
Mädchen;das
Mädchen;die
Tisch;der
Lampe;die
Fenster;das
Straße;die
Fuß;der
Maß;das
Tür;die
Käse;der
Bücher;die
Äpfel;die
Kinder;die
Eltern;die
Leute;die
Ferien;die
Essen;das
Leben;das
Gehen;das
Erwachsene;der
Erwachsene;die
Beamte;der
Deutsche;der
Deutsche;die
Messer;das
Messer;die
Teil;der
Teil;das
Band;das
Band;der
Band;die
Leiter;die
Leiter;der
Tor;das
Tor;der
Kiefer;der
Kiefer;die
Gehalt;das
Gehalt;der
Steuer;die
Steuer;das
Vier;die
Sechs;die
Handy;das
E-Mail;die
Krankenhaus;das
Kühlschrank;der
Geburtstag;der
Hausaufgabe;die
Regenschirm;der
Universität;die
Fahrrad;das
Hauptbahnhof;der
Wörterbuch;das
Weg;der`),
  // Right as written: a compound the dictionary may not list.
  ...clean(`Küchentischlampe;die
Fahrradschlüsselanhänger;der
Schulbuchregal;das
Apfelkuchenrezept;das
Bahnhofsuhr;die
Sommerferienplan;der`),
  // Right as written: other words.
  ...clean(`essen;
gehen;
schön;
sehr;
und;
aber;
ich;
Hallo;
Danke;
Was?;
Wie?;
Tschüss!;
morgen;
Morgen;der
heute;
Deutschland;
Berlin;
gut;
gehst;
ging;
gegangen;
schönere;
meine;
dir;
wachsen;
weiß;
Auf Wiedersehen!;
Grüß Gott!;
kennenlernen;
einkaufen;
Delphin;der
Delfin;der
Phantasie;die
Fantasie;die
Yacht;die
Jacht;die`),
  // A name or a word this dictionary may not know: no warning about something it cannot judge.
  ...clean(`Kaan;
Ayşe;
Schnitzelparadies;das`),
  // Wrong article.
  ...wrong(`Geldautomat;das;der Geldautomat
Moos;der;das Moos
Tisch;das;der Tisch
Lampe;der;die Lampe
Kind;der;das Kind
Mutter;der;die Mutter
Haus;die;das Haus
Auto;der;das Auto
Schule;das;die Schule
Zeit;der;die Zeit
Tag;das;der Tag;gün
Eltern;der;die Eltern
Kühlschrank;das;der Kühlschrank
Krankenhaus;der;das Krankenhaus
Universität;der;die Universität`),
  // The meaning points at the other gender.
  ...wrong(`Chor;das;der Chor;koro
See;die;der See;göl
See;der;die See;deniz
Reis;das;der Reis;pirinç`),
  // No article on a noun.
  ...wrong(`Tisch;;der Tisch
Lampe;;die Lampe
Kühlschrank;;der Kühlschrank
Krankenhaus;;das Krankenhaus`),
  // Written small.
  ...wrong(`essen;das;das Essen
apfel;der;der Apfel
tisch;der;der Tisch
tür;;die Tür
kühlschrank;;der Kühlschrank`),
  // Not a noun.
  ...wrong(`schnell;das;schnell
gehen;der;das Gehen`),
  // Misspelled.
  ...wrong(`Geldautmat;der;der Geldautomat
Kuehlschrank;der;der Kühlschrank
Strasse;die;die Straße
Tuer;die;die Tür
Maedchen;das;das Mädchen
Fruehstück;das;das Frühstück
Schuele;die;die Schule
Telefn;das;das Telefon
Komputer;der;der Computer
Cafe;das;das Café
Kaffe;der;der Kaffee
Flasce;die;die Flasche
Zietung;die;die Zeitung
Kartofel;die;die Kartoffel
Freund1n;die;die Freundin
wunderbahr;;wunderbar
schoen;;schön
vieleicht;;vielleicht
Fahrad;das;das Fahrrad
Bibliotek;die;die Bibliothek`),
  // Spelling no longer valid.
  ...wrong(`Fluß;der;der Fluss
daß;;dass
Tolpatsch;der;der Tollpatsch`),
];
