# Finanzhelfer

Finanzübersicht als Web-App/PWA: Konten, Umsätze, Depot, Verträge. **Deutsch ist die
Quellsprache** (Code, Kommentare, Commits, Oberfläche) – wie bei WasGegessen? gibt es
**keine** englische Fassung.

## Live

- **Seite:** https://rianvegeta1991.github.io/finanzhelfer/
- **Repo:** https://github.com/rianvegeta1991/finanzhelfer
- Deploy = `git push origin main` → Workflow `.github/workflows/pages.yml` stellt die
  Seite über **GitHub Actions** online (nicht „Deploy from a branch"). Deploy von Hand:
  `gh workflow run pages.yml`.

## Version

`const APP_VERSION` in `app.js`, klein unten in „Mehr". **Bei jedem veröffentlichten
Update die minor-Zahl um 1 erhöhen** – als ganze Zahl weiterzählen, nach 1.9 kommt 1.10.

**Drei Stellen hängen an der Versionsnummer und müssen zusammen geändert werden:**
1. `APP_VERSION` in `app.js`
2. `?v=1.0` an den **acht** Skript-Tags in `index.html`
3. dieselben `?v=`-Werte in der `ASSETS`-Liste von `sw.js` **plus** `CACHE` hochzählen

Ohne Schritt 2 behalten Besucher nach einem Update alte JavaScript-Dateien (GitHub
Pages schickt `max-age=600`). Ohne Schritt 3 liegen die Skripte doppelt im Cache.

**Beim lokalen Testen** hält der Service Worker die alten Dateien fest – `serve.ps1`
schickt zwar `no-store`, der SW bedient die Seite aber aus seinem Cache. Vor dem Prüfen
einer Änderung deshalb im Browser:
`(await navigator.serviceWorker.getRegistrations()).forEach(r=>r.unregister()); (await caches.keys()).forEach(k=>caches.delete(k)); location.reload()`

## Aufbau

Kein Node, kein Build. Eine HTML-Datei plus acht Skripte, alle global (kein
Modulsystem, keine IIFE) – `ansichten.js` und `app.js` rufen sich gegenseitig auf,
deshalb steht `ansichten.js` **vor** `app.js` im Markup.

| Datei | Inhalt |
|---|---|
| `index.html` | Markup + komplettes CSS |
| `daten.js` | `KATEGORIEN`, `REGELN`, `TURNUS`, `KONTOARTEN`, Formatierung, Datumsrechnung |
| `speicher.js` | `localStorage`, AES-GCM/PBKDF2, CSV-Bau, Datei-Download |
| `import.js` | CSV/CAMT/MT940, `kategorieRaten`, `wiederkehrendeFinden` |
| `dateien.js` | Excel (.xlsx) und PDF als Tabelle: ZIP, Blätter, PDF-Textlayout |
| `banking.js` | Brücken-Anbindung, `beispieldatenLaden` |
| `kurse.js` | Marktdaten, Wechselkurse, `posWert`/`posGuv`/`depotWert` |
| `ansichten.js` | Umsätze, Depot, Verträge, Mehr, Import, Export, Info-Texte |
| `app.js` | Gerüst, Zeitraum, Auswertung, SVG-Diagramme, Überblick, `starten()` |

### Bildschirme
Fünf Bereiche (`s-ueberblick`, `s-umsaetze`, `s-depot`, `s-vertraege`, `s-mehr`) plus
sechs Overlays (`ov-zeit`, `ov-umsatz`, `ov-konto`, `ov-pos`, `ov-vertrag`, `ov-import`,
`ov-info`). Umgeschaltet über `zeigeAnsicht`, gezeichnet über `neuZeichnen`.

**Alle Klicks laufen über einen einzigen Fänger** am `document`: Knöpfe tragen
`data-tun="befehl:argument"`, `tunAusfuehren` verteilt. Getrennt wird am **ersten**
Doppelpunkt – Vorschlags-Signaturen enthalten selbst welche.

`ov-info` dient doppelt: als Info-Fenster (`infoZeigen`) und als Rückfrage (`frage`).
`confirm()` wird bewusst nicht benutzt – in der installierten PWA sieht das fremd aus.

### Speicher
Genau **einer** von zwei `localStorage`-Schlüsseln ist belegt, nie beide:
`finanzhelfer-daten` (Klartext) **oder** `finanzhelfer-tresor` (`{salt,iv,ct}`,
AES-256-GCM, Schlüssel per PBKDF2 mit 310 000 Runden). Beim Sperren wird der Klartext
gelöscht, beim Aufheben der Tresor – sonst läge eine offene Kopie herum, obwohl die App
„verschlüsselt" anzeigt. Die Passphrase wird nirgends abgelegt.

`sichern()` schreibt gesammelt nach 250 ms, `sichernJetzt()` sofort (vor dem Sperren,
bei `pagehide` und `visibilitychange`).

### Kategorien und Vorzeichen
`art` einer Kategorie steuert die Auswertung:
`ein`/`aus` zählen normal, **`spar`** (Sparen & Anlage) wird eigens ausgewiesen statt als
Ausgabe, **`neutral`** (Umbuchung) fällt ganz heraus – sonst stünde dieselbe Summe als
Ausgabe *und* Einnahme in der Bilanz. Das muss so bleiben.

Negativer Betrag = Abbuchung, durchgehend. Bei **Schuldkonten** (`kontoart().schuld`,
also Kreditkarte und Kredit) ist der gespeicherte Saldo die **offene Summe als positive
Zahl**; `saldoAendern` dreht dort das Vorzeichen, und im Vermögen wird abgezogen.

### Kontostand
Nur **von Hand erfasste** Buchungen ziehen den Kontostand mit (`quelle:'manuell'`).
Import und Brückenabruf lassen ihn in Ruhe – sonst würde doppelt gezählt, weil der
Auszug den Stand ohnehin schon enthält. Beim Bearbeiten wird der alte Betrag
zurückgebucht und der neue gebucht, auch über einen Kontowechsel hinweg.

### Import
`impCsvLesen` liefert **Rohtabelle plus Vorschlag**, nicht fertige Umsätze – die
Zuordnung lässt sich im Importfenster umstellen. `csvVorschlag` sucht in **drei
Durchgängen** (genau → Anfang → irgendwo): ohne diese Reihenfolge schnappt sich
„Lastschrift Ursprungsbetrag" den Platz von „Betrag", und dann kommt nichts an.

Dubletten laufen über `umsatzSignatur` (Konto, Datum, Betrag, Anfang von Gegenseite und
Zweck). Kontoauszüge tragen keine stabile ID, deshalb dieser Fingerabdruck.

Dateien werden erst als UTF-8 gelesen; tauchen Ersatzzeichen auf, nochmal als
Windows-1252 – Sparkasse und Volksbank liefern das bis heute.

### Excel und PDF (`dateien.js`)
Erkannt wird am **Dateianfang**, nicht an der Endung. Beide Formate werden auf
dieselbe Form gebracht wie eine CSV (`{kopf, zeilen}`, über `tabelleAusMatrix`) und
laufen danach durch dieselbe Spaltenzuordnung und Vorschau – deshalb weiß nichts
dahinter, woher die Tabelle kam. Ausgepackt wird mit `DecompressionStream`, ohne
fremde Bibliothek.

- **xlsx** ist ein ZIP: gelesen über das zentrale Verzeichnis am Dateiende (im
  lokalen Kopf stehen die Größen nicht verlässlich). Datumszellen erkennt
  `xlsxDatumStile` am Zahlenformat. **Zahlen stehen in der Datei immer englisch** und
  werden von `xlsxZahl` auf deutsche Schreibweise gedreht – sonst macht die
  Tausenderpunkt-Regel von `impZahl` aus 142.765 Anteilen 142 765.
- **PDF**: Objekte scannen → Ströme auspacken → Textbefehle ausführen und dabei
  Position merken (`pdfStuecke`) → aus den x-Werten Spalten rekonstruieren.
  Zwei Rekonstruktionen (`pdfAlsSpalten` und die Notlösung `pdfAlsZeilentext`)
  treten gegeneinander an, `tabelleGuete` kürt die bessere. Teilmengen-Schriften
  brauchen die ToUnicode-CMap, sonst kommt Buchstabensalat.
- Das alte `.xls`, verschlüsselte PDFs und Scans laufen in eine klare Fehlermeldung.
  Eingebaut ist kein OCR und soll keines vortäuschen.

### Vertragserkennung
`wiederkehrendeFinden` gruppiert Abbuchungen nach normalisierter Gegenseite und
verlangt: **mindestens drei** Buchungen, Beträge höchstens 15 % um den Schnitt, Abstände
regelmäßig und auf einen Turnus passend (`turnusAusTagen`). Abgelehnte Vorschläge landen
als Signatur in `db.erledigt` und kommen nicht wieder.

### Diagramme
Handgeschriebenes SVG in `app.js`: `ringSvg` (Donut über `stroke-dasharray`),
`balkenSvg`, `linieSvg`. Beschriftet wird **vom Ende her** gezählt, damit der aktuelle
Abschnitt immer eine Marke trägt. `skalaStufe` zielt auf drei bis vier Gitterlinien.

Der Verlauf wird **rückwärts** gerechnet: vom heutigen Kontostand die späteren
Buchungen abziehen. Nur so passt die Kurve zum angezeigten Vermögen.

Die Kurve ist über Chips umstellbar (`VERLAUF_REIHEN`, gespeichert in
`db.einst.verlaufReihe`): **Guthaben**, **Depot**, **Gesamtvermögen**. Konten lassen
sich exakt zurückrechnen, **das Depot nicht** – dafür gibt es nur die tägliche
Aufzeichnung seit v1.9. Punkte aus der Zeit davor tragen deshalb `geschaetzt` und
werden unter dem Diagramm auch so benannt; eine Depotkurve aus einem einzigen Tag
wird gar nicht erst gezeichnet, sondern durch den Hinweis ersetzt. Diese Ehrlichkeit
bitte nicht wegoptimieren – eine schnurgerade Linie würde das Gegenteil behaupten.

Weitere Karten im Überblick: **Vermögensaufbau** (`deltaBalkenSvg`, Veränderung je
Abschnitt um eine Nulllinie), **Woraus besteht das Vermögen?** (Ring über die einzelnen
Konten und Depots, Stand heute) und **Kennzahlen** (Sparquote, Fixkostenquote,
Reichweite, Schuldenquote). Die Kennzahlen rechnen immer in **Monaten**
(`reiheAbschnitte(12, 'monat')`) und nur aus Monaten mit Buchungen – sonst zieht die
leere Zeit vor dem ersten Import jeden Schnitt nach unten. `.kacheln` ist ein
Dreier-Raster: eine vierte Kachel stünde allein in der zweiten Reihe.

## Bankanbindung – die wichtigste Festlegung

Eine Seite im Browser **kann und darf** Konten nicht direkt abrufen: FinTS ist kein
Browser-Protokoll, Aggregatoren brauchen ein Client-Secret und liefern kein CORS, und
PSD2-Direktzugriff verlangt eine BaFin-Zulassung. Das steht in `banking.js` oben
ausführlich und in der App unter *Mehr → Bankkonten anbinden*.

Deshalb: **Auszug einlesen** (immer) oder **eigene Brücke** – ein Dienst des Nutzers mit
`GET /konten`, `GET /umsaetze?konto=&von=` und optional `GET /positionen`, Bearer-Token,
CORS. Diese Schnittstelle nicht stillschweigend ändern, sie ist in README und App
dokumentiert.

## Marktdaten

Abgefragt wird über das **Börsenkürzel**, nicht über die ISIN – eine kostenlose,
verlässliche ISIN-Auflösung gibt es nicht. Aktien/ETFs brauchen einen eigenen Schlüssel
(Twelve Data, Finnhub, Alpha Vantage); **Krypto (CoinGecko) und Wechselkurse
(frankfurter.app) gehen ohne**. Zwischen den Abfragen liegen 900 ms, weil die
Gratisstufen pro Minute zählen.

## Entwicklungsumgebung

- **Kein Node, kein Python.** Lokaler Server: `serve.ps1` (PowerShell-`HttpListener`).
- Port **8797**, Eintrag `finanzhelfer` in `../.claude/launch.json`.
- Icons: `icons.ps1` zeichnet die PNGs mit `System.Drawing` nach den SVG-Vorlagen nach.
  **Bei Logoänderungen `icon.svg`, `icon-maskable.svg` und `icons.ps1` zusammen ändern.**
  Achtung PowerShell 5.1: verschachtelte Arrays werden still verflacht – die Punktliste
  steht deshalb als zwei flache Listen (`$px`/`$py`) da.

## Fallstricke (aus Erfahrung)

- **Der Service Worker liefert beim lokalen Testen alte Dateien** – siehe oben unter
  „Version". Das kostet sonst jedes Mal eine Viertelstunde Ratlosigkeit.
- **Zeilen in `.zeile` bestehen aus `<span>`.** `.tit`/`.sub`/`.betrag` brauchen deshalb
  `display:block`, sonst laufen Titel und Unterzeile ineinander und sprengen die Karte.
- **Screenshots treffen oft die Overlay-Animation** und zeigen den Inhalt halb
  durchsichtig. Kein Fehler – einfach ein zweites Mal aufnehmen.
- `toISOString()` schiebt in unserer Zeitzone auf den Vortag. Dafür gibt es `isoTag()`.
- Beim Neuzeichnen einer Ansicht mit Eingabefeldern `mitFokus()` benutzen, sonst
  springt der Schreibcursor bei jedem Tastendruck heraus.

## Testen

Verifizieren statt hoffen: Server starten (`preview_start`), im mobilen Viewport
(375×812) prüfen, Konsole auf Fehler checken, Zustand per DOM auslesen. Parser und
Verschlüsselung lassen sich direkt über `javascript_tool` prüfen – `impCsvLesen`,
`impCamt`, `impMt940`, `sperreEinrichten`/`entsperren` sind alle global.
