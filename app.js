/* Finanzhelfer – Gerüst, Zeitraum, Auswertung, Diagramme, Überblick
 * Die einzelnen Bereiche (Umsätze, Depot, Verträge, Mehr) stehen in ansichten.js.
 * Alles global, damit sich die beiden Dateien gegenseitig aufrufen können. */

const APP_VERSION = '1.1';

const el = (id) => document.getElementById(id);
function h(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let ansicht = 'ueberblick';
let zeit = { art:'monat', anker: heute(), von:'', bis:'' };
let filter = { konten:[], kategorie:'', suche:'', nurUnsortiert:false };
let letzteAktion = Date.now();

/* ================= Meldungen und Overlays ================= */
let toastTimer = null;
function toast(text){
  const t = el('toast');
  t.textContent = text;
  t.classList.add('auf');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('auf'), 2600);
}
function ovAuf(id){ el(id).classList.add('auf'); }
function ovZu(id){ el(id).classList.remove('auf'); }
function ovAlleZu(){ document.querySelectorAll('.ov.auf').forEach((o) => o.classList.remove('auf')); }
function infoZeigen(titel, html){
  el('info-titel').textContent = titel;
  el('info-inhalt').innerHTML = html;
  ovAuf('ov-info');
}
/* Rückfrage ohne confirm(): in einer installierten PWA sieht der Systemdialog
 * fremd aus, und auf iOS blockiert er manchmal die Animation dahinter. */
function frage(titel, text, knopfText, dann, gefahr){
  infoZeigen(titel,
    '<p class="klein leise" style="margin-top:0">' + text + '</p>' +
    '<div class="btn-reihe"><button class="btn zweit" data-tun="ov-zu">Abbrechen</button>' +
    '<button class="btn' + (gefahr ? ' gefahr' : '') + '" id="frage-ja">' + h(knopfText) + '</button></div>');
  el('frage-ja').onclick = () => { ovZu('ov-info'); dann(); };
}

/* ================= Zeitraum ================= */
function zeitGrenzen(){
  const a = ausIso(zeit.anker);
  if (zeit.art === 'monat'){
    return { von: isoTag(new Date(a.getFullYear(), a.getMonth(), 1)),
             bis: isoTag(new Date(a.getFullYear(), a.getMonth() + 1, 0)) };
  }
  if (zeit.art === 'quartal'){
    const q = Math.floor(a.getMonth() / 3) * 3;
    return { von: isoTag(new Date(a.getFullYear(), q, 1)),
             bis: isoTag(new Date(a.getFullYear(), q + 3, 0)) };
  }
  if (zeit.art === 'jahr'){
    return { von: a.getFullYear() + '-01-01', bis: a.getFullYear() + '-12-31' };
  }
  if (zeit.art === 'frei'){
    return { von: zeit.von || tageAddieren(heute(), -30), bis: zeit.bis || heute() };
  }
  return { von:'0000-01-01', bis:'9999-12-31' };      // alles
}
function zeitLabel(){
  const a = ausIso(zeit.anker);
  if (zeit.art === 'monat')   return MONATE[a.getMonth()] + ' ' + a.getFullYear();
  if (zeit.art === 'quartal') return (Math.floor(a.getMonth() / 3) + 1) + '. Quartal ' + a.getFullYear();
  if (zeit.art === 'jahr')    return String(a.getFullYear());
  if (zeit.art === 'frei'){ const g = zeitGrenzen(); return datumKurz(g.von) + ' – ' + datumKurz(g.bis); }
  return 'Gesamter Zeitraum';
}
function zeitSchieben(richtung){
  const a = ausIso(zeit.anker);
  if (zeit.art === 'monat')   zeit.anker = isoTag(new Date(a.getFullYear(), a.getMonth() + richtung, 1));
  if (zeit.art === 'quartal') zeit.anker = isoTag(new Date(a.getFullYear(), a.getMonth() + 3 * richtung, 1));
  if (zeit.art === 'jahr')    zeit.anker = isoTag(new Date(a.getFullYear() + richtung, 0, 1));
  neuZeichnen();
}
/* Ein Schritt in die Zukunft ist sinnlos, solange dort keine Buchungen liegen. */
function zeitVorMoeglich(){
  if (zeit.art === 'frei' || zeit.art === 'alles') return false;
  return zeitGrenzen().bis < heute();
}

/* ================= Auswahl und Summen ================= */
function kontenAktiv(){
  return filter.konten.length ? db.konten.filter((k) => filter.konten.includes(k.id)) : db.konten;
}
function kontoPasst(kontoId){
  return !filter.konten.length || filter.konten.includes(kontoId);
}
function umsaetzeVon(vonBis){
  const g = vonBis || zeitGrenzen();
  return db.umsaetze.filter((u) => u.datum >= g.von && u.datum <= g.bis && kontoPasst(u.kontoId));
}
/* Umbuchungen fallen aus jeder Summe heraus, Sparen wird eigens geführt. */
function summen(liste){
  const s = { ein:0, aus:0, spar:0, anzahl: liste.length };
  liste.forEach((u) => {
    const art = kat(u.kategorie).art;
    if (art === 'neutral') return;
    if (art === 'spar'){ s.spar += Math.abs(u.betrag); return; }
    if (u.betrag >= 0) s.ein += u.betrag; else s.aus += -u.betrag;
  });
  s.saldo = s.ein - s.aus - s.spar;
  return s;
}
function katSummen(liste, art){
  const map = new Map();
  liste.forEach((u) => {
    const k = kat(u.kategorie);
    if (k.art !== art) return;
    map.set(k.id, (map.get(k.id) || 0) + Math.abs(u.betrag));
  });
  return Array.from(map.entries())
    .map(([id, wert]) => ({ id, wert, name: katName(id), farbe: katFarbe(id) }))
    .sort((a, b) => b.wert - a.wert);
}
function vermoegen(){
  let liquide = 0, schulden = 0;
  kontenAktiv().forEach((k) => {
    const betrag = Number(k.saldo) || 0;
    if (kontoart(k.art).schuld) schulden += Math.abs(betrag);
    else liquide += betrag;
  });
  const depots = filter.konten.length ? 0 : depotWert();     // Depots hängen nicht am Kontenfilter
  return { liquide, depots, schulden, gesamt: liquide + depots - schulden };
}
/* Fixkosten je Monat aus allen laufenden Verträgen. */
function fixMonatlich(){
  return db.vertraege.filter((v) => v.aktiv !== false)
    .reduce((s, v) => s + (Number(v.betrag) || 0) / turnusMonate(v.turnus), 0);
}

/* ================= Diagramme (reines SVG) ================= */
function ringSvg(teile, mitte, mitteSub){
  const summe = teile.reduce((s, t) => s + t.wert, 0);
  const r = 52, u = 2 * Math.PI * r;
  let ab = 0;
  let kreise = '';
  if (summe <= 0){
    kreise = '<circle cx="68" cy="68" r="' + r + '" fill="none" stroke="var(--rand)" stroke-width="17"/>';
  } else {
    teile.forEach((t) => {
      const anteil = t.wert / summe;
      // Winziges Stück Lücke, damit die Segmente unterscheidbar bleiben
      const laenge = Math.max(0, anteil * u - 1.5);
      kreise += '<circle cx="68" cy="68" r="' + r + '" fill="none" stroke="' + t.farbe + '" stroke-width="17"' +
        ' stroke-dasharray="' + laenge.toFixed(2) + ' ' + (u - laenge).toFixed(2) + '"' +
        ' stroke-dashoffset="' + (-ab * u).toFixed(2) + '" stroke-linecap="butt"/>';
      ab += anteil;
    });
  }
  return '<svg viewBox="0 0 136 136" class="dia" role="img" aria-label="Aufteilung">' +
    '<g transform="rotate(-90 68 68)">' + kreise + '</g>' +
    '<text x="68" y="66" text-anchor="middle" class="ring-mitte">' + h(mitte) + '</text>' +
    '<text x="68" y="81" text-anchor="middle" class="ring-mitte klein2">' + h(mitteSub || '') + '</text>' +
    '</svg>';
}

/* Zwei Balken je Zeitabschnitt: Einnahmen und Ausgaben. */
function balkenSvg(punkte){
  const B = 360, H = 165, links = 6, rechts = 6, unten = 20, oben = 8;
  const max = Math.max(1, ...punkte.map((p) => Math.max(p.ein, p.aus)));
  const stufe = skalaStufe(max);
  const spur = (B - links - rechts) / Math.max(1, punkte.length);
  const hoehe = H - unten - oben;
  let s = '';
  // Gitterlinien mit Beschriftung
  for (let w = 0; w <= max * 1.001; w += stufe){
    const y = oben + hoehe - (w / max) * hoehe;
    s += '<line class="gitter" x1="' + links + '" y1="' + y.toFixed(1) + '" x2="' + (B - rechts) + '" y2="' + y.toFixed(1) + '"/>';
    if (w > 0) s += '<text x="' + (links + 2) + '" y="' + (y - 2).toFixed(1) + '">' + NF_EUR0.format(w).replace(/\s?€/, '') + '</text>';
  }
  punkte.forEach((p, i) => {
    const x = links + i * spur;
    const bw = Math.min(13, spur / 2.6);
    const hE = (p.ein / max) * hoehe, hA = (p.aus / max) * hoehe;
    const xE = x + spur / 2 - bw - 1.5, xA = x + spur / 2 + 1.5;
    s += '<rect x="' + xE.toFixed(1) + '" y="' + (oben + hoehe - hE).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, hE).toFixed(1) + '" rx="2" fill="var(--plus)"/>';
    s += '<rect x="' + xA.toFixed(1) + '" y="' + (oben + hoehe - hA).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, hA).toFixed(1) + '" rx="2" fill="var(--minus)"/>';
    // Bei vielen Abschnitten nur jede zweite Marke, sonst überlappen die Texte.
    // Gezählt wird vom Ende her: der aktuelle Abschnitt ist immer beschriftet.
    if (punkte.length <= 8 || (punkte.length - 1 - i) % 2 === 0)
      s += '<text x="' + (x + spur / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + h(p.name) + '</text>';
  });
  s += '<line class="achse" x1="' + links + '" y1="' + (oben + hoehe) + '" x2="' + (B - rechts) + '" y2="' + (oben + hoehe) + '"/>';
  return '<svg viewBox="0 0 ' + B + ' ' + H + '" class="dia" role="img" aria-label="Einnahmen und Ausgaben">' + s + '</svg>';
}

/* Fläche + Linie für den Verlauf des Guthabens. */
function linieSvg(punkte){
  const B = 360, H = 150, links = 6, rechts = 6, unten = 20, oben = 10;
  const werte = punkte.map((p) => p.wert);
  let max = Math.max(...werte), min = Math.min(...werte, 0);
  if (max === min) max = min + 1;
  const spanne = max - min;
  const hoehe = H - unten - oben, breite = B - links - rechts;
  const xVon = (i) => links + (punkte.length < 2 ? breite / 2 : (i / (punkte.length - 1)) * breite);
  const yVon = (w) => oben + hoehe - ((w - min) / spanne) * hoehe;

  const pfad = punkte.map((p, i) => (i ? 'L' : 'M') + xVon(i).toFixed(1) + ' ' + yVon(p.wert).toFixed(1)).join(' ');
  const flaeche = pfad + ' L' + xVon(punkte.length - 1).toFixed(1) + ' ' + yVon(min).toFixed(1) +
                  ' L' + xVon(0).toFixed(1) + ' ' + yVon(min).toFixed(1) + ' Z';
  let s = '<defs><linearGradient id="verlauf-fl" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="var(--akzent)" stop-opacity=".28"/>' +
          '<stop offset="100%" stop-color="var(--akzent)" stop-opacity="0"/></linearGradient></defs>';
  // Nulllinie nur zeigen, wenn sie im Bild liegt
  if (min < 0) s += '<line class="gitter" x1="' + links + '" y1="' + yVon(0).toFixed(1) + '" x2="' + (B - rechts) + '" y2="' + yVon(0).toFixed(1) + '"/>';
  s += '<path d="' + flaeche + '" fill="url(#verlauf-fl)"/>';
  s += '<path d="' + pfad + '" fill="none" stroke="var(--akzent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
  const schritt = Math.max(1, Math.ceil(punkte.length / 6));
  punkte.forEach((p, i) => {
    if (punkte.length <= 8 || (punkte.length - 1 - i) % schritt === 0)
      s += '<text x="' + xVon(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + h(p.name) + '</text>';
  });
  const letzter = punkte[punkte.length - 1];
  if (letzter) s += '<circle cx="' + xVon(punkte.length - 1).toFixed(1) + '" cy="' + yVon(letzter.wert).toFixed(1) + '" r="3.4" fill="var(--akzent)"/>';
  return '<svg viewBox="0 0 ' + B + ' ' + H + '" class="dia" role="img" aria-label="Verlauf">' + s + '</svg>';
}

/* Runde Gitterabstände: 1, 2, 5 × Zehnerpotenz. Gezielt so gewählt, dass
 * drei bis vier Linien herauskommen – bei einer einzigen wirkt das Diagramm leer. */
function skalaStufe(max){
  const roh = max / 3;
  const zehn = Math.pow(10, Math.floor(Math.log10(Math.max(1, roh))));
  const rest = roh / zehn;
  return (rest > 6 ? 10 : rest > 2.5 ? 5 : rest > 1.2 ? 2 : 1) * zehn;
}

/* ================= Reihen für die Diagramme ================= */
/* Die letzten n Abschnitte in der Körnung des gewählten Zeitraums. */
function reiheAbschnitte(n){
  const art = (zeit.art === 'frei' || zeit.art === 'alles') ? 'monat' : zeit.art;
  const anker = ausIso(zeit.art === 'alles' ? heute() : zeit.anker);
  const raus = [];
  for (let i = n - 1; i >= 0; i--){
    let von, bis, name;
    if (art === 'monat'){
      const d = new Date(anker.getFullYear(), anker.getMonth() - i, 1);
      von = isoTag(d); bis = isoTag(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      name = MONATE_KURZ[d.getMonth()];
    } else if (art === 'quartal'){
      const q = Math.floor(anker.getMonth() / 3) - i;
      const d = new Date(anker.getFullYear(), q * 3, 1);
      von = isoTag(d); bis = isoTag(new Date(d.getFullYear(), d.getMonth() + 3, 0));
      name = 'Q' + (Math.floor(d.getMonth() / 3) + 1);
    } else {
      const j = anker.getFullYear() - i;
      von = j + '-01-01'; bis = j + '-12-31'; name = String(j).slice(2);
    }
    const s = summen(umsaetzeVon({ von, bis }));
    raus.push({ name, von, bis, ein: s.ein, aus: s.aus, saldo: s.saldo });
  }
  return raus;
}

/* Guthaben im Rückblick: vom heutigen Stand die Buchungen danach abziehen.
 * Nur so passt der Verlauf zum angezeigten Vermögen. */
function verlaufPunkte(abschnitte){
  const jetzt = kontenAktiv().filter((k) => !kontoart(k.art).schuld).reduce((s, k) => s + (Number(k.saldo) || 0), 0);
  const punkte = [];
  for (let i = abschnitte.length - 1; i >= 0; i--){
    const nach = db.umsaetze
      .filter((u) => u.datum > abschnitte[i].bis && kontoPasst(u.kontoId))
      .reduce((s, u) => s + u.betrag, 0);
    punkte.unshift({ name: abschnitte[i].name, wert: Math.round((jetzt - nach) * 100) / 100 });
  }
  return punkte;
}

/* ================= Überblick ================= */
function zeichneUeberblick(){
  const ziel = el('s-ueberblick');
  if (!db.konten.length && !db.umsaetze.length && !db.positionen.length){
    ziel.innerHTML = startHilfeHtml();
    return;
  }

  const v = vermoegen();
  const liste = umsaetzeVon();
  const s = summen(liste);
  const abschnitte = reiheAbschnitte(zeit.art === 'jahr' ? 5 : 12);
  const ausgaben = katSummen(liste, 'aus');
  const einnahmen = katSummen(liste, 'ein');
  const fix = fixMonatlich();
  const fristen = fristenOffen();

  let html = '';

  /* Vermögen */
  const teile = [
    { name:'Konten & Bargeld', wert: Math.max(0, v.liquide), farbe:'var(--akzent)' },
    { name:'Depots',           wert: Math.max(0, v.depots),  farbe:'var(--plus)' },
    { name:'Verbindlichkeiten',wert: v.schulden,             farbe:'var(--minus)' }
  ];
  const balkenSumme = teile.reduce((a, t) => a + t.wert, 0) || 1;
  html += '<div class="karte">' +
    '<div class="karte-kopf"><h2>Gesamtvermögen</h2><span class="mini">' + h(filter.konten.length ? 'gefiltert' : 'alle Konten') + '</span></div>' +
    '<div class="verm-summe zahl ' + (v.gesamt < 0 ? 'minus' : '') + '">' + eur(v.gesamt) + '</div>' +
    '<div class="verm-balken">' + teile.map((t) => '<i style="width:' + (t.wert / balkenSumme * 100).toFixed(2) + '%;background:' + t.farbe + '"></i>').join('') + '</div>' +
    teile.map((t) => '<div class="verm-zeile"><span><i class="punkt" style="background:' + t.farbe + '"></i>' + t.name + '</span>' +
      '<b class="zahl">' + (t.name === 'Verbindlichkeiten' && t.wert > 0 ? '−' : '') + eur(t.wert) + '</b></div>').join('') +
    '<div class="btn-reihe" style="margin-top:13px">' +
      '<button class="btn zweit" data-tun="nav:mehr">Konten verwalten</button>' +
      '<button class="btn zweit" data-tun="import">Auszug einlesen</button>' +
    '</div></div>';

  /* Kacheln */
  html += '<div class="kacheln">' +
    kachel('Einnahmen', eur(s.ein, true), 'plus') +
    kachel('Ausgaben', eur(s.aus, true), 'minus') +
    kachel(s.spar > 0 ? 'Übrig' : 'Saldo', eurVz(s.saldo, true), s.saldo >= 0 ? 'plus' : 'minus') +
    '</div>';
  if (s.spar > 0){
    html += '<div class="kasten"><b>' + eur(s.spar) + ' angelegt</b>' +
      'Überweisungen in Sparen und Anlage zählen nicht als Ausgabe – das Geld ist weiter dein Vermögen.</div>';
  }

  /* Fristen, wenn etwas drängt */
  if (fristen.length){
    html += '<div class="karte"><div class="karte-kopf"><h2>Kündigungsfristen</h2>' +
      '<button class="mini" data-tun="nav:vertraege" style="color:var(--akzent);font-weight:600">alle ›</button></div><div class="liste">' +
      fristen.slice(0, 3).map((f) => fristZeile(f)).join('') + '</div></div>';
  }

  /* Einnahmen/Ausgaben im Verlauf */
  html += '<div class="karte"><div class="karte-kopf"><h2>Einnahmen und Ausgaben</h2>' +
    '<span class="mini"><i class="punkt" style="background:var(--plus);display:inline-block"></i> ein &nbsp;' +
    '<i class="punkt" style="background:var(--minus);display:inline-block"></i> aus</span></div>' +
    balkenSvg(abschnitte) + '</div>';

  /* Kategorien */
  html += '<div class="karte"><div class="karte-kopf"><h2>Wofür geht das Geld?</h2>' +
    '<span class="mini">' + h(zeitLabel()) + '</span></div>';
  if (ausgaben.length){
    html += '<div class="ring-box">' + ringSvg(ausgaben.slice(0, 9), eur(s.aus, true), 'Ausgaben') +
      '<div class="legende">' + ausgaben.slice(0, 7).map((k) =>
        '<button class="legende-zeile" data-tun="katfilter:' + k.id + '">' +
        '<i class="punkt" style="background:' + k.farbe + '"></i>' +
        '<span class="nam">' + h(k.name) + '</span>' +
        '<span class="pz">' + Math.round(k.wert / s.aus * 100) + '%</span>' +
        '<span class="wrt zahl">' + eur(k.wert, true) + '</span></button>').join('') +
      (ausgaben.length > 7 ? '<div class="mini leise" style="padding-top:3px">und ' + (ausgaben.length - 7) + ' weitere</div>' : '') +
      '</div></div>';
  } else {
    html += '<div class="leer">In diesem Zeitraum sind keine Ausgaben erfasst.</div>';
  }
  html += '</div>';

  if (einnahmen.length > 1){
    html += '<div class="karte"><h2>Einnahmen</h2><div class="liste">' +
      einnahmen.map((k) => '<button class="zeile" data-tun="katfilter:' + k.id + '">' +
        '<span class="sym" style="background:' + k.farbe + '22">' + kat(k.id).icon + '</span>' +
        '<span class="mitte"><span class="tit">' + h(k.name) + '</span>' +
        '<span class="sub">' + Math.round(k.wert / Math.max(1, s.ein) * 100) + ' % der Einnahmen</span></span>' +
        '<span class="rechts"><span class="betrag plus zahl">' + eur(k.wert, true) + '</span></span></button>').join('') +
      '</div></div>';
  }

  /* Verlauf */
  html += '<div class="karte"><div class="karte-kopf"><h2>Verlauf des Guthabens</h2>' +
    '<span class="mini">' + h(abschnitte.length + ' Abschnitte') + '</span></div>' +
    linieSvg(verlaufPunkte(abschnitte)) +
    '<div class="mini leise" style="margin-top:6px">Rückgerechnet aus dem heutigen Kontostand und den erfassten Buchungen.</div></div>';

  /* Fixkosten */
  const vertraegeAktiv = db.vertraege.filter((x) => x.aktiv !== false);
  html += '<div class="karte"><div class="karte-kopf"><h2>Laufende Fixkosten</h2>' +
    '<button class="mini" data-tun="nav:vertraege" style="color:var(--akzent);font-weight:600">Verträge ›</button></div>';
  if (vertraegeAktiv.length){
    const top = vertraegeAktiv.slice().sort((a, b) => b.betrag / turnusMonate(b.turnus) - a.betrag / turnusMonate(a.turnus));
    html += '<div class="kacheln" style="margin-bottom:11px">' +
      kachel('pro Monat', eur(fix, true)) +
      kachel('pro Jahr', eur(fix * 12, true)) +
      kachel('Verträge', String(vertraegeAktiv.length)) + '</div>' +
      '<div class="liste">' + top.slice(0, 5).map((vv) =>
        '<button class="zeile" data-tun="vertrag:' + vv.id + '">' +
        '<span class="sym" style="background:' + katFarbe(vv.kategorie) + '22">' + kat(vv.kategorie).icon + '</span>' +
        '<span class="mitte"><span class="tit">' + h(vv.name) + '</span>' +
        '<span class="sub">' + h(turnusName(vv.turnus)) + ' · ' + eur(vv.betrag) + '</span></span>' +
        '<span class="rechts"><span class="betrag zahl">' + eur(vv.betrag / turnusMonate(vv.turnus), true) + '</span>' +
        '<span class="sub">pro Monat</span></span></button>').join('') + '</div>';
  } else {
    const anzahl = db.umsaetze.length ? wiederkehrendeOffen().length : 0;
    html += '<div class="leer"><b>Noch keine Verträge erfasst</b>' +
      (anzahl ? 'Aus deinen Buchungen lassen sich ' + anzahl + ' wiederkehrende Zahlungen erkennen.'
              : 'Trage Abos und Verträge ein, um die Fixkosten zu sehen.') +
      '<div class="btn-reihe" style="margin-top:12px;justify-content:center"><button class="btn" data-tun="nav:vertraege">Zu den Verträgen</button></div></div>';
  }
  html += '</div>';

  ziel.innerHTML = html;
}

function kachel(titel, wert, klasse){
  return '<div class="kachel"><span class="wert zahl ' + (klasse || '') + '">' + h(wert) + '</span>' +
         '<span class="titel">' + h(titel) + '</span></div>';
}

function startHilfeHtml(){
  return '<div class="karte" id="start-hilfe">' +
    '<h2 style="font-size:18px;margin-bottom:4px">Willkommen beim Finanzhelfer</h2>' +
    '<p class="klein leise" style="margin:0 0 14px">Einnahmen, Ausgaben, Depots und laufende Verträge an einer Stelle. ' +
    'Alles bleibt auf diesem Gerät – es gibt kein Konto und keinen Server.</p>' +
    '<div class="hilfe-schritt"><i class="nr">1</i><div><b>Beispieldaten ansehen</b>' +
    '<div class="klein leise">Ein halbes Jahr erfundener Buchungen, damit du siehst, was die App kann. Lässt sich jederzeit wieder löschen.</div></div></div>' +
    '<div class="hilfe-schritt"><i class="nr">2</i><div><b>Eigenen Kontoauszug einlesen</b>' +
    '<div class="klein leise">CSV, CAMT.053 oder MT940 aus dem Online-Banking. Die Kategorien setzt die App selbst.</div></div></div>' +
    '<div class="hilfe-schritt"><i class="nr">3</i><div><b>Konto von Hand anlegen</b>' +
    '<div class="klein leise">Für Bargeld, Tagesgeld oder einen Kredit – oder um den automatischen Abruf einzurichten.</div></div></div>' +
    '<div class="btn-reihe" style="margin-top:15px">' +
      '<button class="btn" data-tun="beispiel">Beispieldaten laden</button>' +
      '<button class="btn zweit" data-tun="import">Auszug einlesen</button>' +
      '<button class="btn zweit" data-tun="konto-neu">Konto anlegen</button>' +
    '</div></div>' +
    '<div class="kasten"><b>Warum keine direkte Bankanbindung?</b>' +
    'Eine Seite im Browser darf und kann nicht selbst mit deiner Bank sprechen. Für den automatischen, ' +
    'regelmäßigen Abruf richtest du unter <i>Mehr → Automatischer Abruf</i> eine eigene Brücke ein. ' +
    'Ohne das funktioniert alles über den heruntergeladenen Auszug.</div>';
}

/* ================= Fristen ================= */
/* Verträge, deren Kündigungsfrist in den nächsten Tagen abläuft. Gerechnet
 * wird vom Vertragsende zurück: letzter Kündigungstag = Ende − Frist. */
function letzterKuendigungstag(v){
  if (!v.ende) return '';
  return tageAddieren(v.ende, -(Number(v.frist) || 0));
}
function fristenOffen(){
  const raus = [];
  db.vertraege.forEach((v) => {
    if (v.aktiv === false) return;
    const tag = letzterKuendigungstag(v);
    if (!tag) return;
    const tage = tageBis(tag);
    const vorlauf = Number(v.erinnerung) || 30;
    if (tage <= vorlauf) raus.push({ v, tag, tage });
  });
  return raus.sort((a, b) => a.tage - b.tage);
}
function fristZeile(f){
  const dringend = f.tage <= 7;
  const text = f.tage < 0 ? 'Frist ist am ' + datumKurz(f.tag) + ' abgelaufen'
             : f.tage === 0 ? 'Heute ist der letzte Tag zum Kündigen'
             : 'noch ' + f.tage + ' Tag' + (f.tage === 1 ? '' : 'e') + ' – bis ' + datumKurz(f.tag);
  return '<button class="zeile" data-tun="vertrag:' + f.v.id + '">' +
    '<span class="sym" style="background:' + (f.tage < 0 ? 'var(--minus)' : 'var(--warn)') + '22">' + (f.tage < 0 ? '⌛' : '🔔') + '</span>' +
    '<span class="mitte"><span class="tit">' + h(f.v.name) + '</span>' +
    '<span class="sub ' + (dringend ? 'warnfarbe' : '') + '">' + h(text) + '</span></span>' +
    '<span class="rechts"><span class="betrag zahl">' + eur(f.v.betrag) + '</span>' +
    '<span class="sub">' + h(turnusKurz(f.v.turnus)) + '</span></span></button>';
}

/* ================= Navigation und Zeichnen ================= */
const TITEL = { ueberblick:'Überblick', umsaetze:'Umsätze', depot:'Depot', vertraege:'Verträge', mehr:'Mehr' };

function zeigeAnsicht(name){
  ansicht = name;
  ['ueberblick','umsaetze','depot','vertraege','mehr'].forEach((a) => {
    el('s-' + a).classList.toggle('versteckt', a !== name);
  });
  document.querySelectorAll('#fuss button').forEach((b) => b.classList.toggle('an', b.dataset.an === name));
  el('kopf-titel').textContent = TITEL[name];
  // Der Zeitraum betrifft nur Überblick und Umsätze
  el('zeitleiste').classList.toggle('versteckt', name !== 'ueberblick' && name !== 'umsaetze');
  window.scrollTo(0, 0);
  neuZeichnen();
}

function neuZeichnen(){
  if (!db) return;
  el('zeit-text').textContent = zeitLabel();
  el('zeit-sub').textContent = filter.konten.length
    ? filter.konten.length + ' von ' + db.konten.length + ' Konten'
    : (db.konten.length ? 'Alle Konten' : 'Noch kein Konto');
  el('zeit-vor').disabled = !zeitVorMoeglich();
  el('btn-sperren').classList.toggle('versteckt', !istVerschluesselt());

  const offen = fristenOffen().length + wiederkehrendeOffen().length;
  const kerbe = el('kerbe-vertraege');
  kerbe.textContent = offen > 9 ? '9+' : String(offen);
  kerbe.classList.toggle('versteckt', offen === 0);

  if (ansicht === 'ueberblick') zeichneUeberblick();
  if (ansicht === 'umsaetze')   zeichneUmsaetze();
  if (ansicht === 'depot')      zeichneDepot();
  if (ansicht === 'vertraege')  zeichneVertraege();
  if (ansicht === 'mehr')       zeichneMehr();
}

/* ================= Zeitraum-Fenster ================= */
function zeitFensterAuf(){
  const g = zeitGrenzen();
  const arten = [['monat','Monat'],['quartal','Quartal'],['jahr','Jahr'],['alles','Alles'],['frei','Frei']];
  el('zeit-inhalt').innerHTML =
    '<div class="feld"><label>Körnung</label><div class="chips">' +
      arten.map(([id, nam]) => '<button class="chip' + (zeit.art === id ? ' an' : '') + '" data-zeitart="' + id + '">' + nam + '</button>').join('') +
    '</div></div>' +
    (zeit.art === 'frei'
      ? '<div class="feld-paar"><div class="feld"><label>Von</label><input type="date" id="zeit-von" value="' + g.von + '"></div>' +
        '<div class="feld"><label>Bis</label><input type="date" id="zeit-bis" value="' + g.bis + '"></div></div>'
      : '') +
    '<div class="feld"><label>Konten</label><div class="chips">' +
      '<button class="chip' + (filter.konten.length ? '' : ' an') + '" data-ktofilter="">Alle</button>' +
      db.konten.map((k) => '<button class="chip' + (filter.konten.includes(k.id) ? ' an' : '') + '" data-ktofilter="' + k.id + '">' +
        kontoart(k.art).icon + ' ' + h(k.name) + '</button>').join('') +
    '</div></div>' +
    '<p class="hinw">Der Kontenfilter gilt für Überblick und Umsätze. Depots bleiben davon unberührt.</p>' +
    '<button class="btn voll" data-tun="ov-zu">Fertig</button>';

  el('zeit-inhalt').querySelectorAll('[data-zeitart]').forEach((b) => {
    b.onclick = () => {
      zeit.art = b.dataset.zeitart;
      if (zeit.art === 'frei' && !zeit.von){ zeit.von = tageAddieren(heute(), -30); zeit.bis = heute(); }
      zeitFensterAuf(); neuZeichnen();
    };
  });
  el('zeit-inhalt').querySelectorAll('[data-ktofilter]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.ktofilter;
      if (!id) filter.konten = [];
      else if (filter.konten.includes(id)) filter.konten = filter.konten.filter((x) => x !== id);
      else filter.konten.push(id);
      zeitFensterAuf(); neuZeichnen();
    };
  });
  const vonEl = el('zeit-von');
  if (vonEl){
    const uebernehmen = () => { zeit.von = el('zeit-von').value; zeit.bis = el('zeit-bis').value; neuZeichnen(); };
    vonEl.onchange = uebernehmen; el('zeit-bis').onchange = uebernehmen;
  }
  ovAuf('ov-zeit');
}

/* ================= Aktionen ================= */
function tunAusfuehren(was){
  // Nur am ERSTEN Doppelpunkt trennen – Vorschlags-Signaturen können selbst einen enthalten
  const trenn = was.indexOf(':');
  const befehl = trenn < 0 ? was : was.slice(0, trenn);
  const arg = trenn < 0 ? '' : was.slice(trenn + 1);
  switch (befehl){
    case 'nav':          zeigeAnsicht(arg); break;
    case 'ov-zu':        ovAlleZu(); break;
    case 'zeit':         zeitFensterAuf(); break;
    case 'import':       importFensterAuf(); break;
    case 'beispiel':     beispielLaden(); break;
    case 'katfilter':
      filter.kategorie = arg; filter.suche = ''; zeigeAnsicht('umsaetze'); break;
    case 'konto-neu':    kontoFensterAuf(null); break;
    case 'konto':        kontoFensterAuf(arg); break;
    case 'umsatz-neu':   umsatzFensterAuf(null); break;
    case 'umsatz':       umsatzFensterAuf(arg); break;
    case 'pos-neu':      posFensterAuf(null); break;
    case 'pos':          posFensterAuf(arg); break;
    case 'depot':        depotFensterAuf(arg); break;
    case 'depotsync':    depotSyncJetzt(arg); break;
    case 'vertrag-neu':  vertragFensterAuf(null); break;
    case 'vertrag':      vertragFensterAuf(arg); break;
    case 'vorschlag':    vorschlagUebernehmen(arg); break;
    case 'vorschlag-weg':vorschlagAblehnen(arg); break;
    case 'kurse':        kurseJetzt(); break;
    case 'abgleich':     abgleichJetzt(); break;
    case 'drucken':      berichtDrucken(); break;
    case 'csv':          csvExport(arg); break;
    case 'zurueckspielen': sicherungEinlesen(); break;
    case 'sperre-ein':   sperreFensterAuf(); break;
    case 'sperre-aus':   sperreAufhebenFragen(); break;
    case 'alles-weg':    allesLoeschenFragen(); break;
    case 'info':         infoThema(arg); break;
    default: console.warn('Unbekannte Aktion', was);
  }
}

function beispielLaden(){
  if (db.konten.length || db.umsaetze.length){
    frage('Beispieldaten laden?', 'Es sind schon Daten vorhanden. Die Beispiele kommen zusätzlich dazu.', 'Trotzdem laden', () => {
      beispieldatenLaden(); toast('Beispieldaten geladen'); neuZeichnen();
    });
    return;
  }
  beispieldatenLaden();
  toast('Beispieldaten geladen');
  neuZeichnen();
}

/* ================= Selbstsperre ================= */
function sperrePruefen(){
  if (!db || !istVerschluesselt()) return;
  const min = Number(db.einst.sperreMin) || 0;
  if (!min) return;
  if (Date.now() - letzteAktion > min * 60000) jetztSperren();
}
async function jetztSperren(){
  if (!db || !istVerschluesselt()) return;
  await sichernJetzt();
  sperren();
  ovAlleZu();
  el('sp-pass').value = '';
  el('sp-fehler').textContent = '';
  el('sperre').classList.add('auf');
  setTimeout(() => el('sp-pass').focus(), 120);
}

/* ================= Start ================= */
function starten(){
  /* Fußleiste */
  document.querySelectorAll('#fuss button').forEach((b) => {
    b.onclick = () => zeigeAnsicht(b.dataset.an);
  });
  el('zeit-zurueck').onclick = () => zeitSchieben(-1);
  el('zeit-vor').onclick = () => zeitSchieben(1);
  el('zeit-wahl').onclick = zeitFensterAuf;
  el('btn-mehr-kopf').onclick = () => zeigeAnsicht('mehr');
  el('btn-sperren').onclick = jetztSperren;

  /* Ein Klickfänger für alles, was aus innerHTML entsteht */
  document.addEventListener('click', (e) => {
    letzteAktion = Date.now();
    const zu = e.target.closest('[data-zu]');
    if (zu){ zu.closest('.ov').classList.remove('auf'); return; }
    const knopf = e.target.closest('[data-tun]');
    if (knopf){ e.preventDefault(); tunAusfuehren(knopf.dataset.tun); }
  });
  /* Klick auf den dunklen Rand schließt das Fenster */
  document.querySelectorAll('.ov').forEach((o) => {
    o.addEventListener('click', (e) => { if (e.target === o) o.classList.remove('auf'); });
  });
  document.addEventListener('keydown', (e) => {
    letzteAktion = Date.now();
    if (e.key === 'Escape') ovAlleZu();
  });
  ['pointerdown','touchstart','wheel'].forEach((ev) =>
    document.addEventListener(ev, () => { letzteAktion = Date.now(); }, { passive:true }));

  el('kopf').classList.toggle('scrollt', window.scrollY > 4);
  window.addEventListener('scroll', () => {
    el('kopf').classList.toggle('scrollt', window.scrollY > 4);
  }, { passive:true });

  /* Sperrschirm */
  el('sp-form').onsubmit = async (e) => {
    e.preventDefault();
    const pass = el('sp-pass').value;
    if (!pass) return;
    el('sp-fehler').textContent = 'Prüfe …';
    const ok = await entsperren(pass);
    if (!ok){ el('sp-fehler').textContent = 'Passphrase passt nicht.'; return; }
    el('sp-pass').value = '';
    el('sp-fehler').textContent = '';
    el('sperre').classList.remove('auf');
    nachDemOeffnen();
  };

  /* Vor dem Schließen des Tabs unbedingt schreiben */
  window.addEventListener('pagehide', () => { if (db) sichernJetzt(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){ if (db) sichernJetzt(); }
    else sperrePruefen();
  });
  setInterval(sperrePruefen, 30000);

  /* Los */
  if (ladeKlartext()){
    nachDemOeffnen();
  } else {
    el('sperre').classList.add('auf');
    setTimeout(() => el('sp-pass').focus(), 150);
  }

  if ('serviceWorker' in navigator){
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}

/* Läuft, sobald ein Bestand offen ist – nach dem Laden oder nach dem Entsperren. */
function nachDemOeffnen(){
  letzteAktion = Date.now();
  zeigeAnsicht(db.einst.startAnsicht || 'ueberblick');
  // Kurse höchstens einmal am Tag von allein nachladen
  if (db.einst.autoKurse && db.positionen.some((p) => p.symbol)){
    const alt = !db.zuletztKurse || (Date.now() - new Date(db.zuletztKurse).getTime()) > 20 * 3600 * 1000;
    if (alt && navigator.onLine) kurseAktualisieren().then((b) => { if (b.erneuert) neuZeichnen(); });
  }
  // Fällige Fristen melden, wenn der Nutzer das erlaubt hat
  fristenMelden();
}

starten();
