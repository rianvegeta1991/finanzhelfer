/* Finanzhelfer – Kontoauszüge einlesen
 *
 * Drei Formate, die jede deutsche Bank im Online-Banking anbietet:
 *   CSV       – Sparkasse, DKB, ING, comdirect, Consorsbank, N26, Volksbank …
 *   CAMT.053  – XML nach ISO 20022, der offizielle SEPA-Auszug
 *   MT940     – das alte SWIFT-Format, das viele Banken weiterhin ausgeben
 *
 * Die Spaltenzuordnung wird geraten und im Importfenster angezeigt; wer eine
 * exotische Bank hat, stellt sie dort von Hand um. Deshalb liefert impCsvLesen
 * die Rohtabelle und einen Vorschlag statt fertiger Umsätze. */

/* ---------- Zahlen und Datumsangaben ---------- */

/* „1.234,56“, „-1234.56“, „1 234,56 EUR“ – alles landet als Number.
 * Die Regel: Das letzte Trennzeichen mit genau zwei Nachkommastellen ist das
 * Dezimalzeichen; alles davor sind Tausenderpunkte. */
function impZahl(s){
  if (typeof s === 'number') return s;
  let t = String(s || '').replace(/[^\d,.\-+]/g, '').trim();
  if (!t) return NaN;
  const minus = /^-/.test(t) || /-$/.test(t);
  t = t.replace(/[-+]/g, '');
  const letztesKomma = t.lastIndexOf(',');
  const letzterPunkt = t.lastIndexOf('.');
  const dez = Math.max(letztesKomma, letzterPunkt);
  if (dez >= 0 && t.length - dez - 1 <= 2 && t.length - dez - 1 > 0){
    t = t.slice(0, dez).replace(/[.,]/g, '') + '.' + t.slice(dez + 1);
  } else {
    t = t.replace(/[.,]/g, '');
  }
  const z = parseFloat(t);
  if (!isFinite(z)) return NaN;
  return minus ? -z : z;
}

/* „31.12.2025“, „31.12.25“, „2025-12-31“, „31/12/2025“ → ISO. */
function impDatum(s){
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2,'0') + '-' + m[3].padStart(2,'0');
  m = t.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
  if (m){
    let jahr = m[3];
    // Zweistellig: 70–99 sind die Neunziger, alles andere dieses Jahrhundert
    if (jahr.length === 2) jahr = (Number(jahr) > 70 ? '19' : '20') + jahr;
    return jahr + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
  }
  // MT940 nutzt JJMMTT ohne Trenner
  m = t.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) return '20' + m[1] + '-' + m[2] + '-' + m[3];
  return '';
}

/* ---------- CSV ---------- */

/* Zerlegt CSV mit Anführungszeichen und eingebetteten Zeilenumbrüchen. */
function csvZerlegen(text, trenner){
  const zeilen = [];
  let feld = '', zeile = [], inAnf = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (inAnf){
      if (c === '"'){
        if (text[i+1] === '"'){ feld += '"'; i++; }
        else inAnf = false;
      } else feld += c;
    } else if (c === '"'){
      inAnf = true;
    } else if (c === trenner){
      zeile.push(feld); feld = '';
    } else if (c === '\n'){
      zeile.push(feld); zeilen.push(zeile); zeile = []; feld = '';
    } else if (c === '\r'){
      /* überspringen */
    } else feld += c;
  }
  if (feld !== '' || zeile.length){ zeile.push(feld); zeilen.push(zeile); }
  return zeilen.filter((z) => z.some((f) => String(f).trim() !== ''));
}

/* Welcher Trenner? Der, der in den ersten Zeilen am gleichmäßigsten auftritt. */
function csvTrenner(text){
  const probe = text.split('\n').slice(0, 25).join('\n');
  const kandidaten = [';', '\t', ','];
  let bester = ';', bestwert = -1;
  kandidaten.forEach((t) => {
    const anzahl = probe.split(t).length - 1;
    if (anzahl > bestwert){ bestwert = anzahl; bester = t; }
  });
  return bester;
}

/* Spaltenüberschriften erkennen: Sparkassen-Dateien beginnen mit einer
 * Vorspann-Zeile („Kontonummer …“), deshalb wird die erste Zeile gesucht,
 * die nach Kopfzeile aussieht – und die längste davon gewinnt. */
const IMP_KOPF_WORTE = ['buchung','valuta','datum','betrag','verwendungszweck','umsatz','auftraggeber','empfaenger','beguenstigter','waehrung','soll','haben','buchungstext'];
function csvKopfZeile(zeilen){
  let beste = 0, bestwert = 0;
  for (let i = 0; i < Math.min(zeilen.length, 20); i++){
    const wert = zeilen[i].reduce((s, f) => s + (IMP_KOPF_WORTE.some((w) => normal(f).includes(w)) ? 1 : 0), 0);
    if (wert > bestwert){ bestwert = wert; beste = i; }
  }
  return bestwert >= 2 ? beste : 0;
}

/* Welche Spalte ist was? Reihenfolge der Muster = Rangfolge. */
const IMP_MUSTER = {
  datum:    ['buchungstag','buchungsdatum','buchung','valutadatum','valuta','datum','wertstellung'],
  betrag:   ['betrag','umsatz in eur','umsatz','soll/haben','wert'],
  zweck:    ['verwendungszweck','buchungstext','zweck','beschreibung','umsatzart','vorgang','referenz'],
  gegen:    ['beguenstigter','auftraggeber','empfaenger','zahlungspflichtiger','name','kontoinhaber','gegenkonto','partner'],
  waehrung: ['waehrung','currency']
};
/* Drei Durchgänge, vom Genauen zum Groben: erst Spalten, die genau so heißen,
 * dann solche, die so anfangen, zuletzt solche, die das Wort irgendwo tragen.
 * Ohne diese Reihenfolge schnappt sich „Lastschrift Ursprungsbetrag“ (eine
 * Spalte, die in fast jeder Zeile leer ist) den Platz von „Betrag“. */
function csvVorschlag(kopf){
  const norm = kopf.map(normal);
  const gefunden = {};
  const belegt = new Set();
  const felder = Object.keys(IMP_MUSTER);
  felder.forEach((feld) => { gefunden[feld] = -1; });

  [(k, m) => k === m, (k, m) => k.startsWith(m), (k, m) => k.includes(m)].forEach((passt) => {
    felder.forEach((feld) => {
      if (gefunden[feld] >= 0) return;
      for (const muster of IMP_MUSTER[feld]){
        const i = norm.findIndex((k, idx) => !belegt.has(idx) && passt(k, muster));
        if (i >= 0){ gefunden[feld] = i; belegt.add(i); break; }
      }
    });
  });
  // Getrennte Soll-/Haben-Spalten statt einer Betragsspalte
  if (gefunden.betrag < 0){
    const soll  = norm.findIndex((k) => k.startsWith('soll') || k.includes('belastung'));
    const haben = norm.findIndex((k) => k.startsWith('haben') || k.includes('gutschrift'));
    if (soll >= 0 && haben >= 0){ gefunden.soll = soll; gefunden.haben = haben; }
  }
  // Manche Auszüge führen das Vorzeichen als eigene Spalte „S“/„H“
  const vz = norm.findIndex((k) => k.includes('soll/haben-kennung') || k === 'sh' || k.includes('kennung'));
  if (vz >= 0) gefunden.vz = vz;
  return gefunden;
}

/* Liest eine CSV-Datei ein und gibt Kopf, Zeilen und den Zuordnungsvorschlag
 * zurück. Fertige Umsätze macht daraus erst impCsvUmsaetze. */
function impCsvLesen(text){
  const trenner = csvTrenner(text);
  const alle = csvZerlegen(text, trenner);
  if (!alle.length) return null;
  const kopfIdx = csvKopfZeile(alle);
  const kopf = alle[kopfIdx].map((s) => String(s).trim());
  const zeilen = alle.slice(kopfIdx + 1).filter((z) => z.length >= Math.max(2, Math.floor(kopf.length / 2)));
  return { art:'csv', trenner, kopf, zeilen, zuordnung: csvVorschlag(kopf) };
}

function impCsvUmsaetze(lese, zuordnung, kontoId){
  const z = zuordnung || lese.zuordnung;
  const raus = [];
  lese.zeilen.forEach((zeile) => {
    const datum = impDatum(zeile[z.datum]);
    if (!datum) return;

    let betrag = NaN;
    if (z.betrag >= 0) betrag = impZahl(zeile[z.betrag]);
    if (!isFinite(betrag) && z.soll !== undefined){
      const soll = impZahl(zeile[z.soll]) || 0;
      const haben = impZahl(zeile[z.haben]) || 0;
      betrag = haben - Math.abs(soll);
    }
    if (!isFinite(betrag)) return;
    if (z.vz !== undefined){
      const k = normal(zeile[z.vz]);
      if (k === 's' || k.startsWith('soll')) betrag = -Math.abs(betrag);
      if (k === 'h' || k.startsWith('haben')) betrag = Math.abs(betrag);
    }

    raus.push(umsatzBauen({
      kontoId,
      datum,
      betrag,
      gegen: (zeile[z.gegen] || '').trim(),
      zweck: (zeile[z.zweck] || '').trim(),
      waehrung: (z.waehrung >= 0 ? (zeile[z.waehrung] || 'EUR') : 'EUR').trim().toUpperCase() || 'EUR'
    }));
  });
  return raus;
}

/* ---------- CAMT.053 (XML) ---------- */
function impCamt(text, kontoId){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  // Namensräume unterscheiden sich je Version, deshalb über den lokalen Namen suchen
  const hole = (el, name) => {
    const treffer = el.getElementsByTagName('*');
    for (let i = 0; i < treffer.length; i++){
      if (treffer[i].localName === name) return treffer[i].textContent.trim();
    }
    return '';
  };
  // Die Währung steht als Attribut am Betrag, nicht als eigenes Element
  const waehrungVon = (el) => {
    const treffer = el.getElementsByTagName('*');
    for (let i = 0; i < treffer.length; i++){
      if (treffer[i].localName === 'Amt') return (treffer[i].getAttribute('Ccy') || 'EUR').toUpperCase();
    }
    return 'EUR';
  };
  const eintraege = Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'Ntry');
  return eintraege.map((e) => {
    const betragRoh = parseFloat(hole(e, 'Amt') || '0');
    const richtung = hole(e, 'CdtDbtInd');      // CRDT = Gutschrift, DBIT = Lastschrift
    const datum = impDatum(hole(e, 'BookgDt') || hole(e, 'ValDt') || hole(e, 'Dt'));
    // Bei einer Lastschrift steht der Empfänger unter Cdtr, bei einer Gutschrift der Zahler unter Dbtr
    const gegen = (richtung === 'DBIT' ? hole(e, 'Cdtr') : hole(e, 'Dbtr')) || hole(e, 'Nm');
    return umsatzBauen({
      kontoId, datum,
      betrag: richtung === 'DBIT' ? -Math.abs(betragRoh) : Math.abs(betragRoh),
      gegen,
      zweck: hole(e, 'Ustrd') || hole(e, 'AddtlNtryInf'),
      waehrung: waehrungVon(e)
    });
  }).filter((u) => u.datum);
}

/* ---------- MT940 ----------
 * :61: Umsatzzeile (Datum, C/D, Betrag), :86: der Verwendungszweck dazu,
 * oft über mehrere Zeilen und in ?20-?29-Feldern zerlegt. */
function impMt940(text, kontoId){
  const raus = [];
  const zeilen = text.split(/\r?\n/);
  let offen = null;
  const abschliessen = () => { if (offen && offen.datum) raus.push(umsatzBauen(offen)); offen = null; };

  zeilen.forEach((roh) => {
    const z = roh.trim();
    if (z.startsWith(':61:')){
      abschliessen();
      const m = z.slice(4).match(/^(\d{6})(\d{4})?([CD])R?([\d.,]+)/);
      if (!m) return;
      const betrag = impZahl(m[4]);
      offen = {
        kontoId,
        datum: impDatum(m[1]),
        betrag: m[3] === 'D' ? -Math.abs(betrag) : Math.abs(betrag),
        gegen: '', zweck: '', waehrung:'EUR'
      };
    } else if (z.startsWith(':86:') && offen){
      offen._roh = z.slice(4);
    } else if (offen && offen._roh !== undefined && z && z !== '-' && !z.startsWith(':')){
      // Fortsetzungszeile des Verwendungszwecks. Das einzelne „-“ am Dateiende
      // ist der Blockabschluss und gehört nicht zum Text.
      offen._roh += z;
    }
    if (offen && offen._roh !== undefined){
      // ?32/?33 tragen den Namen der Gegenseite, ?20-?29 den Zweck
      const roh2 = offen._roh;
      const teile = roh2.split('?').slice(1);
      if (teile.length){
        const zweck = teile.filter((t) => /^2\d/.test(t)).map((t) => t.slice(2)).join(' ').trim();
        const name  = teile.filter((t) => /^3[23]/.test(t)).map((t) => t.slice(2)).join(' ').trim();
        offen.zweck = zweck || roh2;
        offen.gegen = name;
      } else {
        offen.zweck = roh2;
      }
    }
  });
  abschliessen();
  return raus.map((u) => { delete u._roh; return u; });
}

/* ---------- gemeinsamer Bau + Dublettenschutz ---------- */

/* Fingerabdruck eines Umsatzes. Kontoauszüge tragen keine stabile ID, deshalb
 * wird über Konto, Datum, Betrag und die ersten Zeichen des Zwecks verglichen –
 * das trifft den Fall „derselbe Monat zweimal importiert“ zuverlässig. */
function umsatzSignatur(u){
  return [u.kontoId, u.datum, (Number(u.betrag) || 0).toFixed(2), normal(u.gegen).slice(0, 24), normal(u.zweck).slice(0, 40)].join('|');
}

function umsatzBauen(roh){
  const u = {
    id: neueId(),
    kontoId: roh.kontoId || '',
    datum: roh.datum || heute(),
    betrag: Math.round((Number(roh.betrag) || 0) * 100) / 100,
    gegen: (roh.gegen || '').replace(/\s+/g, ' ').trim(),
    zweck: (roh.zweck || '').replace(/\s+/g, ' ').trim(),
    waehrung: roh.waehrung || 'EUR',
    kategorie: roh.kategorie || '',
    manuellKat: !!roh.manuellKat,   // von Hand gesetzt → automatik fasst es nicht mehr an
    vertragId: roh.vertragId || '',
    notiz: roh.notiz || '',
    quelle: roh.quelle || 'import'
  };
  u.sig = umsatzSignatur(u);
  if (!u.kategorie) u.kategorie = kategorieRaten(u);
  return u;
}

/* ---------- automatische Kategorisierung ----------
 * Erst die eigenen Regeln des Nutzers (die stechen alles), dann die
 * mitgelieferte Stichwortliste. Ohne Treffer bleibt „Sonstiges“ bzw.
 * bei Gutschriften „Sonstige Einnahmen“. */
function kategorieRaten(u){
  const text = normal(u.gegen + ' ' + u.zweck);
  const vz = u.betrag >= 0 ? 1 : -1;

  const eigene = (db && db.regeln) || [];
  for (const r of eigene){
    if (!r.muster) continue;
    if (text.includes(normal(r.muster))) return r.kat;
  }
  for (const r of REGELN){
    if (r.vz && r.vz !== vz) continue;
    if (r.worte.some((w) => text.includes(w))) return r.kat;
  }
  return vz > 0 ? 'einnahmen' : 'sonstiges';
}

/* Alle Umsätze ohne manuell gesetzte Kategorie neu einsortieren – nötig,
 * nachdem der Nutzer eine eigene Regel angelegt hat. */
function kategorienNeuRaten(){
  let geaendert = 0;
  db.umsaetze.forEach((u) => {
    if (u.manuellKat) return;
    const neu = kategorieRaten(u);
    if (neu !== u.kategorie){ u.kategorie = neu; geaendert++; }
  });
  return geaendert;
}

/* Fügt eine Importliste ein und meldet, wie viel davon neu war. */
function umsaetzeUebernehmen(liste){
  const bekannt = new Set(db.umsaetze.map((u) => u.sig || umsatzSignatur(u)));
  let neu = 0, dubletten = 0;
  liste.forEach((u) => {
    const sig = u.sig || umsatzSignatur(u);
    if (bekannt.has(sig)){ dubletten++; return; }
    bekannt.add(sig);
    db.umsaetze.push(u);
    neu++;
  });
  db.umsaetze.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
  return { neu, dubletten };
}

/* ---------- wiederkehrende Abbuchungen finden ----------
 * Gesucht wird nach gleicher Gegenseite mit ähnlichem Betrag in regelmäßigem
 * Abstand. Ab drei Buchungen ist das Muster belastbar genug für einen
 * Vorschlag; darunter kommen zu viele Zufallstreffer. */
function wiederkehrendeFinden(){
  const gruppen = new Map();
  db.umsaetze.forEach((u) => {
    if (u.betrag >= 0) return;                       // nur Abbuchungen
    if (u.kategorie === 'umbuchung') return;
    const schluessel = normal(u.gegen || u.zweck).slice(0, 26);
    if (!schluessel) return;
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, []);
    gruppen.get(schluessel).push(u);
  });

  const vorschlaege = [];
  gruppen.forEach((liste, schluessel) => {
    if (liste.length < 3) return;
    const sortiert = liste.slice().sort((a, b) => (a.datum < b.datum ? -1 : 1));

    // Beträge müssen zusammenpassen – 15 % Abweichung sind bei Strom oder
    // Mobilfunk normal, darüber ist es kein fester Vertrag mehr
    const betraege = sortiert.map((u) => Math.abs(u.betrag));
    const schnitt = betraege.reduce((a, b) => a + b, 0) / betraege.length;
    if (schnitt < 1) return;
    if (betraege.some((b) => Math.abs(b - schnitt) / schnitt > 0.15)) return;

    const abstaende = [];
    for (let i = 1; i < sortiert.length; i++){
      abstaende.push((ausIso(sortiert[i].datum) - ausIso(sortiert[i-1].datum)) / 86400000);
    }
    const mittel = abstaende.reduce((a, b) => a + b, 0) / abstaende.length;
    const turnus = turnusAusTagen(mittel);
    if (!turnus) return;
    if (abstaende.some((t) => Math.abs(t - mittel) > Math.max(6, mittel * 0.25))) return;

    const letzter = sortiert[sortiert.length - 1];
    const sig = 'v|' + schluessel + '|' + schnitt.toFixed(0);
    vorschlaege.push({
      sig,
      name: (letzter.gegen || letzter.zweck).slice(0, 40),
      anbieter: letzter.gegen || '',
      betrag: Math.round(schnitt * 100) / 100,
      turnus,
      kategorie: letzter.kategorie,
      kontoId: letzter.kontoId,
      anzahl: sortiert.length,
      letzte: letzter.datum,
      naechste: turnusWeiter(letzter.datum, turnus),
      umsatzIds: sortiert.map((u) => u.id)
    });
  });
  return vorschlaege.sort((a, b) => b.betrag * 12 / turnusMonate(b.turnus) - a.betrag * 12 / turnusMonate(a.turnus));
}

function turnusAusTagen(tage){
  if (tage >= 5   && tage <= 9)   return 'woechentlich';
  if (tage >= 25  && tage <= 35)  return 'monatlich';
  if (tage >= 80  && tage <= 100) return 'quartal';
  if (tage >= 165 && tage <= 200) return 'halbjahr';
  if (tage >= 340 && tage <= 390) return 'jaehrlich';
  return '';
}
