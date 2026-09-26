/* Finanzhelfer – Konten-Anbindung
 *
 * WICHTIG, damit hier niemand etwas Falsches erwartet:
 * Eine Seite, die im Browser läuft, kann Bankkonten nicht selbst abrufen.
 *   • FinTS/HBCI ist kein Browser-Protokoll (eigene Nachrichtenformate, TLS-Handshake
 *     gegen den Bankserver, Signaturen) – dafür braucht es einen Prozess auf dem Rechner.
 *   • Open-Banking-Aggregatoren (Tink, Plaid, TrueLayer, Salt Edge, finAPI, Nordigen …)
 *     verlangen ein Client-Secret und liefern kein CORS für fremde Seiten. Das Secret
 *     in eine öffentliche Seite zu legen wäre gleichbedeutend mit „veröffentlicht“.
 *   • Für den direkten Zugang zu Kontodaten nach PSD2 braucht man außerdem eine
 *     BaFin-Zulassung als Kontoinformationsdienst oder einen Vertrag mit einem, der sie hat.
 *
 * Deshalb zwei Wege, die wirklich funktionieren:
 *
 * 1. AUSZUG EINLESEN (immer verfügbar, ohne alles Weitere)
 *    CSV, Excel, PDF, CAMT.053 oder MT940 aus dem Online-Banking herunterladen und importieren.
 *    Siehe import.js.
 *
 * 2. EIGENE BRÜCKE (für den automatischen, regelmäßigen Abruf)
 *    Ein kleiner Dienst im eigenen Netz spricht mit der Bank – über python-fints,
 *    aqbanking oder einen Aggregator-Zugang – und stellt zwei Endpunkte bereit.
 *    Die App fragt nur diese beiden ab. Was dahinter steckt, ist ihr gleich; so
 *    lässt sich jede Bank und jeder Aggregator anschließen, ohne die App zu ändern.
 *
 *    GET  {basis}/konten
 *      → [{ "ref":"DE02…", "name":"Girokonto", "bank":"Sparkasse",
 *            "iban":"DE02…", "art":"giro", "saldo": 1234.56, "waehrung":"EUR" }]
 *
 *    GET  {basis}/umsaetze?konto={ref}&von=YYYY-MM-DD
 *      → [{ "datum":"2026-09-01", "betrag":-42.90, "gegen":"Netflix",
 *            "zweck":"Abo September", "waehrung":"EUR" }]
 *
 *    Beide Aufrufe tragen `Authorization: Bearer <Token>`, beide brauchen
 *    `Access-Control-Allow-Origin` für die Herkunft der App. Betrag negativ =
 *    Abbuchung. Zusätzliche Felder werden ignoriert, fehlende Felder sind leer.
 *    Depots gehen über denselben Weg: GET {basis}/positionen (siehe kurse.js).
 *
 * 3. BEISPIELDATEN
 *    Ein halbes Jahr erfundener, aber plausibler Buchungen – zum Ausprobieren,
 *    bevor echte Daten im Spiel sind. Rein lokal erzeugt, kein Netz. */

const BANK_DIENSTE = [
  { id:'auszug',  name:'Kontoauszug einlesen', hinweis:'CSV, Excel, PDF, CAMT.053 oder MT940 aus dem Online-Banking' },
  { id:'bruecke', name:'Eigene Brücke (API)',  hinweis:'Automatischer Abruf über einen eigenen Dienst' },
  { id:'manuell', name:'Nur von Hand',         hinweis:'Saldo und Buchungen selbst pflegen' }
];

/* ---------- Selbsteinrichtung ----------
 * Wird die App von der Brücke selbst ausgeliefert, muss man Adresse, Token
 * und Kennungen nicht abtippen: sie liegen ja schon auf demselben Rechner.
 * `GET /selbst` verrät sie – nur an dieselbe Herkunft, siehe main.rs.
 *
 * Läuft bei jedem Start, legt aber nur an, was fehlt (verglichen über die
 * Kennung). Ein zweiter Aufruf ändert deshalb nichts. */
async function brueckeSelbstEinrichten(){
  let auskunft;
  try {
    const a = await fetch('/selbst', { cache:'no-store' });
    if (!a.ok) return null;
    auskunft = await a.json();
  } catch (e){
    return null;   // keine Brücke dahinter – völlig normal
  }
  if (!auskunft || !auskunft.token) return null;

  const neu = { verbunden:false, konten:[], depots:[] };

  const bisher = db.einst.bruecke || {};
  if (bisher.basis !== location.origin || bisher.token !== auskunft.token){
    db.einst.bruecke = { basis: location.origin, token: auskunft.token };
    neu.verbunden = true;
  }

  (auskunft.konten || []).forEach((k) => {
    if (db.konten.some((x) => x.dienst === 'bruecke' && x.apiRef === k.ref)) return;
    db.konten.push({
      id: neueId(), name: k.name, bank: k.bank, iban:'',
      art: KONTOART_MAP[k.art] ? k.art : 'giro',
      waehrung:'EUR', saldo:0, saldoStand: heute(),
      dienst:'bruecke', apiRef: k.ref,
      farbe: DEPOT_FARBEN[db.konten.length % DEPOT_FARBEN.length]
    });
    neu.konten.push(k.name);
  });

  (auskunft.depots || []).forEach((d) => {
    if (db.depots.some((x) => x.dienst === 'bruecke' && x.apiRef === d.ref)) return;
    db.depots.push({
      id: neueId(),
      name: d.art === 'depot' ? d.name : 'Depot ' + d.name,
      broker: d.bank || d.name, dienst:'bruecke', apiRef: d.ref
    });
    neu.depots.push(d.name);
  });

  if (neu.verbunden || neu.konten.length || neu.depots.length) sichern();
  return neu;
}

/* ---------- Brücke ---------- */

async function brueckeHolen(cfg, pfad, params){
  if (!cfg || !cfg.basis) throw new Error('Keine Adresse für die Brücke hinterlegt.');
  const url = new URL(cfg.basis.replace(/\/+$/, '') + pfad);
  Object.keys(params || {}).forEach((k) => { if (params[k]) url.searchParams.set(k, params[k]); });
  const kopf = { 'Accept':'application/json' };
  if (cfg.token) kopf['Authorization'] = 'Bearer ' + cfg.token;

  const antwort = await fetch(url.toString(), { headers: kopf, mode:'cors', cache:'no-store' });
  if (!antwort.ok) throw new Error('Brücke antwortet mit ' + antwort.status + ' ' + antwort.statusText);
  const daten = await antwort.json();
  if (!Array.isArray(daten)) throw new Error('Die Brücke muss eine Liste liefern.');
  return daten;
}

async function brueckeKonten(cfg){
  const roh = await brueckeHolen(cfg, '/konten');
  return roh.map((k) => ({
    ref: String(k.ref || k.iban || k.id || ''),
    name: k.name || k.bezeichnung || 'Konto',
    bank: k.bank || k.institut || '',
    iban: k.iban || '',
    art: KONTOART_MAP[k.art] ? k.art : 'giro',
    saldo: Number(k.saldo ?? k.balance ?? 0) || 0,
    waehrung: (k.waehrung || k.currency || 'EUR').toUpperCase()
  })).filter((k) => k.ref);
}

/* Holt Buchungen ab dem letzten bekannten Datum. Ein paar Tage Überlappung
 * sind beabsichtigt: Banken buchen rückwirkend nach. Doppelte fängt
 * umsaetzeUebernehmen über die Signatur ab. */
async function brueckeUmsaetze(cfg, konto){
  const letzte = db.umsaetze.filter((u) => u.kontoId === konto.id).map((u) => u.datum).sort();
  // Beim ersten Abruf **kein** `von` mitschicken: dann liefert die Brücke
  // alles, was sie hat. Eine willkürliche Grenze würde die Historie
  // stillschweigend abschneiden, und man merkt es erst Monate später.
  const von = letzte.length ? tageAddieren(letzte[letzte.length - 1], -7) : '';
  const roh = await brueckeHolen(cfg, '/umsaetze', { konto: konto.apiRef, von });
  return roh.map((u) => umsatzBauen({
    kontoId: konto.id,
    datum: impDatum(u.datum || u.date || u.buchungstag),
    betrag: Number(u.betrag ?? u.amount ?? 0) || 0,
    gegen: u.gegen || u.name || u.gegenseite || u.counterparty || '',
    zweck: u.zweck || u.verwendungszweck || u.description || '',
    waehrung: (u.waehrung || u.currency || 'EUR').toUpperCase(),
    quelle: 'api'
  })).filter((u) => u.datum);
}

/* ---------- Lagebericht der Brücke ----------
 * Scheitert ein Abruf, liefert die Brücke weiter ihren letzten guten Stand –
 * aus gutem Grund, sonst wäre bei jedem Aussetzer alles weg. Der Haken: die
 * App merkt davon nichts und zeigt tagelang alte Zahlen, ohne ein Wort zu
 * sagen. Genau das ist mit Trade Republic passiert. `/status` nennt je Quelle
 * den letzten Stand und den Fehler – das wird hier geholt und im Überblick
 * angezeigt. */
let brueckeLage = [];

async function brueckeStatusHolen(){
  const cfg = db.einst.bruecke;
  if (!cfg || !cfg.basis){ brueckeLage = []; return brueckeLage; }
  try {
    brueckeLage = await brueckeHolen(cfg, '/status');
  } catch (e){
    brueckeLage = [];        // ältere Brücken kennen /status nicht – kein Drama
  }
  return brueckeLage;
}

/* Aus dem rohen Fehler einen Satz machen, der sagt, was zu tun ist. Ein
 * Python-Traceback im Überblick hilft niemandem weiter. */
function brueckeFehlerKlartext(text){
  const t = String(text || '');
  if (/EOF when reading a line|input\(|Code:/.test(t))
    return { kurz:'Die Anmeldung ist abgelaufen – sie braucht einmal deinen Bestätigungscode.', anmelden:true };
  // 9952 vor system_id prüfen: weist die Bank die Produkt-ID ab, kommt gar
  // kein Dialog zustande, und python-fints meldet als Folge davon eine
  // fehlende Kundensystem-ID. Andersherum geprüft schickt man den Nutzer zu
  // einer Anmeldung, die nichts ändern kann.
  if (/9952|Produkt-ID|Kundenprodukt/.test(t))
    return { kurz:'Die Bank lehnt die Produkt-ID ab – das liegt an ihrer Freischaltung, nicht an dir.', anmelden:false };
  if (/\b429\b|too many|rate limit/i.test(t))
    return { kurz:'Zu viele Versuche – die Bank bremst gerade. In ein paar Stunden noch einmal.', anmelden:false };
  if (/system_id/i.test(t))
    return { kurz:'Die einmalige Anmeldung fehlt oder ist verloren gegangen.', anmelden:true };
  if (/9010|9800|PIN|gesperrt/i.test(t))
    return { kurz:'Die Bank hat die Anmeldung abgelehnt – PIN prüfen, bevor du es noch einmal versuchst.', anmelden:false };
  return { kurz: t.split(/[\n\r]|\s\/\s/)[0].trim().slice(0, 140) || 'Unbekannter Fehler.', anmelden:false };
}

/* Quellen, die klemmen: mit Fehler, oder seit drei Tagen stumm. */
function brueckeProbleme(){
  const grenze = tageAddieren(heute(), -3);
  return (brueckeLage || []).map((z) => {
    const stand = z.stand ? String(z.stand).slice(0, 10) : '';
    const stumm = !stand || stand < grenze;
    if (!z.fehler && !stumm) return null;
    const k = z.fehler ? brueckeFehlerKlartext(z.fehler)
                       : { kurz:'Meldet sich seit ' + (stand ? datumKurz(stand) + ausIso(stand).getFullYear() : 'Beginn') +
                                ' nicht mehr.', anmelden:false };
    return { name: z.name || z.konto, konto: z.konto, stand, kurz: k.kurz, anmelden: k.anmelden };
  }).filter(Boolean);
}

/* Ein Konto abgleichen: Saldo und neue Buchungen. */
async function kontoAbgleichen(konto){
  if (konto.dienst !== 'bruecke') throw new Error('Für dieses Konto ist kein automatischer Abruf eingerichtet.');
  const cfg = db.einst.bruecke || {};
  const neue = await brueckeUmsaetze(cfg, konto);
  const erg = umsaetzeUebernehmen(neue);

  // Saldo nachziehen, falls die Brücke einen liefert
  try {
    const konten = await brueckeKonten(cfg);
    const treffer = konten.find((k) => k.ref === konto.apiRef);
    if (treffer){
      konto.saldo = treffer.saldo;
      konto.saldoStand = heute();
    }
  } catch (e){ /* Saldo ist die Zugabe – die Buchungen sind schon da */ }

  konto.letzterAbruf = new Date().toISOString();
  sichern();
  return erg;
}

/* Alle angebundenen Konten abgleichen. Fehler je Konto einsammeln statt
 * abbrechen: eine wackelige Verbindung soll nicht den ganzen Lauf verhindern. */
async function alleAbgleichen(){
  const konten = db.konten.filter((k) => k.dienst === 'bruecke');
  const bericht = { konten:0, neu:0, dubletten:0, fehler:[] };
  for (const k of konten){
    try {
      const erg = await kontoAbgleichen(k);
      bericht.konten++; bericht.neu += erg.neu; bericht.dubletten += erg.dubletten;
    } catch (e){
      bericht.fehler.push(k.name + ': ' + e.message);
    }
  }
  return bericht;
}

/* Alles holen, was an der Brücke hängt – Konten wie Depots, still im
 * Hintergrund. Fehler landen in der Konsole statt in einem Fenster: beim
 * Start soll niemand einen Dialog wegklicken müssen, nur weil die Brücke
 * gerade nicht erreichbar ist. */
async function brueckeAlleHolen(){
  const cfg = db.einst.bruecke;
  if (!cfg || !cfg.basis) return null;
  const bericht = { neu:0, positionen:0, fehler:[] };

  for (const k of db.konten.filter((x) => x.dienst === 'bruecke')){
    try {
      const erg = await kontoAbgleichen(k);
      bericht.neu += erg.neu;
    } catch (e){ bericht.fehler.push(k.name + ': ' + e.message); }
  }
  for (const d of db.depots.filter((x) => x.dienst === 'bruecke')){
    try {
      const erg = await depotAbgleichen(d);
      bericht.positionen += erg.neu + erg.erneuert;
    } catch (e){ bericht.fehler.push(d.name + ': ' + e.message); }
  }

  // Immer nachfragen, wie es der Brücke geht – auch wenn oben alles glatt
  // lief. Ein abgelaufener Zugang fällt hier sonst nicht auf: die Brücke
  // liefert dann klaglos ihren letzten guten Stand.
  await brueckeStatusHolen();

  if (bericht.fehler.length) console.warn('[Brücke]', bericht.fehler.join(' | '));
  if (bericht.positionen) depotStandFesthalten();   // taeglicher Eintrag in den Wertverlauf
  if (bericht.neu || bericht.positionen){
    sichern();
  }
  // Auch ohne neue Buchungen neu zeichnen: der Lagebericht kann eine Warnung
  // mitgebracht haben, die niemand sieht, wenn die Ansicht stehen bleibt.
  if (typeof neuZeichnen === 'function') neuZeichnen();
  return bericht;
}

/* ---------- Beispieldaten ----------
 * Erzeugt einen vollständigen Haushalt über die letzten sieben Monate, damit
 * Dashboard, Kategorien, Vertragserkennung und Depot sofort etwas zeigen. */

const BSP_FIX = [
  { gegen:'Hausverwaltung Meyer GmbH', zweck:'Miete Wohnung Lindenstr. 14',       betrag:-985.00, tag: 1 },
  { gegen:'Stadtwerke Musterstadt',    zweck:'Abschlag Strom und Wasser',          betrag:-96.00,  tag: 3 },
  { gegen:'Telekom Deutschland GmbH',  zweck:'Festnetz und Internet MagentaZuhause', betrag:-44.95, tag: 5 },
  { gegen:'Vodafone GmbH',             zweck:'Mobilfunk Rechnung',                 betrag:-24.99,  tag: 7 },
  { gegen:'Netflix International B.V.',zweck:'Netflix Standard Abo',               betrag:-13.99,  tag:12 },
  { gegen:'Spotify AB',                zweck:'Spotify Premium',                    betrag:-11.99,  tag:15 },
  { gegen:'Rundfunk ARD ZDF Deutschlandradio', zweck:'Rundfunkbeitrag',            betrag:-18.36,  tag:16 },
  { gegen:'FitX Deutschland GmbH',     zweck:'Mitgliedsbeitrag Fitnessstudio',     betrag:-29.90,  tag:20 },
  { gegen:'Techniker Krankenkasse',    zweck:'Zusatzbeitrag',                      betrag:-58.40,  tag:25 },
  { gegen:'Trade Republic Bank GmbH',  zweck:'ETF-Sparplan Ausfuehrung',           betrag:-300.00, tag:18 }
];
const BSP_LAEDEN = [
  { gegen:'REWE Markt GmbH',        zweck:'Einkauf',                 von:18, bis: 78, anzahl:6 },
  { gegen:'ALDI SUED',              zweck:'Einkauf',                 von:14, bis: 55, anzahl:3 },
  { gegen:'Baeckerei Kaiser',       zweck:'Brot und Broetchen',      von: 3, bis: 12, anzahl:5 },
  { gegen:'Shell Tankstelle',       zweck:'Kraftstoff',              von:45, bis: 85, anzahl:2 },
  { gegen:'Lieferando.de',          zweck:'Bestellung',              von:16, bis: 38, anzahl:2 },
  { gegen:'Restaurant Trattoria Da Vinci', zweck:'Bewirtung',        von:24, bis: 72, anzahl:1 },
  { gegen:'Amazon EU S.a.r.l.',     zweck:'Bestellung',              von: 9, bis:120, anzahl:3 },
  { gegen:'dm-drogerie markt',      zweck:'Einkauf',                 von: 8, bis: 34, anzahl:2 },
  { gegen:'Deutsche Bahn AG',       zweck:'Fahrkarte',               von:12, bis: 68, anzahl:1 },
  { gegen:'Geldautomat Sparkasse',  zweck:'Bargeldauszahlung',       von:50, bis:200, anzahl:1 }
];

/* Eigener Zufallsgenerator mit Startwert: die Beispieldaten sollen bei jedem
 * Laden gleich aussehen, sonst springt der Verlauf zwischen zwei Blicken. */
function bspRng(start){
  let s = start >>> 0;
  return function(){
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function beispieldatenLaden(){
  const rnd = bspRng(20260920);
  const giro = { id: neueId(), name:'Girokonto', bank:'Sparkasse Musterstadt', iban:'DE02120300000000202051',
                 art:'giro', waehrung:'EUR', saldo:0, saldoStand: heute(), dienst:'manuell', farbe:'#3d7fa8', apiRef:'' };
  const tagesgeld = { id: neueId(), name:'Tagesgeld', bank:'ING', iban:'DE89370400440532013000',
                 art:'tagesgeld', waehrung:'EUR', saldo:8400, saldoStand: heute(), dienst:'manuell', farbe:'#4f9d8c', apiRef:'' };
  const kredit = { id: neueId(), name:'Autokredit', bank:'Santander', iban:'',
                 art:'kredit', waehrung:'EUR', saldo:4200, saldoStand: heute(), dienst:'manuell', farbe:'#c0603f', apiRef:'' };
  db.konten.push(giro, tagesgeld, kredit);

  const heuteD = ausIso(heute());
  const umsaetze = [];
  const tagIm = (monatZurueck, tag) => {
    const d = new Date(heuteD.getFullYear(), heuteD.getMonth() - monatZurueck, Math.min(tag, 28));
    return d > heuteD ? null : isoTag(d);
  };

  for (let m = 6; m >= 0; m--){
    // Gehalt am Monatsende
    const gehaltTag = tagIm(m, 27);
    if (gehaltTag) umsaetze.push(umsatzBauen({ kontoId:giro.id, datum:gehaltTag, betrag: 3180 + Math.round(rnd() * 60),
      gegen:'Muster GmbH & Co. KG', zweck:'Gehalt ' + MONATE[ausIso(gehaltTag).getMonth()], quelle:'beispiel' }));

    BSP_FIX.forEach((f) => {
      const d = tagIm(m, f.tag);
      if (!d) return;
      // Strom und Mobilfunk schwanken leicht, der Rest ist auf den Cent gleich
      const wackelt = /Stadtwerke|Vodafone/.test(f.gegen);
      const betrag = wackelt ? f.betrag * (0.94 + rnd() * 0.12) : f.betrag;
      umsaetze.push(umsatzBauen({ kontoId:giro.id, datum:d, betrag: Math.round(betrag * 100) / 100,
        gegen:f.gegen, zweck:f.zweck, quelle:'beispiel' }));
    });

    // Versicherung nur im Quartal
    if (m % 3 === 0){
      const d = tagIm(m, 10);
      if (d) umsaetze.push(umsatzBauen({ kontoId:giro.id, datum:d, betrag:-171.60,
        gegen:'HUK-COBURG Versicherung', zweck:'Kfz-Versicherung Quartalsbeitrag', quelle:'beispiel' }));
    }

    BSP_LAEDEN.forEach((l) => {
      for (let i = 0; i < l.anzahl; i++){
        const d = tagIm(m, 2 + Math.floor(rnd() * 26));
        if (!d) continue;
        umsaetze.push(umsatzBauen({ kontoId:giro.id, datum:d,
          betrag: -Math.round((l.von + rnd() * (l.bis - l.von)) * 100) / 100,
          gegen:l.gegen, zweck:l.zweck, quelle:'beispiel' }));
      }
    });
  }

  umsaetze.sort((a, b) => (a.datum < b.datum ? 1 : -1));
  db.umsaetze = db.umsaetze.concat(umsaetze);
  // Saldo passend zum Verlauf: Startguthaben plus alle Buchungen
  giro.saldo = Math.round((2450 + umsaetze.reduce((s, u) => s + u.betrag, 0)) * 100) / 100;

  const depot = { id: neueId(), name:'Depot Trade Republic', broker:'Trade Republic', dienst:'manuell' };
  db.depots.push(depot);
  [
    { name:'Vanguard FTSE All-World UCITS ETF', isin:'IE00BK5BQT80', symbol:'VWCE.DE', art:'etf',   stueck:42,  einstand: 98.40, kurs:118.62 },
    { name:'iShares Core MSCI World',           isin:'IE00B4L5Y983', symbol:'EUNL.DE', art:'etf',   stueck:18,  einstand: 76.10, kurs: 94.28 },
    { name:'Allianz SE',                        isin:'DE0008404005', symbol:'ALV.DE',  art:'aktie', stueck:12,  einstand:228.50, kurs:311.40 },
    { name:'Apple Inc.',                        isin:'US0378331005', symbol:'AAPL',    art:'aktie', stueck:15,  einstand:162.00, kurs:224.15 },
    { name:'Bitcoin',                           isin:'',             symbol:'BTC',     art:'krypto',stueck:0.08,einstand:41200,  kurs:58940 }
  ].forEach((p) => {
    db.positionen.push(Object.assign({ id:neueId(), depotId:depot.id, wkn:'', waehrung:'EUR', kursStand: heute(), notiz:'' }, p));
  });

  sichern();
}
