/* Finanzhelfer – Kurse und Depotrechnung
 *
 * Kurse kommen aus öffentlichen Marktdaten-APIs. Zwei Dinge dazu:
 *
 *  • Für Aktien, ETFs und Fonds braucht es einen eigenen, kostenlosen Schlüssel
 *    (Twelve Data, Finnhub oder Alpha Vantage). Er bleibt im Gerät, wird nur an
 *    den gewählten Dienst geschickt und steckt – falls die Sperre aktiv ist –
 *    mit im verschlüsselten Bestand.
 *  • Abgefragt wird über das BÖRSENKÜRZEL, nicht über die ISIN. Eine kostenlose,
 *    verlässliche ISIN→Symbol-Auflösung gibt es nicht; die ISIN dient hier nur
 *    dem Wiedererkennen. Bei deutschen Notierungen ist das Kürzel meist
 *    „SYMBOL.DE“ (z. B. EUNL.DE, VWCE.DE, ALV.DE).
 *
 * Krypto und Wechselkurse gehen ohne Schlüssel: CoinGecko und frankfurter.app
 * erlauben Zugriffe direkt aus dem Browser.
 *
 * Ohne alles: Kurse lassen sich jederzeit von Hand eintragen. Die Rechnung
 * darunter ist dieselbe. */

const KURS_DIENSTE = [
  {
    id:'twelvedata', name:'Twelve Data',
    hinweis:'800 Abfragen am Tag, 8 pro Minute',
    schluesselUrl:'https://twelvedata.com/pricing',
    url: (sym, key) => 'https://api.twelvedata.com/quote?symbol=' + encodeURIComponent(sym) + '&apikey=' + encodeURIComponent(key),
    lesen: (d) => ({ kurs: parseFloat(d.close ?? d.price), waehrung: d.currency })
  },
  {
    id:'finnhub', name:'Finnhub',
    hinweis:'60 Abfragen pro Minute, vor allem US-Werte',
    schluesselUrl:'https://finnhub.io/register',
    url: (sym, key) => 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(sym) + '&token=' + encodeURIComponent(key),
    lesen: (d) => ({ kurs: Number(d.c), waehrung: null })   // liefert keine Währung mit
  },
  {
    id:'alphavantage', name:'Alpha Vantage',
    hinweis:'25 Abfragen am Tag',
    schluesselUrl:'https://www.alphavantage.co/support/#api-key',
    url: (sym, key) => 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=' + encodeURIComponent(sym) + '&apikey=' + encodeURIComponent(key),
    lesen: (d) => {
      const q = d['Global Quote'] || {};
      return { kurs: parseFloat(q['05. price']), waehrung: null };
    }
  }
];
const KURS_DIENST_MAP = Object.fromEntries(KURS_DIENSTE.map((d) => [d.id, d]));

/* CoinGecko kennt Namen, keine Kürzel – die gängigen Münzen hier hinterlegt.
 * Was fehlt, trägt der Nutzer als CoinGecko-Kennung direkt im Symbolfeld ein. */
const KRYPTO_IDS = {
  btc:'bitcoin', xbt:'bitcoin', eth:'ethereum', sol:'solana', ada:'cardano',
  xrp:'ripple', dot:'polkadot', doge:'dogecoin', ltc:'litecoin', bnb:'binancecoin',
  matic:'matic-network', link:'chainlink', avax:'avalanche-2', trx:'tron', xmr:'monero'
};

/* ---------- Wechselkurse ----------
 * Einmal je Sitzung holen; die Depotbewertung braucht sie bei jedem Neuzeichnen. */
const fxCache = {};
async function fxNachEur(von){
  const w = String(von || 'EUR').toUpperCase();
  if (w === 'EUR' || !w) return 1;
  if (fxCache[w]) return fxCache[w];
  try {
    const a = await fetch('https://api.frankfurter.app/latest?from=' + w + '&to=EUR', { cache:'no-store' });
    if (!a.ok) throw new Error(String(a.status));
    const d = await a.json();
    const k = d && d.rates && d.rates.EUR;
    if (k > 0){ fxCache[w] = k; return k; }
  } catch (e){ console.warn('[Kurse] Wechselkurs', w, e.message); }
  return 1;   // lieber unumgerechnet anzeigen als gar nichts
}

/* ---------- ein Kurs ---------- */
async function kursHolen(pos){
  const sym = String(pos.symbol || '').trim();
  if (!sym) throw new Error('Kein Börsenkürzel hinterlegt.');

  if (pos.art === 'krypto'){
    const id = KRYPTO_IDS[sym.toLowerCase()] || sym.toLowerCase();
    const a = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(id) + '&vs_currencies=eur', { cache:'no-store' });
    if (!a.ok) throw new Error('CoinGecko antwortet mit ' + a.status);
    const d = await a.json();
    const k = d[id] && d[id].eur;
    if (!(k > 0)) throw new Error('Kennung „' + id + '“ ist CoinGecko unbekannt.');
    return { kurs: k, waehrung:'EUR' };
  }

  const dienst = KURS_DIENST_MAP[db.einst.kursDienst] || KURS_DIENSTE[0];
  const key = (db.einst.kursKey || '').trim();
  if (!key) throw new Error('Für ' + dienst.name + ' ist kein Schlüssel hinterlegt.');

  const a = await fetch(dienst.url(sym, key), { cache:'no-store' });
  if (!a.ok) throw new Error(dienst.name + ' antwortet mit ' + a.status);
  const d = await a.json();
  // Die Gratis-Stufen melden ihr Limit als 200 mit Textfeld, nicht als Fehlercode
  if (d.status === 'error' || d.code >= 400) throw new Error(d.message || 'Abfrage abgelehnt');
  if (d.Note || d.Information) throw new Error('Abfragelimit erreicht');
  const erg = dienst.lesen(d);
  if (!(erg.kurs > 0)) throw new Error('Kein Kurs für „' + sym + '“');
  return { kurs: erg.kurs, waehrung: (erg.waehrung || pos.waehrung || 'EUR').toUpperCase() };
}

/* ---------- alle Kurse ----------
 * Nacheinander und mit Pause: die Gratis-Stufen zählen streng pro Minute.
 * `melde(fertig, gesamt, text)` versorgt die Fortschrittsanzeige. */
/* Hängt die Position an einem Depot, das die Brücke füllt? Dann kommt ihr
 * Kurs von dort und braucht keine zweite Quelle. */
function ausBruecke(p){
  const d = db.depots.find((x) => x.id === p.depotId);
  return !!(d && d.dienst === 'bruecke');
}

async function kurseAktualisieren(melde){
  // Brücken-Positionen überspringen: deren Kurs ist gerade erst gekommen.
  // Sonst liefe bei jedem Start eine Handvoll überflüssiger Abfragen gegen
  // CoinGecko – die dann auch noch am Limit scheitern.
  const offen = db.positionen.filter((p) => String(p.symbol || '').trim() && !ausBruecke(p));
  const bericht = { erneuert:0, fehler:[] };
  for (let i = 0; i < offen.length; i++){
    const p = offen[i];
    if (melde) melde(i, offen.length, p.name);
    try {
      const erg = await kursHolen(p);
      let kurs = erg.kurs;
      if (erg.waehrung && erg.waehrung !== 'EUR'){
        p.waehrung = erg.waehrung;      // Fremdwährung merken, Umrechnung macht die Anzeige
      } else {
        p.waehrung = 'EUR';
      }
      p.kurs = Math.round(kurs * 10000) / 10000;
      p.kursStand = heute();
      bericht.erneuert++;
    } catch (e){
      bericht.fehler.push(p.name + ': ' + e.message);
    }
    if (i < offen.length - 1) await new Promise((r) => setTimeout(r, 900));
  }
  db.zuletztKurse = new Date().toISOString();
  depotStandFesthalten();
  sichern();
  if (melde) melde(offen.length, offen.length, '');
  return bericht;
}

/* ---------- Depot über die Brücke ----------
 * Wer seinen Broker über die eigene Brücke anbindet (siehe banking.js), holt
 * die Bestände hier ab. Erwartet wird:
 *   [{ "name":"…", "isin":"…", "symbol":"…", "stueck":42, "einstand":98.4,
 *      "kurs":118.62, "waehrung":"EUR", "art":"etf" }] */
async function depotAbgleichen(depot){
  const roh = await brueckeHolen(db.einst.bruecke || {}, '/positionen', { depot: depot.apiRef || '' });
  let neu = 0, erneuert = 0;
  roh.forEach((r) => {
    const isin = String(r.isin || '').toUpperCase();
    const name = r.name || r.bezeichnung || isin;
    // Haben beide Seiten eine ISIN, entscheidet allein sie. Der Name taugt nur
    // als Notnagel, wenn eine fehlt: zwei Wertpapiere können gleich heißen und
    // trotzdem verschieden sein – bei Trade Republic gibt es etwa zweimal
    // „Private Equity" unter verschiedenen ISINs. Mit einem Oder verschluckt
    // die Zuordnung die zweite Position stillschweigend.
    const vorhanden = db.positionen.find((p) => {
      if (p.depotId !== depot.id) return false;
      const pIsin = String(p.isin || '').toUpperCase();
      if (isin && pIsin) return pIsin === isin;
      return normal(p.name) === normal(name);
    });
    const werte = {
      name,
      isin,
      wkn: r.wkn || '',
      symbol: r.symbol || '',
      art: WP_ARTEN.some((a) => a.id === r.art) ? r.art : 'sonst',
      stueck: Number(r.stueck ?? r.anzahl ?? 0) || 0,
      kurs: Number(r.kurs ?? r.preis ?? 0) || 0,
      waehrung: (r.waehrung || 'EUR').toUpperCase(),
      kursStand: heute()
    };
    // Den Einstandskurs nur übernehmen, wenn die Gegenstelle wirklich einen
    // kennt. Manche Quellen liefern ihn nicht mit (Bitvavo etwa) – eine 0
    // würde dort einen von Hand gepflegten Wert stillschweigend löschen.
    const einstand = Number(r.einstand ?? r.kaufkurs ?? 0) || 0;
    if (einstand > 0 || !vorhanden) werte.einstand = einstand;

    if (vorhanden){ Object.assign(vorhanden, werte); erneuert++; }
    else { db.positionen.push(Object.assign({ id:neueId(), depotId:depot.id, notiz:'' }, werte)); neu++; }
  });
  depot.letzterAbruf = new Date().toISOString();
  sichern();
  return { neu, erneuert };
}

/* ---------- Rechnung ----------
 * Fremdwährungen werden mit dem Tageskurs umgerechnet. Der Faktor liegt im
 * fxCache; ist er noch nicht geladen, wird mit 1 gerechnet und nach dem Laden
 * neu gezeichnet – besser als eine leere Anzeige. */
function fxFaktor(waehrung){
  const w = String(waehrung || 'EUR').toUpperCase();
  if (w === 'EUR') return 1;
  if (fxCache[w]) return fxCache[w];
  fxNachEur(w).then((k) => { if (k !== 1 && typeof neuZeichnen === 'function') neuZeichnen(); });
  return 1;
}
function posWert(p){ return (Number(p.stueck) || 0) * (Number(p.kurs) || 0) * fxFaktor(p.waehrung); }
function posEinstand(p){ return (Number(p.stueck) || 0) * (Number(p.einstand) || 0) * fxFaktor(p.waehrung); }
function posGuv(p){ return posWert(p) - posEinstand(p); }
function posProz(p){
  const e = posEinstand(p);
  return e > 0 ? (posGuv(p) / e) * 100 : 0;
}
function depotWert(depotId){
  return db.positionen.filter((p) => !depotId || p.depotId === depotId).reduce((s, p) => s + posWert(p), 0);
}

/* ---------- Wertverlauf des Depots ----------
 * Kurse von gestern bekommt man nirgends her, ohne eine Kurshistorie zu
 * kaufen. Also schreibt die App den Depotwert selbst mit – einmal am Tag,
 * bei jedem Abgleich. Die Reihe beginnt damit am Tag des Einbaus und wird
 * mit der Zeit aussagekräftig; eine Rückrechnung wäre nur geraten. */
function depotStandFesthalten(){
  if (!db.positionen.length) return;
  if (!Array.isArray(db.depotVerlauf)) db.depotVerlauf = [];
  const heuteIso = heute();
  const wert = Math.round(depotWert() * 100) / 100;
  const einstand = Math.round(depotEinstand() * 100) / 100;

  const vorhanden = db.depotVerlauf.find((e) => e.datum === heuteIso);
  if (vorhanden){
    // Mehrmals am Tag: der letzte Stand des Tages gilt
    vorhanden.wert = wert;
    vorhanden.einstand = einstand;
  } else {
    db.depotVerlauf.push({ datum: heuteIso, wert, einstand });
    db.depotVerlauf.sort((a, b) => (a.datum < b.datum ? -1 : 1));
    // Fünf Jahre Tageswerte reichen für jede Auswertung
    if (db.depotVerlauf.length > 1830) db.depotVerlauf = db.depotVerlauf.slice(-1830);
  }
  sichern();
}

/* Der letzte aufgezeichnete Stand bis einschließlich `stichtag`. */
function depotStandAm(stichtag){
  if (!stichtag || !Array.isArray(db.depotVerlauf)) return null;
  let treffer = null;
  db.depotVerlauf.forEach((e) => { if (e.datum <= stichtag) treffer = e; });
  return treffer;
}

/* Depotwert zu einem Stichtag – aus der Aufzeichnung, sonst der heutige. */
function depotWertAm(stichtag){
  const e = depotStandAm(stichtag);
  return e ? e.wert : depotWert();
}
function depotEinstand(depotId){
  return db.positionen.filter((p) => !depotId || p.depotId === depotId).reduce((s, p) => s + posEinstand(p), 0);
}
