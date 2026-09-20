# Finanzhelfer

Eine zentrale Übersicht über Einnahmen, Ausgaben, Vermögen und laufende Verträge –
fürs Handy und den Browser.

**Live:** https://rianvegeta1991.github.io/finanzhelfer/

Alles läuft im Browser. Es gibt kein Konto und keinen Server: deine Finanzdaten liegen
auf deinem Gerät und verlassen es nicht.

## Was die App kann

### Konten und Umsätze
- Mehrere Konten und Banken gleichzeitig: Giro, Tages-/Festgeld, Bargeld, Kreditkarte, Kredit
- **Kontoauszüge einlesen** – CSV, CAMT.053 (XML) und MT940. Spalten, Trennzeichen und
  Zahlenformat erkennt die App selbst; die Zuordnung lässt sich beim Import umstellen
- **Automatische Kategorisierung** in 26 Kategorien, mit über 300 hinterlegten Stichwörtern
  (REWE → Lebensmittel, Shell → Mobilität, Netflix → Abos …)
- Jede Kategorie lässt sich von Hand ändern; auf Wunsch wird daraus eine eigene Regel,
  die alle passenden Buchungen gleich mit umsortiert
- Doppelte Buchungen werden erkannt und übersprungen – derselbe Monat darf zweimal rein
- Buchungen auch von Hand erfassen; sie ziehen den Kontostand mit
- Suche über Empfänger, Zweck und Betrag, Filter nach Kategorie und Konto

### Depot
- Positionen mit ISIN, WKN, Stückzahl und Einstandskurs
- **Automatischer Kursabruf** über Twelve Data, Finnhub oder Alpha Vantage (eigener
  kostenloser Schlüssel); Krypto über CoinGecko und Wechselkurse über frankfurter.app
  ganz ohne Schlüssel
- Kurse lassen sich jederzeit von Hand pflegen – dann braucht es gar keinen Dienst
- Gesamtwert, Gewinn/Verlust und Rendite je Position und insgesamt, Aufteilung als Ring
- Fremdwährungen werden mit dem Tageskurs in Euro umgerechnet

### Verträge und Abos
- Name, Anbieter, Betrag, Turnus, Kategorie, nächste Abbuchung, Kündigungsfrist
- **Wiederkehrende Abbuchungen werden erkannt** und als Vertrag vorgeschlagen – gesucht
  wird nach gleicher Gegenseite mit ähnlichem Betrag in regelmäßigem Abstand
- Aus Vertragsende und Frist rechnet die App den letzten Kündigungstag aus und erinnert
  vorher – im Überblick, als Zähler an der Fußleiste und auf Wunsch als Systemmeldung
- Fixkosten pro Monat und pro Jahr, aufgeschlüsselt nach Kategorie

### Überblick
- Gesamtvermögen = Konten + Depots − Verbindlichkeiten
- Einnahmen, Ausgaben und Saldo je Zeitraum, Verlauf über 12 Abschnitte als Balken
- Kategorienauswertung als Ring; ein Tipp springt in die gefilterte Liste
- Verlauf des Guthabens über die Zeit
- Zeitraum frei wählbar (Monat, Quartal, Jahr, alles oder von–bis), dazu ein Kontenfilter

### Sicherheit
- **Optionale Verschlüsselung** mit AES-256-GCM. Der Schlüssel entsteht per PBKDF2
  (310 000 Runden, SHA-256) aus einer Passphrase und wird nirgends gespeichert
- Selbstsperre nach einstellbarer Zeit ohne Eingabe
- Ist die Sperre aktiv, liegt kein Klartext mehr im Speicher – auch nicht als Rest

### Export
- CSV für Umsätze, Depot und Verträge (Semikolon und Komma, öffnet direkt in Excel)
- Bericht für den gewählten Zeitraum als PDF über „Als PDF speichern“ im Druckdialog
- Vollständige Sicherung als JSON, die sich auch wieder einlesen lässt

## Warum keine direkte Bankanbindung?

Das ist die häufigste Frage, deshalb hier ausführlich:

Eine Seite, die im Browser läuft, **kann und darf** Bankkonten nicht selbst abrufen.

- **FinTS/HBCI** ist kein Browser-Protokoll. Es braucht einen Prozess auf dem Rechner,
  der eigene Nachrichtenformate spricht.
- **Open-Banking-Aggregatoren** (Tink, Plaid, TrueLayer, Salt Edge, finAPI, Nordigen)
  verlangen ein geheimes Client-Secret und erlauben keine Zugriffe direkt aus einer
  fremden Seite. Ein Secret in einer öffentlichen Seite ist veröffentlicht.
- Für den direkten Kontozugriff nach **PSD2** braucht man eine BaFin-Zulassung als
  Kontoinformationsdienst oder einen Vertrag mit einem zugelassenen Anbieter.

Deshalb zwei Wege, die wirklich funktionieren:

**1. Auszug einlesen.** Aus dem Online-Banking herunterladen, hier einlesen. Das deckt
Kategorisierung, Vertragserkennung und alle Auswertungen vollständig ab.

**2. Eigene Brücke.** Ein kleiner Dienst bei dir – etwa mit
[python-fints](https://github.com/raphaelm/python-fints), `aqbanking` oder einem
Aggregator-Zugang – stellt zwei Endpunkte bereit, und die App ruft regelmäßig dort ab:

```
GET /konten
→ [{"ref":"DE02…","name":"Girokonto","bank":"Sparkasse","iban":"DE02…",
    "art":"giro","saldo":1234.56,"waehrung":"EUR"}]

GET /umsaetze?konto=REF&von=YYYY-MM-DD
→ [{"datum":"2026-09-01","betrag":-42.90,"gegen":"Netflix",
    "zweck":"Abo September","waehrung":"EUR"}]

GET /positionen            (freiwillig, fürs Depot)
→ [{"name":"…","isin":"…","symbol":"…","stueck":42,"einstand":98.4,
    "kurs":118.62,"waehrung":"EUR","art":"etf"}]
```

Beide Aufrufe tragen `Authorization: Bearer <Token>`. Die Brücke muss CORS für die
Herkunft der App erlauben. Negativer Betrag heißt Abbuchung, zusätzliche Felder werden
ignoriert. Adresse und Token stehen unter *Mehr → Automatischer Abruf*; dort gibt es
auch einen Knopf, der die Verbindung prüft und die gefundenen Konten auflistet.

## Installieren

Die Seite ist eine PWA: im Browser aufrufen und über „Zum Startbildschirm hinzufügen“
(iPhone: Teilen-Menü) installieren. Danach läuft sie offline wie eine normale App – nur
Kursabruf und der automatische Kontoabruf brauchen Internet.

## Entwicklung

Kein Node, kein Build-Schritt. Eine HTML-Datei und sechs JavaScript-Dateien.

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8797
```

Dann http://localhost:8797 aufrufen.

| Datei | Inhalt |
|---|---|
| `index.html` | Markup und das komplette CSS |
| `daten.js` | Kategorien, Erkennungsregeln, Turnus, Formatierung |
| `speicher.js` | `localStorage`, Verschlüsselung, CSV-Bau |
| `import.js` | CSV/CAMT/MT940 lesen, Kategorisieren, Wiederkehrendes finden |
| `banking.js` | Brücken-Anbindung und Beispieldaten |
| `kurse.js` | Marktdaten, Wechselkurse, Depotrechnung |
| `ansichten.js` | Umsätze, Depot, Verträge, Mehr, Import, Export |
| `app.js` | Gerüst, Zeitraum, Auswertung, Diagramme, Überblick |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `icons.ps1` | zeichnet die PNG-Icons nach den SVG-Vorlagen |

Gespeichert wird im `localStorage` unter `finanzhelfer-daten` (offen) bzw.
`finanzhelfer-tresor` (verschlüsselt) – nie beides zugleich.

Diagramme sind handgeschriebenes SVG, ohne Bibliothek.

## Was noch fehlt

- Budgets je Kategorie mit Warnung bei Überschreitung
- Abgleich zwischen mehreren Geräten
- Splittbuchungen (eine Zahlung auf mehrere Kategorien verteilen)

## Automatischer Abruf: die Brücke

Für den regelmäßigen, selbsttätigen Abruf gibt es ein zweites Programm, das auf
deinem Rechner läuft: **[finanzhelfer-bruecke](https://github.com/rianvegeta1991/finanzhelfer-bruecke)**.

Es spricht FinTS mit deiner Bank (ING, Commerzbank, Sparkassen, Volksbanken …),
die offizielle API von Bitvavo und – über das Fremdwerkzeug `pytr` – auch Trade
Republic, und bedient genau die drei Endpunkte von oben. Eingerichtet wird es in
der App unter *Mehr → Automatischer Abruf*.
