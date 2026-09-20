/* Finanzhelfer – Umsätze, Depot, Verträge, Mehr, Import, Export
 * Das Grundgerüst (Navigation, Zeitraum, Diagramme, Überblick) steht in app.js. */

/* ---------- kleine Bausteine ---------- */
function optHtml(liste, wert){
  return liste.map((o) => '<option value="' + h(o.id) + '"' + (String(o.id) === String(wert) ? ' selected' : '') + '>' + h(o.name) + '</option>').join('');
}
function feldHtml(label, innen, hinweis){
  return '<div class="feld"><label>' + h(label) + '</label>' + innen + '</div>' +
         (hinweis ? '<p class="hinw">' + hinweis + '</p>' : '');
}
function eingabe(id, wert, typ, platzhalter){
  return '<input id="' + id + '" type="' + (typ || 'text') + '" value="' + h(wert === null || wert === undefined ? '' : wert) + '"' +
         (platzhalter ? ' placeholder="' + h(platzhalter) + '"' : '') +
         (typ === 'number' ? ' step="0.01" inputmode="decimal"' : '') + '>';
}
function wert(id){ const e = el(id); return e ? e.value.trim() : ''; }
function wertZahl(id){ return impZahl(wert(id)) || 0; }
function angehakt(id){ const e = el(id); return !!(e && e.checked); }
function schalterHtml(id, titel, text, an){
  return '<label class="schalter"><span class="mitte"><b style="font-weight:600;font-size:14.5px">' + h(titel) + '</b>' +
    (text ? '<div class="klein leise">' + text + '</div>' : '') + '</span>' +
    '<input type="checkbox" id="' + id + '"' + (an ? ' checked' : '') + '></label>';
}
/* Beim Neuzeichnen den Schreibcursor nicht verlieren. */
function mitFokus(fn){
  const a = document.activeElement;
  const id = a && a.id, pos = a && a.selectionStart;
  fn();
  if (id && el(id)){
    el(id).focus();
    if (pos !== null && pos !== undefined && el(id).setSelectionRange){
      try { el(id).setSelectionRange(pos, pos); } catch (e){ /* bei type=date nicht erlaubt */ }
    }
  }
}
function kontoName(id){
  const k = db.konten.find((x) => x.id === id);
  return k ? k.name : 'Ohne Konto';
}

/* ===================================================================
 * UMSÄTZE
 * =================================================================== */
function zeichneUmsaetze(){
  mitFokus(() => {
    const ziel = el('s-umsaetze');
    let liste = umsaetzeVon();
    if (filter.kategorie) liste = liste.filter((u) => u.kategorie === filter.kategorie);
    if (filter.nurUnsortiert) liste = liste.filter((u) => u.kategorie === 'sonstiges' || u.kategorie === 'einnahmen');
    if (filter.suche){
      const s = normal(filter.suche);
      liste = liste.filter((u) => normal(u.gegen + ' ' + u.zweck + ' ' + u.notiz).includes(s) || String(Math.abs(u.betrag)).includes(s));
    }
    liste = liste.slice().sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
    const s = summen(liste);

    // Nur Kategorien anbieten, die im Zeitraum vorkommen
    const vorhanden = new Set(umsaetzeVon().map((u) => u.kategorie));
    const chips = KATEGORIEN.filter((k) => vorhanden.has(k.id));

    let html =
      '<div class="karte" style="padding:12px 13px">' +
        feldHtml('Suche', eingabe('ums-suche', filter.suche, 'search', 'Empfänger, Zweck oder Betrag')) +
        '<div class="chips" style="padding-bottom:0">' +
          '<button class="chip' + (!filter.kategorie && !filter.nurUnsortiert ? ' an' : '') + '" data-katchip="">Alle</button>' +
          '<button class="chip' + (filter.nurUnsortiert ? ' an' : '') + '" data-katchip="?">Unsortiert</button>' +
          chips.map((k) => '<button class="chip' + (filter.kategorie === k.id ? ' an' : '') + '" data-katchip="' + k.id + '">' +
            k.icon + ' ' + h(k.name) + '</button>').join('') +
        '</div>' +
      '</div>' +
      '<div class="kacheln">' +
        kachel('Einnahmen', eur(s.ein, true), 'plus') +
        kachel('Ausgaben', eur(s.aus, true), 'minus') +
        kachel('Buchungen', String(s.anzahl)) +
      '</div>' +
      '<div class="btn-reihe" style="margin-bottom:13px">' +
        '<button class="btn" data-tun="umsatz-neu">Buchung erfassen</button>' +
        '<button class="btn zweit" data-tun="import">Auszug einlesen</button>' +
      '</div>';

    if (!liste.length){
      html += '<div class="karte"><div class="leer"><b>Keine Buchungen</b>' +
        (db.umsaetze.length ? 'In diesem Zeitraum und Filter liegt nichts.' : 'Lies einen Kontoauszug ein oder erfasse eine Buchung von Hand.') +
        '</div></div>';
    } else {
      html += '<div class="karte"><div class="liste">';
      let letzterTag = '';
      liste.forEach((u) => {
        if (u.datum !== letzterTag){
          letzterTag = u.datum;
          html += '<div class="tag-kopf">' + h(datumLang(u.datum)) + '</div>';
        }
        html += umsatzZeile(u);
      });
      html += '</div></div>';
    }
    ziel.innerHTML = html;

    el('ums-suche').oninput = (e) => { filter.suche = e.target.value; zeichneUmsaetze(); };
    ziel.querySelectorAll('[data-katchip]').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.katchip;
        if (v === '?'){ filter.nurUnsortiert = !filter.nurUnsortiert; filter.kategorie = ''; }
        else { filter.kategorie = (filter.kategorie === v ? '' : v); filter.nurUnsortiert = false; }
        zeichneUmsaetze();
      };
    });
  });
}

function umsatzZeile(u){
  const k = kat(u.kategorie);
  const konto = db.konten.find((x) => x.id === u.kontoId);
  const unten = [k.name, konto ? konto.name : null, u.vertragId ? '🔁 Vertrag' : null].filter(Boolean).join(' · ');
  return '<button class="zeile" data-tun="umsatz:' + u.id + '">' +
    '<span class="sym" style="background:' + k.farbe + '22">' + k.icon + '</span>' +
    '<span class="mitte"><span class="tit">' + h(u.gegen || u.zweck || 'Buchung') + '</span>' +
    '<span class="sub">' + h(unten) + '</span></span>' +
    '<span class="rechts"><span class="betrag zahl ' + (u.betrag >= 0 ? 'plus' : '') + '">' + eurVz(u.betrag) + '</span>' +
    (u.waehrung && u.waehrung !== 'EUR' ? '<span class="sub">' + h(u.waehrung) + '</span>' : '') + '</span></button>';
}

/* ---------- Buchung bearbeiten ---------- */
function umsatzFensterAuf(id){
  const neu = !id;
  const u = neu
    ? { id:'', kontoId: (db.konten[0] || {}).id || '', datum: heute(), betrag:0, gegen:'', zweck:'',
        kategorie:'sonstiges', notiz:'', vertragId:'', waehrung:'EUR', quelle:'manuell' }
    : db.umsaetze.find((x) => x.id === id);
  if (!u) return;

  if (!db.konten.length){
    infoZeigen('Erst ein Konto', '<p class="klein leise">Eine Buchung braucht ein Konto. Lege zuerst eines an.</p>' +
      '<button class="btn voll" data-tun="konto-neu">Konto anlegen</button>');
    return;
  }

  el('ums-titel').textContent = neu ? 'Buchung erfassen' : 'Buchung';
  const ausgabe = u.betrag < 0 || (neu && true);
  el('ums-inhalt').innerHTML =
    '<div class="chips" style="padding-bottom:12px">' +
      '<button class="chip' + (ausgabe ? ' an' : '') + '" id="ums-aus">− Ausgabe</button>' +
      '<button class="chip' + (ausgabe ? '' : ' an') + '" id="ums-ein">+ Einnahme</button>' +
    '</div>' +
    feldHtml('Betrag', eingabe('ums-betrag', Math.abs(u.betrag) || '', 'number', '0,00')) +
    '<div class="feld-paar">' +
      feldHtml('Datum', eingabe('ums-datum', u.datum, 'date')) +
      feldHtml('Konto', '<select id="ums-konto">' + optHtml(db.konten, u.kontoId) + '</select>') +
    '</div>' +
    feldHtml('Empfänger oder Auftraggeber', eingabe('ums-gegen', u.gegen, 'text', 'z. B. REWE Markt GmbH')) +
    feldHtml('Verwendungszweck', eingabe('ums-zweck', u.zweck, 'text')) +
    feldHtml('Kategorie', '<select id="ums-kat">' + optHtml(KATEGORIEN, u.kategorie) + '</select>') +
    (db.vertraege.length
      ? feldHtml('Gehört zu einem Vertrag', '<select id="ums-vertrag"><option value="">– keiner –</option>' +
          optHtml(db.vertraege, u.vertragId) + '</select>')
      : '') +
    feldHtml('Notiz', '<textarea id="ums-notiz">' + h(u.notiz) + '</textarea>') +
    (u.gegen ? schalterHtml('ums-regel', 'Immer so einsortieren',
        'Legt die Regel „' + h(u.gegen.slice(0, 28)) + '“ → ' + h(katName(u.kategorie)) + ' an und sortiert alle passenden Buchungen um.', false) : '') +
    (u.quelle && u.quelle !== 'manuell'
      ? '<p class="hinw">Quelle: ' + h(u.quelle === 'api' ? 'automatischer Abruf' : u.quelle === 'beispiel' ? 'Beispieldaten' : 'Kontoauszug') +
        '. Änderungen an Betrag oder Datum wirken sich nicht auf den Kontostand aus – der kommt aus dem Auszug.</p>'
      : '<p class="hinw">Von Hand erfasste Buchungen verändern den Kontostand des gewählten Kontos mit.</p>') +
    '<div class="btn-reihe" style="margin-top:4px">' +
      (neu ? '' : '<button class="btn gefahr" id="ums-weg">Löschen</button>') +
      '<button class="btn" id="ums-ok">' + (neu ? 'Erfassen' : 'Speichern') + '</button>' +
    '</div>';

  let istAusgabe = ausgabe;
  const umschalten = (aus) => {
    istAusgabe = aus;
    el('ums-aus').classList.toggle('an', aus);
    el('ums-ein').classList.toggle('an', !aus);
    // Vorschlag für die Kategorie mitziehen, solange noch nichts Eigenes steht
    const k = kat(el('ums-kat').value);
    if (aus && k.art === 'ein') el('ums-kat').value = 'sonstiges';
    if (!aus && k.art === 'aus') el('ums-kat').value = 'einnahmen';
  };
  el('ums-aus').onclick = () => umschalten(true);
  el('ums-ein').onclick = () => umschalten(false);

  el('ums-ok').onclick = () => {
    const betrag = Math.abs(wertZahl('ums-betrag')) * (istAusgabe ? -1 : 1);
    if (!betrag){ toast('Bitte einen Betrag eintragen'); return; }
    const kontoId = wert('ums-konto');
    const alterBetrag = neu ? 0 : u.betrag;
    const altesKonto = u.kontoId;

    const neueWerte = {
      kontoId, datum: wert('ums-datum') || heute(), betrag,
      gegen: wert('ums-gegen'), zweck: wert('ums-zweck'),
      kategorie: el('ums-kat').value, notiz: wert('ums-notiz'),
      vertragId: el('ums-vertrag') ? el('ums-vertrag').value : u.vertragId
    };

    if (neu){
      const frisch = umsatzBauen(Object.assign({ quelle:'manuell' }, neueWerte, { kategorie:neueWerte.kategorie }));
      frisch.manuellKat = true;
      db.umsaetze.push(frisch);
      db.umsaetze.sort((a, b) => (a.datum < b.datum ? 1 : -1));
      saldoAendern(kontoId, betrag);
    } else {
      if (neueWerte.kategorie !== u.kategorie) u.manuellKat = true;
      Object.assign(u, neueWerte);
      u.sig = umsatzSignatur(u);
      if (u.quelle === 'manuell'){
        // Alten Einfluss zurücknehmen, neuen buchen – auch bei Kontowechsel
        saldoAendern(altesKonto, -alterBetrag);
        saldoAendern(kontoId, betrag);
      }
    }

    if (angehakt('ums-regel') && neueWerte.gegen){
      db.regeln.push({ id: neueId(), muster: neueWerte.gegen.slice(0, 32), kat: neueWerte.kategorie });
      const n = kategorienNeuRaten();
      toast(n ? n + ' weitere Buchungen umsortiert' : 'Regel gespeichert');
    } else {
      toast(neu ? 'Buchung erfasst' : 'Gespeichert');
    }
    sichern(); ovZu('ov-umsatz'); neuZeichnen();
  };

  if (!neu) el('ums-weg').onclick = () => {
    frage('Buchung löschen?', 'Die Buchung wird entfernt. Bei einer von Hand erfassten Buchung geht der Betrag auch aus dem Kontostand heraus.', 'Löschen', () => {
      if (u.quelle === 'manuell') saldoAendern(u.kontoId, -u.betrag);
      db.umsaetze = db.umsaetze.filter((x) => x.id !== u.id);
      sichern(); ovZu('ov-umsatz'); neuZeichnen(); toast('Gelöscht');
    }, true);
  };

  ovAuf('ov-umsatz');
}

/* Kontostand mitziehen. Bei Schuldkonten wächst die offene Summe, wenn Geld
 * abfließt – deshalb das umgekehrte Vorzeichen. */
function saldoAendern(kontoId, betrag){
  const k = db.konten.find((x) => x.id === kontoId);
  if (!k) return;
  const richtung = kontoart(k.art).schuld ? -1 : 1;
  k.saldo = Math.round(((Number(k.saldo) || 0) + betrag * richtung) * 100) / 100;
  k.saldoStand = heute();
}

/* ===================================================================
 * KONTEN
 * =================================================================== */
function kontoFensterAuf(id){
  const neu = !id;
  const k = neu
    ? { id:'', name:'', bank:'', iban:'', art:'giro', waehrung:'EUR', saldo:0,
        saldoStand: heute(), dienst:'auszug', apiRef:'', farbe: DEPOT_FARBEN[db.konten.length % DEPOT_FARBEN.length] }
    : db.konten.find((x) => x.id === id);
  if (!k) return;

  const anzahl = neu ? 0 : db.umsaetze.filter((u) => u.kontoId === k.id).length;
  el('kto-titel').textContent = neu ? 'Konto anlegen' : k.name || 'Konto';
  el('kto-inhalt').innerHTML =
    feldHtml('Bezeichnung', eingabe('kto-name', k.name, 'text', 'z. B. Girokonto')) +
    '<div class="feld-paar">' +
      feldHtml('Bank', eingabe('kto-bank', k.bank, 'text', 'z. B. Sparkasse')) +
      feldHtml('Art', '<select id="kto-art">' + optHtml(KONTOARTEN, k.art) + '</select>') +
    '</div>' +
    feldHtml('IBAN (freiwillig)', eingabe('kto-iban', k.iban, 'text', 'DE…')) +
    '<div class="feld-paar">' +
      feldHtml(kontoart(k.art).schuld ? 'Offene Summe' : 'Kontostand', eingabe('kto-saldo', k.saldo, 'number')) +
      feldHtml('Währung', eingabe('kto-waehrung', k.waehrung || 'EUR', 'text')) +
    '</div>' +
    '<p class="hinw">' + (kontoart(k.art).schuld
      ? 'Bei Kredit und Kreditkarte die offene Summe als positive Zahl eintragen – sie wird vom Vermögen abgezogen.'
      : 'Der Stand wird beim Einlesen eines Auszugs nicht überschrieben; von Hand erfasste Buchungen ziehen ihn mit.') + '</p>' +
    feldHtml('Woher kommen die Buchungen?',
      '<select id="kto-dienst">' + optHtml(BANK_DIENSTE, k.dienst) + '</select>',
      (BANK_DIENSTE.find((d) => d.id === k.dienst) || {}).hinweis) +
    (k.dienst === 'bruecke'
      ? feldHtml('Kennung bei der Brücke', eingabe('kto-ref', k.apiRef, 'text', 'z. B. die IBAN'),
          'Die Kennung, die <code>/konten</code> unter <code>ref</code> liefert. Eingerichtet wird die Brücke unter Mehr → Automatischer Abruf.')
      : '') +
    (!neu && k.letzterAbruf ? '<p class="hinw">Letzter Abruf: ' + h(new Date(k.letzterAbruf).toLocaleString('de-DE')) + '</p>' : '') +
    '<div class="btn-reihe" style="margin-top:4px">' +
      (neu ? '' : '<button class="btn gefahr" id="kto-weg">Löschen</button>') +
      (!neu && k.dienst === 'bruecke' ? '<button class="btn zweit" id="kto-sync">Jetzt abrufen</button>' : '') +
      '<button class="btn" id="kto-ok">' + (neu ? 'Anlegen' : 'Speichern') + '</button>' +
    '</div>' +
    (anzahl ? '<p class="hinw">' + anzahl + ' Buchungen hängen an diesem Konto.</p>' : '');

  // Die Felder hängen an der Art bzw. am Dienst – bei Wechsel neu zeichnen
  el('kto-art').onchange = () => { k.art = el('kto-art').value; kontoWerteMerken(k); kontoFensterAuf(neu ? null : id); };
  el('kto-dienst').onchange = () => { k.dienst = el('kto-dienst').value; kontoWerteMerken(k); kontoFensterAuf(neu ? null : id); };

  el('kto-ok').onclick = () => {
    const name = wert('kto-name');
    if (!name){ toast('Bitte eine Bezeichnung angeben'); return; }
    const werte = {
      name, bank: wert('kto-bank'), iban: wert('kto-iban').replace(/\s+/g, '').toUpperCase(),
      art: el('kto-art').value, saldo: wertZahl('kto-saldo'),
      waehrung: (wert('kto-waehrung') || 'EUR').toUpperCase(),
      dienst: el('kto-dienst').value, apiRef: el('kto-ref') ? wert('kto-ref') : (k.apiRef || ''),
      saldoStand: heute()
    };
    if (neu){
      db.konten.push(Object.assign({ id: neueId(), farbe: k.farbe }, werte));
      toast('Konto angelegt');
    } else {
      Object.assign(k, werte);
      toast('Gespeichert');
    }
    sichern(); ovZu('ov-konto'); neuZeichnen();
  };

  if (el('kto-sync')) el('kto-sync').onclick = async () => {
    el('kto-sync').disabled = true;
    el('kto-sync').textContent = 'Rufe ab …';
    try {
      const erg = await kontoAbgleichen(k);
      toast(erg.neu + ' neue Buchungen' + (erg.dubletten ? ', ' + erg.dubletten + ' schon bekannt' : ''));
      ovZu('ov-konto'); neuZeichnen();
    } catch (e){
      infoZeigen('Abruf fehlgeschlagen', '<p class="klein">' + h(e.message) + '</p>' +
        '<p class="klein leise">Prüfe Adresse, Token und ob die Brücke CORS erlaubt.</p>');
    }
  };

  if (!neu) el('kto-weg').onclick = () => {
    frage('Konto löschen?', 'Das Konto und seine ' + anzahl + ' Buchungen werden entfernt. Das lässt sich nicht zurücknehmen.', 'Löschen', () => {
      db.konten = db.konten.filter((x) => x.id !== k.id);
      db.umsaetze = db.umsaetze.filter((u) => u.kontoId !== k.id);
      filter.konten = filter.konten.filter((x) => x !== k.id);
      sichern(); ovZu('ov-konto'); neuZeichnen(); toast('Konto gelöscht');
    }, true);
  };

  ovAuf('ov-konto');
}
/* Beim Neuzeichnen des Fensters die schon getippten Werte nicht verlieren. */
function kontoWerteMerken(k){
  if (el('kto-name')) k.name = wert('kto-name');
  if (el('kto-bank')) k.bank = wert('kto-bank');
  if (el('kto-iban')) k.iban = wert('kto-iban');
  if (el('kto-saldo')) k.saldo = wertZahl('kto-saldo');
  if (el('kto-ref')) k.apiRef = wert('kto-ref');
}

/* ===================================================================
 * DEPOT
 * =================================================================== */
function zeichneDepot(){
  const ziel = el('s-depot');
  const positionen = db.positionen.slice().sort((a, b) => posWert(b) - posWert(a));
  const wertGes = depotWert();
  const einstand = depotEinstand();
  const guv = wertGes - einstand;

  let html = '';
  if (!positionen.length){
    html += '<div class="karte"><div class="leer"><b>Noch keine Positionen</b>' +
      'Trage deine Wertpapiere ein – mit Stückzahl und Einstandskurs. Kurse lassen sich von Hand pflegen ' +
      'oder über eine Marktdaten-API automatisch holen.' +
      '<div class="btn-reihe" style="margin-top:13px;justify-content:center">' +
      '<button class="btn" data-tun="pos-neu">Position hinzufügen</button></div></div></div>' +
      '<div class="kasten"><b>Depot automatisch anbinden</b>' +
      'Broker ohne offene Schnittstelle (die Mehrheit) lassen sich nur von Hand pflegen. Wer eine Brücke ' +
      'betreibt, holt die Bestände über <code>/positionen</code>. Kurse gehen unabhängig davon – siehe ' +
      'Mehr → Marktdaten.</div>';
    ziel.innerHTML = html;
    return;
  }

  html += '<div class="karte">' +
    '<div class="karte-kopf"><h2>Depotwert</h2>' +
    '<span class="mini">' + h(db.zuletztKurse ? 'Kurse: ' + new Date(db.zuletztKurse).toLocaleDateString('de-DE') : 'Kurse von Hand') + '</span></div>' +
    '<div class="verm-summe zahl">' + eur(wertGes) + '</div>' +
    '<div class="kacheln" style="margin:13px 0 0">' +
      kachel('Einstand', eur(einstand, true)) +
      kachel('Gewinn/Verlust', eurVz(guv, true), guv >= 0 ? 'plus' : 'minus') +
      kachel('Rendite', proz(einstand > 0 ? guv / einstand * 100 : 0), guv >= 0 ? 'plus' : 'minus') +
    '</div>' +
    '<div class="btn-reihe" style="margin-top:13px">' +
      '<button class="btn" data-tun="kurse">Kurse aktualisieren</button>' +
      '<button class="btn zweit" data-tun="pos-neu">Position hinzufügen</button>' +
    '</div>' +
    '<div id="kurs-fortschritt"></div></div>';

  /* Aufteilung */
  const teile = positionen.slice(0, 10).map((p, i) => ({ name: p.name, wert: posWert(p), farbe: DEPOT_FARBEN[i % DEPOT_FARBEN.length] }));
  html += '<div class="karte"><div class="karte-kopf"><h2>Aufteilung</h2>' +
    '<span class="mini">' + positionen.length + ' Position' + (positionen.length === 1 ? '' : 'en') + '</span></div>' +
    '<div class="ring-box">' + ringSvg(teile, eur(wertGes, true), 'Depotwert') +
    '<div class="legende">' + teile.map((t) =>
      '<div class="legende-zeile"><i class="punkt" style="background:' + t.farbe + '"></i>' +
      '<span class="nam">' + h(t.name) + '</span>' +
      '<span class="pz">' + Math.round(t.wert / Math.max(1, wertGes) * 100) + '%</span>' +
      '<span class="wrt zahl">' + eur(t.wert, true) + '</span></div>').join('') +
    '</div></div></div>';

  /* Positionen je Depot */
  const depots = db.depots.length ? db.depots : [{ id:'', name:'Depot' }];
  depots.forEach((d) => {
    const eigene = positionen.filter((p) => p.depotId === d.id || (!d.id && !p.depotId));
    if (!eigene.length) return;
    const dWert = eigene.reduce((s, p) => s + posWert(p), 0);
    html += '<div class="karte"><div class="karte-kopf"><h2>' + h(d.name) + '</h2>' +
      '<span class="mini zahl">' + eur(dWert, true) + '</span>' +
      (d.dienst === 'bruecke' ? '<button class="mini" data-tun="depotsync:' + d.id + '" style="color:var(--akzent);font-weight:600">abrufen</button>' : '') +
      (d.id ? '<button class="mini" data-tun="depot:' + d.id + '" title="Depot bearbeiten" aria-label="Depot bearbeiten">✏️</button>' : '') +
      '</div><div class="liste">' +
      eigene.map((p) => {
        const g = posGuv(p), pz = posProz(p);
        const art = (WP_ARTEN.find((a) => a.id === p.art) || WP_ARTEN[5]).name;
        return '<button class="zeile" data-tun="pos:' + p.id + '">' +
          '<span class="sym">' + (p.art === 'krypto' ? '₿' : p.art === 'etf' ? '🧺' : p.art === 'anleihe' ? '📜' : '📈') + '</span>' +
          '<span class="mitte"><span class="tit">' + h(p.name) + '</span>' +
          '<span class="sub">' + h(zahl(p.stueck, p.stueck % 1 ? 4 : 0)) + ' × ' + h(zahl(p.kurs)) +
          (p.waehrung && p.waehrung !== 'EUR' ? ' ' + h(p.waehrung) : ' €') + ' · ' + h(art) + '</span></span>' +
          '<span class="rechts"><span class="betrag zahl">' + eur(posWert(p), true) + '</span>' +
          '<span class="sub ' + (g >= 0 ? 'plus' : 'minus') + '">' + eurVz(g, true) + ' · ' + proz(pz) + '</span></span></button>';
      }).join('') + '</div></div>';
  });

  const ohneSymbol = db.positionen.filter((p) => !String(p.symbol || '').trim()).length;
  if (ohneSymbol){
    html += '<div class="kasten"><b>' + ohneSymbol + ' Position' + (ohneSymbol === 1 ? '' : 'en') + ' ohne Börsenkürzel</b>' +
      'Ohne Kürzel (z. B. <code>EUNL.DE</code>) lässt sich der Kurs nicht automatisch holen – der von Hand ' +
      'eingetragene Wert bleibt stehen.</div>';
  }
  ziel.innerHTML = html;
}

function posFensterAuf(id){
  const neu = !id;
  const p = neu
    ? { id:'', depotId: (db.depots[0] || {}).id || '', name:'', isin:'', wkn:'', symbol:'', art:'etf',
        stueck:0, einstand:0, kurs:0, waehrung:'EUR', kursStand: heute(), notiz:'' }
    : db.positionen.find((x) => x.id === id);
  if (!p) return;

  el('pos-titel').textContent = neu ? 'Position hinzufügen' : p.name || 'Position';
  el('pos-inhalt').innerHTML =
    feldHtml('Wertpapier', eingabe('pos-name', p.name, 'text', 'z. B. iShares Core MSCI World')) +
    '<div class="feld-paar">' +
      feldHtml('ISIN', eingabe('pos-isin', p.isin, 'text', 'IE00B4L5Y983')) +
      feldHtml('WKN', eingabe('pos-wkn', p.wkn, 'text', 'A0RPWH')) +
    '</div>' +
    '<div class="feld-paar">' +
      feldHtml('Art', '<select id="pos-art">' + optHtml(WP_ARTEN, p.art) + '</select>') +
      feldHtml('Börsenkürzel', eingabe('pos-symbol', p.symbol, 'text', 'EUNL.DE')) +
    '</div>' +
    '<p class="hinw">Das Kürzel entscheidet über den automatischen Kursabruf; bei Krypto reicht <code>BTC</code>. ' +
    'Die ISIN dient nur dem Wiedererkennen – kostenlose ISIN-Kursabfragen gibt es nicht.</p>' +
    '<div class="feld-paar">' +
      feldHtml('Stückzahl', eingabe('pos-stueck', p.stueck || '', 'number')) +
      feldHtml('Einstandskurs', eingabe('pos-einstand', p.einstand || '', 'number')) +
    '</div>' +
    '<div class="feld-paar">' +
      feldHtml('Aktueller Kurs', eingabe('pos-kurs', p.kurs || '', 'number')) +
      feldHtml('Währung', eingabe('pos-waehrung', p.waehrung || 'EUR', 'text')) +
    '</div>' +
    feldHtml('Depot', '<select id="pos-depot">' +
      db.depots.map((d) => '<option value="' + h(d.id) + '"' + (d.id === p.depotId ? ' selected' : '') + '>' + h(d.name) + '</option>').join('') +
      '<option value="__neu">＋ Neues Depot …</option></select>') +
    '<div class="feld versteckt" id="pos-depot-neu-feld"><label>Name des Depots</label>' +
      '<input id="pos-depot-neu" type="text" placeholder="z. B. Depot comdirect"></div>' +
    feldHtml('Notiz', '<textarea id="pos-notiz">' + h(p.notiz || '') + '</textarea>') +
    (!neu && p.kursStand ? '<p class="hinw">Kurs vom ' + h(datumLang(p.kursStand)) + '.</p>' : '') +
    '<div class="btn-reihe" style="margin-top:4px">' +
      (neu ? '' : '<button class="btn gefahr" id="pos-weg">Löschen</button>') +
      (neu ? '' : '<button class="btn zweit" id="pos-kurs-jetzt">Kurs holen</button>') +
      '<button class="btn" id="pos-ok">' + (neu ? 'Hinzufügen' : 'Speichern') + '</button>' +
    '</div>';

  const depotWahl = el('pos-depot');
  const neuesFeld = el('pos-depot-neu-feld');
  if (!db.depots.length){ depotWahl.value = '__neu'; neuesFeld.classList.remove('versteckt'); }
  depotWahl.onchange = () => neuesFeld.classList.toggle('versteckt', depotWahl.value !== '__neu');

  el('pos-ok').onclick = () => {
    const name = wert('pos-name');
    if (!name){ toast('Bitte das Wertpapier benennen'); return; }
    let depotId = depotWahl.value;
    if (depotId === '__neu'){
      const dName = wert('pos-depot-neu') || 'Mein Depot';
      const d = { id: neueId(), name: dName, broker:'', dienst:'manuell', apiRef:'' };
      db.depots.push(d);
      depotId = d.id;
    }
    const werte = {
      depotId, name, isin: wert('pos-isin').toUpperCase(), wkn: wert('pos-wkn').toUpperCase(),
      symbol: wert('pos-symbol'), art: el('pos-art').value,
      stueck: wertZahl('pos-stueck'), einstand: wertZahl('pos-einstand'), kurs: wertZahl('pos-kurs'),
      waehrung: (wert('pos-waehrung') || 'EUR').toUpperCase(), notiz: wert('pos-notiz'), kursStand: heute()
    };
    if (neu) db.positionen.push(Object.assign({ id: neueId() }, werte));
    else Object.assign(p, werte);
    sichern(); ovZu('ov-pos'); neuZeichnen();
    toast(neu ? 'Position hinzugefügt' : 'Gespeichert');
  };

  if (el('pos-kurs-jetzt')) el('pos-kurs-jetzt').onclick = async () => {
    const knopf = el('pos-kurs-jetzt');
    knopf.disabled = true; knopf.textContent = 'Hole …';
    try {
      const erg = await kursHolen(Object.assign({}, p, { symbol: wert('pos-symbol'), art: el('pos-art').value }));
      el('pos-kurs').value = String(erg.kurs);
      if (erg.waehrung) el('pos-waehrung').value = erg.waehrung;
      toast('Kurs: ' + zahl(erg.kurs) + ' ' + (erg.waehrung || ''));
    } catch (e){
      toast(e.message);
    }
    knopf.disabled = false; knopf.textContent = 'Kurs holen';
  };

  if (!neu) el('pos-weg').onclick = () => {
    frage('Position löschen?', 'Die Position wird aus dem Depot entfernt.', 'Löschen', () => {
      db.positionen = db.positionen.filter((x) => x.id !== p.id);
      sichern(); ovZu('ov-pos'); neuZeichnen(); toast('Gelöscht');
    }, true);
  };

  ovAuf('ov-pos');
}

/* Depot umbenennen, anbinden oder löschen. Steckt im Info-Fenster, weil es nur
 * vier Felder sind – ein eigenes Overlay wäre Ballast. */
function depotFensterAuf(id){
  const d = db.depots.find((x) => x.id === id);
  if (!d) return;
  const anzahl = db.positionen.filter((p) => p.depotId === d.id).length;
  infoZeigen('Depot bearbeiten',
    feldHtml('Name', eingabe('dp-name', d.name, 'text')) +
    feldHtml('Broker', eingabe('dp-broker', d.broker || '', 'text', 'z. B. comdirect')) +
    feldHtml('Bestände', '<select id="dp-dienst">' +
      optHtml([{ id:'manuell', name:'von Hand pflegen' }, { id:'bruecke', name:'über die eigene Brücke' }], d.dienst || 'manuell') +
      '</select>') +
    feldHtml('Kennung bei der Brücke', eingabe('dp-ref', d.apiRef || '', 'text', 'freiwillig'),
      'Wird an <code>/positionen?depot=…</code> mitgeschickt.') +
    '<div class="btn-reihe">' +
      '<button class="btn gefahr" id="dp-weg">Löschen</button>' +
      '<button class="btn" id="dp-ok">Speichern</button>' +
    '</div>' +
    '<p class="hinw">' + anzahl + ' Position' + (anzahl === 1 ? '' : 'en') + ' in diesem Depot.</p>');

  el('dp-ok').onclick = () => {
    d.name = wert('dp-name') || d.name;
    d.broker = wert('dp-broker');
    d.dienst = el('dp-dienst').value;
    d.apiRef = wert('dp-ref');
    sichern(); ovZu('ov-info'); neuZeichnen(); toast('Gespeichert');
  };
  el('dp-weg').onclick = () => {
    frage('Depot löschen?', 'Das Depot und seine ' + anzahl + ' Positionen werden entfernt.', 'Löschen', () => {
      db.depots = db.depots.filter((x) => x.id !== d.id);
      db.positionen = db.positionen.filter((p) => p.depotId !== d.id);
      sichern(); neuZeichnen(); toast('Depot gelöscht');
    }, true);
  };
}

async function depotSyncJetzt(id){
  const d = db.depots.find((x) => x.id === id);
  if (!d) return;
  toast('Rufe Bestände ab …');
  try {
    const erg = await depotAbgleichen(d);
    neuZeichnen();
    toast(erg.neu + ' neu, ' + erg.erneuert + ' aktualisiert');
  } catch (e){
    infoZeigen('Abruf fehlgeschlagen', '<p class="klein">' + h(e.message) + '</p>' +
      '<p class="klein leise">Die Brücke muss <code>/positionen</code> bereitstellen. Siehe Mehr → Automatischer Abruf.</p>');
  }
}

async function kurseJetzt(){
  const offen = db.positionen.filter((p) => String(p.symbol || '').trim());
  if (!offen.length){
    infoZeigen('Keine Kürzel hinterlegt',
      '<p class="klein leise">Für den automatischen Abruf braucht jede Position ein Börsenkürzel ' +
      '(z. B. <code>EUNL.DE</code>) – bei Krypto reicht <code>BTC</code>.</p>');
    return;
  }
  const kasten = el('kurs-fortschritt');
  const zeigen = (fertig, gesamt, name) => {
    if (!kasten) return;
    kasten.innerHTML = '<div class="klein leise" style="margin-top:11px">' +
      (fertig >= gesamt ? 'Fertig' : 'Hole ' + h(name) + ' … (' + (fertig + 1) + '/' + gesamt + ')') + '</div>' +
      '<div class="fortschritt"><i style="width:' + Math.round(fertig / gesamt * 100) + '%"></i></div>';
  };
  const bericht = await kurseAktualisieren(zeigen);
  neuZeichnen();
  if (bericht.fehler.length){
    infoZeigen('Kurse teils nicht geholt',
      '<p class="klein">' + bericht.erneuert + ' von ' + offen.length + ' Kursen sind aktuell.</p>' +
      '<ul class="klein leise">' + bericht.fehler.map((f) => '<li>' + h(f) + '</li>').join('') + '</ul>' +
      '<p class="klein leise">Häufigste Ursachen: fehlender oder verbrauchter Schlüssel (Mehr → Marktdaten), ' +
      'falsches Kürzel, oder das Minutenlimit der Gratisstufe.</p>');
  } else {
    toast(bericht.erneuert + ' Kurse aktualisiert');
  }
}

/* ===================================================================
 * VERTRÄGE
 * =================================================================== */
/* Vorschläge, die weder abgelehnt noch schon als Vertrag erfasst sind. */
function wiederkehrendeOffen(){
  if (!db.umsaetze.length) return [];
  const abgelehnt = new Set(db.erledigt);
  const bekannt = db.vertraege.map((v) => normal(v.anbieter || v.name).slice(0, 20)).filter(Boolean);
  return wiederkehrendeFinden().filter((v) => {
    if (abgelehnt.has(v.sig)) return false;
    const n = normal(v.anbieter || v.name).slice(0, 20);
    return !bekannt.some((b) => b && (b.includes(n) || n.includes(b)));
  });
}

function zeichneVertraege(){
  const ziel = el('s-vertraege');
  const aktiv = db.vertraege.filter((v) => v.aktiv !== false);
  const ruhend = db.vertraege.filter((v) => v.aktiv === false);
  const fix = fixMonatlich();
  const fristen = fristenOffen();
  const vorschlaege = wiederkehrendeOffen();

  let html = '<div class="kacheln">' +
    kachel('pro Monat', eur(fix, true)) +
    kachel('pro Jahr', eur(fix * 12, true)) +
    kachel('Verträge', String(aktiv.length)) +
    '</div>' +
    '<div class="btn-reihe" style="margin-bottom:13px">' +
      '<button class="btn" data-tun="vertrag-neu">Vertrag erfassen</button>' +
      (db.umsaetze.length ? '<button class="btn zweit" data-tun="nav:umsaetze">Buchungen ansehen</button>' : '') +
    '</div>';

  if (fristen.length){
    html += '<div class="karte"><div class="karte-kopf"><h2>Kündigungsfristen</h2>' +
      '<span class="mini">' + fristen.length + ' offen</span></div><div class="liste">' +
      fristen.map((f) => fristZeile(f)).join('') + '</div></div>';
  }

  if (vorschlaege.length){
    html += '<div class="karte"><div class="karte-kopf"><h2>Wiederkehrende Abbuchungen</h2>' +
      '<span class="mini">' + vorschlaege.length + ' erkannt</span></div>' +
      '<p class="klein leise" style="margin:-4px 0 12px">Diese Zahlungen kommen regelmäßig und in gleicher Höhe. ' +
      'Übernimm sie als Vertrag, dann zählen sie in die Fixkosten.</p><div class="liste">' +
      vorschlaege.map((v) =>
        '<div class="zeile">' +
        '<span class="sym" style="background:' + katFarbe(v.kategorie) + '22">' + kat(v.kategorie).icon + '</span>' +
        '<span class="mitte"><span class="tit">' + h(v.name) + '</span>' +
        '<span class="sub">' + h(turnusName(v.turnus)) + ' · ' + eur(v.betrag) + ' · ' + v.anzahl + '× gesehen</span></span>' +
        '<span class="rechts" style="display:flex;gap:6px">' +
          '<button class="chip" data-tun="vorschlag-weg:' + h(v.sig) + '" title="Ablehnen">✕</button>' +
          '<button class="chip an" data-tun="vorschlag:' + h(v.sig) + '">Übernehmen</button>' +
        '</span></div>').join('') +
      '</div></div>';
  }

  if (aktiv.length){
    const sortiert = aktiv.slice().sort((a, b) => String(a.naechste || '9999').localeCompare(String(b.naechste || '9999')));
    html += '<div class="karte"><div class="karte-kopf"><h2>Laufende Verträge</h2>' +
      '<span class="mini zahl">' + eur(fix, true) + '/Monat</span></div><div class="liste">' +
      sortiert.map((v) => vertragZeile(v)).join('') + '</div></div>';

    const nachKat = new Map();
    aktiv.forEach((v) => {
      const m = (Number(v.betrag) || 0) / turnusMonate(v.turnus);
      nachKat.set(v.kategorie, (nachKat.get(v.kategorie) || 0) + m);
    });
    const teile = Array.from(nachKat.entries())
      .map(([id, w]) => ({ name: katName(id), wert: w, farbe: katFarbe(id) }))
      .sort((a, b) => b.wert - a.wert);
    html += '<div class="karte"><h2>Fixkosten nach Kategorie</h2><div class="ring-box">' +
      ringSvg(teile, eur(fix, true), 'pro Monat') +
      '<div class="legende">' + teile.map((t) =>
        '<div class="legende-zeile"><i class="punkt" style="background:' + t.farbe + '"></i>' +
        '<span class="nam">' + h(t.name) + '</span>' +
        '<span class="pz">' + Math.round(t.wert / Math.max(1, fix) * 100) + '%</span>' +
        '<span class="wrt zahl">' + eur(t.wert, true) + '</span></div>').join('') +
      '</div></div></div>';
  } else if (!vorschlaege.length){
    html += '<div class="karte"><div class="leer"><b>Noch keine Verträge</b>' +
      'Erfasse Miete, Strom, Mobilfunk, Versicherungen und Abos. Die App rechnet daraus die monatlichen ' +
      'und jährlichen Fixkosten und erinnert vor Kündigungsfristen.' +
      '<div class="btn-reihe" style="margin-top:13px;justify-content:center">' +
      '<button class="btn" data-tun="vertrag-neu">Vertrag erfassen</button></div></div></div>';
  }

  if (ruhend.length){
    html += '<div class="karte"><h2>Gekündigt und beendet</h2><div class="liste">' +
      ruhend.map((v) => vertragZeile(v)).join('') + '</div></div>';
  }

  ziel.innerHTML = html;
}

function vertragZeile(v){
  const k = kat(v.kategorie);
  const frist = letzterKuendigungstag(v);
  const teile = [turnusName(v.turnus)];
  if (v.naechste && v.aktiv !== false) teile.push('nächste: ' + datumKurz(v.naechste));
  if (frist) teile.push('kündbar bis ' + datumKurz(frist));
  return '<button class="zeile" data-tun="vertrag:' + v.id + '"' + (v.aktiv === false ? ' style="opacity:.55"' : '') + '>' +
    '<span class="sym" style="background:' + k.farbe + '22">' + k.icon + '</span>' +
    '<span class="mitte"><span class="tit">' + h(v.name) + '</span>' +
    '<span class="sub">' + h(teile.join(' · ')) + '</span></span>' +
    '<span class="rechts"><span class="betrag zahl">' + eur(v.betrag) + '</span>' +
    '<span class="sub">' + h(turnusKurz(v.turnus)) + '</span></span></button>';
}

function vertragFensterAuf(id){
  const neu = !id;
  const v = neu
    ? { id:'', name:'', anbieter:'', betrag:0, turnus:'monatlich', kategorie:'abos',
        naechste: monateAddieren(heute(), 1), ende:'', frist:0, erinnerung:30, kontoId:'', notiz:'', aktiv:true }
    : db.vertraege.find((x) => x.id === id);
  if (!v) return;

  const frist = letzterKuendigungstag(v);
  el('vtr-titel').textContent = neu ? 'Vertrag erfassen' : v.name || 'Vertrag';
  el('vtr-inhalt').innerHTML =
    feldHtml('Name', eingabe('vtr-name', v.name, 'text', 'z. B. Handyvertrag')) +
    feldHtml('Anbieter', eingabe('vtr-anbieter', v.anbieter, 'text', 'z. B. Vodafone GmbH')) +
    '<div class="feld-paar">' +
      feldHtml('Betrag', eingabe('vtr-betrag', v.betrag || '', 'number')) +
      feldHtml('Turnus', '<select id="vtr-turnus">' + optHtml(TURNUS, v.turnus) + '</select>') +
    '</div>' +
    '<div class="feld-paar">' +
      feldHtml('Kategorie', '<select id="vtr-kat">' + optHtml(KATEGORIEN.filter((k) => k.art === 'aus'), v.kategorie) + '</select>') +
      feldHtml('Konto', '<select id="vtr-konto"><option value="">– offen –</option>' + optHtml(db.konten, v.kontoId) + '</select>') +
    '</div>' +
    feldHtml('Nächste Abbuchung', eingabe('vtr-naechste', v.naechste, 'date')) +
    '<div class="feld-paar">' +
      feldHtml('Vertrag läuft bis', eingabe('vtr-ende', v.ende, 'date')) +
      feldHtml('Kündigungsfrist (Tage)', eingabe('vtr-frist', v.frist || '', 'number')) +
    '</div>' +
    (frist
      ? '<p class="hinw">Letzter Kündigungstag: <b>' + h(datumLang(frist)) + '</b> – ' +
        (tageBis(frist) < 0 ? 'schon vorbei.' : 'in ' + tageBis(frist) + ' Tagen.') + '</p>'
      : '<p class="hinw">Mit Enddatum und Frist rechnet die App den letzten Kündigungstag aus und erinnert vorher.</p>') +
    feldHtml('Erinnerung (Tage vorher)', eingabe('vtr-erinnerung', v.erinnerung || 30, 'number')) +
    feldHtml('Notiz', '<textarea id="vtr-notiz">' + h(v.notiz || '') + '</textarea>') +
    schalterHtml('vtr-aktiv', 'Vertrag läuft', 'Aus, sobald gekündigt – dann fällt er aus den Fixkosten heraus.', v.aktiv !== false) +
    '<div class="btn-reihe" style="margin-top:12px">' +
      (neu ? '' : '<button class="btn gefahr" id="vtr-weg">Löschen</button>') +
      '<button class="btn" id="vtr-ok">' + (neu ? 'Erfassen' : 'Speichern') + '</button>' +
    '</div>' +
    (neu ? '' : '<p class="hinw">' + db.umsaetze.filter((u) => u.vertragId === v.id).length + ' Buchungen sind diesem Vertrag zugeordnet.</p>');

  el('vtr-ok').onclick = () => {
    const name = wert('vtr-name');
    if (!name){ toast('Bitte einen Namen angeben'); return; }
    const werte = {
      name, anbieter: wert('vtr-anbieter'), betrag: Math.abs(wertZahl('vtr-betrag')),
      turnus: el('vtr-turnus').value, kategorie: el('vtr-kat').value, kontoId: el('vtr-konto').value,
      naechste: wert('vtr-naechste'), ende: wert('vtr-ende'),
      frist: Math.round(wertZahl('vtr-frist')), erinnerung: Math.round(wertZahl('vtr-erinnerung')) || 30,
      notiz: wert('vtr-notiz'), aktiv: angehakt('vtr-aktiv')
    };
    if (neu) db.vertraege.push(Object.assign({ id: neueId() }, werte));
    else Object.assign(v, werte);
    sichern(); ovZu('ov-vertrag'); neuZeichnen();
    toast(neu ? 'Vertrag erfasst' : 'Gespeichert');
  };

  if (!neu) el('vtr-weg').onclick = () => {
    frage('Vertrag löschen?', 'Der Vertrag wird entfernt. Die zugeordneten Buchungen bleiben erhalten.', 'Löschen', () => {
      db.umsaetze.forEach((u) => { if (u.vertragId === v.id) u.vertragId = ''; });
      db.vertraege = db.vertraege.filter((x) => x.id !== v.id);
      sichern(); ovZu('ov-vertrag'); neuZeichnen(); toast('Gelöscht');
    }, true);
  };

  ovAuf('ov-vertrag');
}

function vorschlagUebernehmen(sig){
  const v = wiederkehrendeFinden().find((x) => x.sig === sig);
  if (!v) return;
  const vertrag = {
    id: neueId(), name: v.name, anbieter: v.anbieter, betrag: v.betrag, turnus: v.turnus,
    kategorie: v.kategorie, kontoId: v.kontoId, naechste: v.naechste, ende:'', frist:0,
    erinnerung:30, notiz:'Aus wiederkehrenden Abbuchungen übernommen.', aktiv:true
  };
  db.vertraege.push(vertrag);
  // Die erkannten Buchungen gleich zuordnen, damit die Herkunft sichtbar bleibt
  db.umsaetze.forEach((u) => { if (v.umsatzIds.includes(u.id)) u.vertragId = vertrag.id; });
  sichern(); neuZeichnen();
  toast('Als Vertrag übernommen');
}
function vorschlagAblehnen(sig){
  db.erledigt.push(sig);
  sichern(); neuZeichnen();
}

/* Fällige Fristen als Systemmeldung – höchstens einmal am Tag. */
function fristenMelden(){
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (db.einst.letzteMeldung === heute()) return;
  const dringend = fristenOffen().filter((f) => f.tage >= 0 && f.tage <= 7);
  if (!dringend.length) return;
  db.einst.letzteMeldung = heute();
  sichern();
  const f = dringend[0];
  new Notification('Kündigungsfrist läuft ab', {
    body: f.v.name + ': noch ' + f.tage + ' Tag' + (f.tage === 1 ? '' : 'e') +
          (dringend.length > 1 ? ' (und ' + (dringend.length - 1) + ' weitere)' : ''),
    icon: 'icon-192.png'
  });
}

/* ===================================================================
 * MEHR
 * =================================================================== */
function zeichneMehr(){
  mitFokus(() => {
    const ziel = el('s-mehr');
    const bruecke = db.einst.bruecke || { basis:'', token:'' };
    const dienst = KURS_DIENST_MAP[db.einst.kursDienst] || KURS_DIENSTE[0];

    let html = '';

    /* Konten */
    html += '<div class="karte"><div class="karte-kopf"><h2>Konten</h2>' +
      '<span class="mini zahl">' + eur(vermoegen().liquide, true) + '</span></div>';
    if (db.konten.length){
      html += '<div class="liste">' + db.konten.map((k) => {
        const anzahl = db.umsaetze.filter((u) => u.kontoId === k.id).length;
        const schuld = kontoart(k.art).schuld;
        return '<button class="zeile" data-tun="konto:' + k.id + '">' +
          '<span class="sym">' + kontoart(k.art).icon + '</span>' +
          '<span class="mitte"><span class="tit">' + h(k.name) + '</span>' +
          '<span class="sub">' + h([k.bank, kontoart(k.art).name, anzahl + ' Buchungen'].filter(Boolean).join(' · ')) + '</span></span>' +
          '<span class="rechts"><span class="betrag zahl ' + (schuld ? 'minus' : '') + '">' +
          (schuld ? '−' : '') + eur(Math.abs(k.saldo), true) + '</span>' +
          '<span class="sub">' + h(k.dienst === 'bruecke' ? 'Abruf' : k.dienst === 'auszug' ? 'Auszug' : 'manuell') + '</span></span></button>';
      }).join('') + '</div>';
    } else {
      html += '<div class="leer">Noch kein Konto angelegt.</div>';
    }
    html += '<div class="btn-reihe" style="margin-top:13px">' +
      '<button class="btn" data-tun="konto-neu">Konto anlegen</button>' +
      '<button class="btn zweit" data-tun="import">Auszug einlesen</button>' +
      (db.konten.some((k) => k.dienst === 'bruecke') ? '<button class="btn zweit" data-tun="abgleich">Alle abrufen</button>' : '') +
      '</div></div>';

    /* Automatischer Abruf */
    html += '<div class="karte"><div class="karte-kopf"><h2>Automatischer Abruf</h2>' +
      '<button class="mini" data-tun="info:bruecke" style="color:var(--akzent);font-weight:600">Wie geht das? ›</button></div>' +
      '<p class="klein leise" style="margin:-4px 0 12px">Eine Seite im Browser darf nicht direkt mit deiner Bank ' +
      'sprechen. Für den regelmäßigen Abruf trägst du hier einen eigenen Dienst ein, der das für dich tut – ' +
      'etwa die <a href="https://github.com/rianvegeta1991/finanzhelfer-bruecke" target="_blank" ' +
      'rel="noopener">Finanzhelfer-Brücke</a>.</p>' +
      feldHtml('Adresse der Brücke', eingabe('br-basis', bruecke.basis, 'url', 'https://…')) +
      feldHtml('Token', eingabe('br-token', bruecke.token, 'password', 'Bearer-Token')) +
      '<div class="btn-reihe"><button class="btn zweit" id="br-test">Verbindung prüfen</button>' +
      '<button class="btn" id="br-ok">Speichern</button></div>' +
      '<div id="br-ergebnis"></div></div>';

    /* Marktdaten */
    html += '<div class="karte"><div class="karte-kopf"><h2>Marktdaten</h2>' +
      '<span class="mini">' + h(dienst.name) + '</span></div>' +
      feldHtml('Dienst', '<select id="kd-dienst">' + optHtml(KURS_DIENSTE, db.einst.kursDienst) + '</select>', h(dienst.hinweis) +
        ' · <a href="' + dienst.schluesselUrl + '" target="_blank" rel="noopener">Schlüssel holen</a>') +
      feldHtml('Schlüssel', eingabe('kd-key', db.einst.kursKey, 'password', 'API-Key')) +
      schalterHtml('kd-auto', 'Kurse selbst nachladen', 'Einmal am Tag beim Öffnen, sofern Netz vorhanden.', db.einst.autoKurse) +
      '<div class="btn-reihe" style="margin-top:12px"><button class="btn" id="kd-ok">Speichern</button>' +
      (db.positionen.length ? '<button class="btn zweit" data-tun="kurse">Jetzt aktualisieren</button>' : '') + '</div>' +
      '<p class="hinw">Krypto und Wechselkurse gehen ohne Schlüssel (CoinGecko, frankfurter.app). ' +
      'Der Schlüssel bleibt auf dem Gerät und geht nur an den gewählten Dienst.</p></div>';

    /* Sicherheit */
    html += '<div class="karte"><div class="karte-kopf"><h2>Sicherheit</h2>' +
      '<span class="mini">' + (istVerschluesselt() ? '🔒 verschlüsselt' : 'offen') + '</span></div>';
    if (istVerschluesselt()){
      html += '<p class="klein leise" style="margin:-4px 0 12px">Die Daten liegen mit AES-256-GCM verschlüsselt ' +
        'im Speicher dieses Browsers. Der Schlüssel entsteht aus deiner Passphrase und wird nirgends abgelegt.</p>' +
        feldHtml('Selbstsperre nach (Minuten, 0 = nie)', eingabe('sc-min', db.einst.sperreMin, 'number')) +
        '<div class="btn-reihe"><button class="btn zweit" data-tun="sperre-ein">Passphrase ändern</button>' +
        '<button class="btn zweit" data-tun="sperre-aus">Sperre aufheben</button>' +
        '<button class="btn" id="sc-ok">Speichern</button></div>';
    } else {
      html += '<p class="klein leise" style="margin:-4px 0 12px">Ohne Sperre stehen die Daten unverschlüsselt im ' +
        'Speicher dieses Browsers. Wer Zugriff auf das entsperrte Gerät hat, kann sie lesen.</p>' +
        '<div class="btn-reihe"><button class="btn" data-tun="sperre-ein">Mit Passphrase verschlüsseln</button></div>';
    }
    if ('Notification' in window){
      html += schalterHtml('sc-melden', 'An Kündigungsfristen erinnern',
        Notification.permission === 'granted' ? 'Erlaubt – meldet sich beim Öffnen, wenn eine Frist in sieben Tagen ausläuft.'
        : Notification.permission === 'denied' ? 'Im Browser abgelehnt. Das lässt sich nur in den Website-Einstellungen zurücknehmen.'
        : 'Fragt beim Einschalten nach Erlaubnis.', Notification.permission === 'granted');
    }
    html += '</div>';

    /* Daten */
    html += '<div class="karte"><h2>Daten</h2>' +
      '<div class="liste">' +
      '<button class="zeile" data-tun="csv:umsaetze"><span class="sym">📄</span><span class="mitte">' +
        '<span class="tit">Umsätze als CSV</span><span class="sub">' + db.umsaetze.length + ' Buchungen, öffnet in Excel</span></span></button>' +
      '<button class="zeile" data-tun="csv:depot"><span class="sym">📄</span><span class="mitte">' +
        '<span class="tit">Depot als CSV</span><span class="sub">' + db.positionen.length + ' Positionen mit Gewinn/Verlust</span></span></button>' +
      '<button class="zeile" data-tun="csv:vertraege"><span class="sym">📄</span><span class="mitte">' +
        '<span class="tit">Verträge als CSV</span><span class="sub">' + db.vertraege.length +
        (db.vertraege.length === 1 ? ' Vertrag' : ' Verträge') + ' mit Fristen</span></span></button>' +
      '<button class="zeile" data-tun="drucken"><span class="sym">🖨️</span><span class="mitte">' +
        '<span class="tit">Bericht als PDF</span><span class="sub">' + h(zeitLabel()) + ' – über „Als PDF speichern“ im Druckdialog</span></span></button>' +
      '<button class="zeile" data-tun="csv:alles"><span class="sym">💾</span><span class="mitte">' +
        '<span class="tit">Sicherung als JSON</span><span class="sub">Alles zusammen, zum Wiedereinlesen</span></span></button>' +
      '<button class="zeile" data-tun="zurueckspielen"><span class="sym">📥</span><span class="mitte">' +
        '<span class="tit">Sicherung einlesen</span><span class="sub">Ersetzt den aktuellen Bestand</span></span></button>' +
      '<button class="zeile" data-tun="beispiel"><span class="sym">🧪</span><span class="mitte">' +
        '<span class="tit">Beispieldaten laden</span><span class="sub">Erfundener Haushalt über sieben Monate</span></span></button>' +
      '<button class="zeile" data-tun="alles-weg"><span class="sym">🗑️</span><span class="mitte">' +
        '<span class="tit minus">Alles löschen</span><span class="sub">Setzt die App auf den Anfang zurück</span></span></button>' +
      '</div></div>';

    /* Info */
    html += '<div class="karte"><h2>Über den Finanzhelfer</h2>' +
      '<p class="klein leise" style="margin:0 0 10px">Alles läuft im Browser. Es gibt kein Konto, keinen Server ' +
      'und keine Übertragung deiner Finanzdaten – außer den Kursabfragen, die nur Börsenkürzel enthalten.</p>' +
      '<div class="liste">' +
      '<button class="zeile" data-tun="info:bruecke"><span class="sym">🔌</span><span class="mitte">' +
        '<span class="tit">Bankkonten anbinden</span><span class="sub">FinTS, Aggregatoren und die eigene Brücke</span></span></button>' +
      '<button class="zeile" data-tun="info:formate"><span class="sym">📂</span><span class="mitte">' +
        '<span class="tit">Welche Auszüge gehen?</span><span class="sub">CSV, CAMT.053, MT940</span></span></button>' +
      '<button class="zeile" data-tun="info:sicher"><span class="sym">🔒</span><span class="mitte">' +
        '<span class="tit">Wie sicher ist das?</span><span class="sub">Verschlüsselung und was sie nicht leistet</span></span></button>' +
      '</div>' +
      '<p class="mini leise" style="margin:12px 0 0;text-align:center">Version ' + APP_VERSION + '</p></div>';

    ziel.innerHTML = html;

    /* Verdrahtung */
    el('br-ok').onclick = () => {
      db.einst.bruecke = { basis: wert('br-basis'), token: wert('br-token') };
      sichern(); toast('Gespeichert');
    };
    el('br-test').onclick = async () => {
      const cfg = { basis: wert('br-basis'), token: wert('br-token') };
      const kasten = el('br-ergebnis');
      kasten.innerHTML = '<p class="klein leise" style="margin:10px 0 0">Frage an …</p>';
      try {
        const konten = await brueckeKonten(cfg);
        db.einst.bruecke = cfg; sichern();
        kasten.innerHTML = '<div class="kasten" style="margin:11px 0 0"><b>' + konten.length + ' Konten gefunden</b>' +
          konten.map((k) => h(k.name) + ' – <code>' + h(k.ref) + '</code> · ' + eur(k.saldo)).join('<br>') +
          '<div class="klein leise" style="margin-top:7px">Trage die Kennung beim jeweiligen Konto ein und stelle ' +
          'dort „Eigene Brücke“ ein.</div></div>';
      } catch (e){
        kasten.innerHTML = '<div class="kasten warnung" style="margin:11px 0 0"><b>Keine Verbindung</b>' + h(e.message) + '</div>';
      }
    };
    el('kd-ok').onclick = () => {
      db.einst.kursDienst = el('kd-dienst').value;
      db.einst.kursKey = wert('kd-key');
      db.einst.autoKurse = angehakt('kd-auto');
      sichern(); toast('Gespeichert'); zeichneMehr();
    };
    el('kd-dienst').onchange = () => { db.einst.kursDienst = el('kd-dienst').value; sichern(); zeichneMehr(); };
    if (el('sc-ok')) el('sc-ok').onclick = () => {
      db.einst.sperreMin = Math.max(0, Math.round(wertZahl('sc-min')));
      sichern(); toast('Gespeichert');
    };
    if (el('sc-melden')) el('sc-melden').onchange = async (e) => {
      if (!e.target.checked) return;
      const erlaubt = await Notification.requestPermission();
      if (erlaubt !== 'granted'){ e.target.checked = false; toast('Der Browser hat es abgelehnt'); }
      else { toast('Erinnerungen sind an'); zeichneMehr(); }
    };
  });
}

async function abgleichJetzt(){
  toast('Rufe Konten ab …');
  const b = await alleAbgleichen();
  neuZeichnen();
  if (b.fehler.length){
    infoZeigen('Abruf teils fehlgeschlagen',
      '<p class="klein">' + b.konten + ' Konten abgerufen, ' + b.neu + ' neue Buchungen.</p>' +
      '<ul class="klein leise">' + b.fehler.map((f) => '<li>' + h(f) + '</li>').join('') + '</ul>');
  } else {
    toast(b.neu + ' neue Buchungen aus ' + b.konten + ' Konten');
  }
}

/* ===================================================================
 * IMPORT
 * =================================================================== */
let impStand = null;   // { lese, kontoId, art, umsaetze }

function importFensterAuf(){
  impStand = null;
  el('imp-inhalt').innerHTML =
    (db.konten.length
      ? feldHtml('Auf welches Konto?', '<select id="imp-konto">' + optHtml(db.konten, (db.konten[0] || {}).id) + '</select>')
      : '<div class="kasten warnung"><b>Noch kein Konto</b>Lege zuerst ein Konto an – der Auszug muss einem ' +
        'Konto zugeordnet werden.<div class="btn-reihe" style="margin-top:10px">' +
        '<button class="btn" data-tun="konto-neu">Konto anlegen</button></div></div>') +
    (db.konten.length
      ? feldHtml('Datei', '<input type="file" id="imp-datei" accept=".csv,.txt,.xml,.sta,.940,.mt940,text/csv,text/xml">',
          'CSV, CAMT.053 (XML) oder MT940 aus dem Online-Banking. Die Datei verlässt dein Gerät nicht.')
      : '') +
    '<div id="imp-ergebnis"></div>';

  if (!db.konten.length){ ovAuf('ov-import'); return; }

  el('imp-datei').onchange = async (e) => {
    const datei = e.target.files && e.target.files[0];
    if (!datei) return;
    const kontoId = el('imp-konto').value;
    const text = await dateiLesen(datei);
    try {
      importAnalysieren(text, datei.name, kontoId);
    } catch (fehler){
      el('imp-ergebnis').innerHTML = '<div class="kasten warnung" style="margin-top:13px"><b>Datei nicht lesbar</b>' + h(fehler.message) + '</div>';
    }
  };
  ovAuf('ov-import');
}

/* Auszüge kommen oft in Windows-1252 (Sparkasse, Volksbank). Erst UTF-8
 * versuchen; tauchen Ersatzzeichen auf, nochmal als 1252 lesen. */
function dateiLesen(datei){
  return datei.arrayBuffer().then((puffer) => {
    const utf8 = new TextDecoder('utf-8').decode(puffer);
    if (!utf8.includes('�')) return utf8;
    try { return new TextDecoder('windows-1252').decode(puffer); }
    catch (e){ return utf8; }
  });
}

function importAnalysieren(text, name, kontoId){
  const istXml = /^\s*<\?xml|<Document/i.test(text);
  const istMt = /(^|\n)\s*:(20|25|60F|61):/.test(text);

  if (istXml){
    const umsaetze = impCamt(text, kontoId);
    impStand = { art:'camt', kontoId, umsaetze };
    importVorschauZeigen('CAMT.053 (XML)', umsaetze);
    return;
  }
  if (istMt){
    const umsaetze = impMt940(text, kontoId);
    impStand = { art:'mt940', kontoId, umsaetze };
    importVorschauZeigen('MT940', umsaetze);
    return;
  }

  const lese = impCsvLesen(text);
  if (!lese || !lese.zeilen.length) throw new Error('In der Datei stehen keine erkennbaren Zeilen.');
  impStand = { art:'csv', kontoId, lese, zuordnung: Object.assign({}, lese.zuordnung) };
  importCsvZeigen();
}

/* Spaltenzuordnung zum Nachstellen + Vorschau. */
function importCsvZeigen(){
  const { lese, zuordnung } = impStand;
  const spalten = [{ id:'-1', name:'– keine –' }].concat(lese.kopf.map((s, i) => ({ id:String(i), name:(s || 'Spalte ' + (i+1)) })));
  const auswahl = (feld, label) =>
    feldHtml(label, '<select data-impsp="' + feld + '">' +
      optHtml(spalten, String(zuordnung[feld] === undefined ? -1 : zuordnung[feld])) + '</select>');

  impStand.umsaetze = impCsvUmsaetze(lese, zuordnung, impStand.kontoId);

  el('imp-ergebnis').innerHTML =
    '<div class="kasten" style="margin-top:13px"><b>CSV erkannt</b>' +
      lese.zeilen.length + ' Zeilen, Trennzeichen „' + (lese.trenner === '\t' ? 'Tabulator' : lese.trenner) + '“. ' +
      'Stimmt die Zuordnung nicht, stell sie hier um.</div>' +
    '<div class="feld-paar">' + auswahl('datum', 'Datum') + auswahl('betrag', 'Betrag') + '</div>' +
    '<div class="feld-paar">' + auswahl('gegen', 'Empfänger') + auswahl('zweck', 'Zweck') + '</div>' +
    importVorschauHtml(impStand.umsaetze);

  el('imp-ergebnis').querySelectorAll('[data-impsp]').forEach((s) => {
    s.onchange = () => {
      impStand.zuordnung[s.dataset.impsp] = Number(s.value);
      importCsvZeigen();
    };
  });
  importKnopfVerdrahten();
}

function importVorschauZeigen(art, umsaetze){
  el('imp-ergebnis').innerHTML =
    '<div class="kasten" style="margin-top:13px"><b>' + h(art) + ' erkannt</b>' +
      umsaetze.length + ' Buchungen gefunden.</div>' +
    importVorschauHtml(umsaetze);
  importKnopfVerdrahten();
}

function importVorschauHtml(umsaetze){
  if (!umsaetze.length){
    return '<div class="kasten warnung"><b>Keine Buchungen erkannt</b>' +
      'Prüfe die Spaltenzuordnung – ohne gültiges Datum und Betrag wird eine Zeile übersprungen.</div>';
  }
  const bekannt = new Set(db.umsaetze.map((u) => u.sig || umsatzSignatur(u)));
  const neue = umsaetze.filter((u) => !bekannt.has(u.sig));
  const summe = neue.reduce((s, u) => s + u.betrag, 0);
  return '<h2 style="font-size:14px;margin:16px 0 8px">Vorschau</h2>' +
    '<div class="karte" style="padding:11px 13px;margin-bottom:11px"><div class="liste">' +
    umsaetze.slice(0, 6).map((u) => umsatzZeile(u)).join('') +
    (umsaetze.length > 6 ? '<div class="mini leise" style="padding-top:8px">… und ' + (umsaetze.length - 6) + ' weitere</div>' : '') +
    '</div></div>' +
    '<div class="kacheln">' +
      kachel('Neu', String(neue.length)) +
      kachel('Bekannt', String(umsaetze.length - neue.length)) +
      kachel('Summe', eurVz(summe, true), summe >= 0 ? 'plus' : 'minus') +
    '</div>' +
    '<button class="btn voll" id="imp-ok"' + (neue.length ? '' : ' disabled') + '>' +
    (neue.length ? neue.length + ' Buchungen übernehmen' : 'Alles schon vorhanden') + '</button>' +
    '<p class="hinw">Doppelte werden über Datum, Betrag und Empfänger erkannt und übersprungen. ' +
    'Der Kontostand bleibt unberührt – er kommt aus dem Auszug bzw. aus deiner Eingabe.</p>';
}

function importKnopfVerdrahten(){
  const knopf = el('imp-ok');
  if (!knopf) return;
  knopf.onclick = () => {
    const erg = umsaetzeUebernehmen(impStand.umsaetze);
    sichern();
    ovZu('ov-import');
    zeigeAnsicht('umsaetze');
    toast(erg.neu + ' Buchungen übernommen' + (erg.dubletten ? ', ' + erg.dubletten + ' übersprungen' : ''));
  };
}

/* ===================================================================
 * EXPORT
 * =================================================================== */
function csvExport(was){
  const stempel = heute();
  if (was === 'umsaetze'){
    const zeilen = db.umsaetze.slice().sort((a, b) => (a.datum < b.datum ? -1 : 1)).map((u) => [
      u.datum, kontoName(u.kontoId), u.gegen, u.zweck, csvZahl(u.betrag), u.waehrung || 'EUR',
      katName(u.kategorie), (db.vertraege.find((v) => v.id === u.vertragId) || {}).name || '', u.notiz || ''
    ]);
    dateiSpeichern('finanzhelfer-umsaetze-' + stempel + '.csv',
      csvBauen(['Datum','Konto','Empfaenger','Verwendungszweck','Betrag','Waehrung','Kategorie','Vertrag','Notiz'], zeilen));
    toast(zeilen.length + ' Buchungen exportiert');
    return;
  }
  if (was === 'depot'){
    const zeilen = db.positionen.map((p) => [
      (db.depots.find((d) => d.id === p.depotId) || {}).name || '', p.name, p.isin, p.wkn, p.symbol,
      (WP_ARTEN.find((a) => a.id === p.art) || {}).name || '', csvZahl(p.stueck, 4), csvZahl(p.einstand, 4),
      csvZahl(p.kurs, 4), p.waehrung || 'EUR', csvZahl(posEinstand(p)), csvZahl(posWert(p)),
      csvZahl(posGuv(p)), csvZahl(posProz(p), 1), p.kursStand || ''
    ]);
    dateiSpeichern('finanzhelfer-depot-' + stempel + '.csv',
      csvBauen(['Depot','Wertpapier','ISIN','WKN','Symbol','Art','Stueck','Einstandskurs','Kurs','Waehrung',
                'Einstandswert EUR','Wert EUR','Gewinn/Verlust EUR','Rendite %','Kurs vom'], zeilen));
    toast(zeilen.length + ' Positionen exportiert');
    return;
  }
  if (was === 'vertraege'){
    const zeilen = db.vertraege.map((v) => [
      v.name, v.anbieter, csvZahl(v.betrag), turnusName(v.turnus),
      csvZahl((Number(v.betrag) || 0) / turnusMonate(v.turnus)),
      csvZahl((Number(v.betrag) || 0) * 12 / turnusMonate(v.turnus)),
      katName(v.kategorie), kontoName(v.kontoId), v.naechste || '', v.ende || '',
      v.frist || 0, letzterKuendigungstag(v), v.aktiv === false ? 'beendet' : 'laeuft', v.notiz || ''
    ]);
    dateiSpeichern('finanzhelfer-vertraege-' + stempel + '.csv',
      csvBauen(['Name','Anbieter','Betrag','Turnus','pro Monat','pro Jahr','Kategorie','Konto',
                'naechste Abbuchung','Vertragsende','Frist Tage','letzter Kuendigungstag','Status','Notiz'], zeilen));
    toast(zeilen.length + ' Verträge exportiert');
    return;
  }
  if (was === 'alles'){
    dateiSpeichern('finanzhelfer-sicherung-' + stempel + '.json', JSON.stringify(db, null, 1), 'application/json');
    toast('Sicherung gespeichert');
  }
}

/* Sicherung zurückspielen. Der Dateiwähler wird im Code erzeugt, damit im
 * Markup kein dauerhaft unsichtbares <input type="file"> herumliegt. */
function sicherungEinlesen(){
  const ein = document.createElement('input');
  ein.type = 'file';
  ein.accept = '.json,application/json';
  ein.onchange = async () => {
    const datei = ein.files && ein.files[0];
    if (!datei) return;
    let roh;
    try {
      roh = JSON.parse(await datei.text());
    } catch (e){
      infoZeigen('Nicht lesbar', '<p class="klein">Die Datei ist kein gültiges JSON.</p>');
      return;
    }
    if (!roh || !Array.isArray(roh.konten) || !Array.isArray(roh.umsaetze)){
      infoZeigen('Falsche Datei',
        '<p class="klein">Das sieht nicht nach einer Finanzhelfer-Sicherung aus – es fehlen die ' +
        'Listen <code>konten</code> und <code>umsaetze</code>.</p>');
      return;
    }
    frage('Sicherung einlesen?',
      'Der Bestand wird vollständig ersetzt: ' + roh.konten.length + ' Konten, ' +
      roh.umsaetze.length + ' Buchungen, ' + (roh.positionen || []).length + ' Positionen und ' +
      (roh.vertraege || []).length + ' Verträge. Was jetzt in der App steht, ist danach weg.',
      'Ersetzen', () => {
        db = pruefeDb(roh);
        filter = { konten:[], kategorie:'', suche:'', nurUnsortiert:false };
        sichern();
        zeigeAnsicht('ueberblick');
        toast('Sicherung eingelesen');
      }, true);
  };
  ein.click();
}

/* Druckansicht füllen und den Druckdialog öffnen – dort „Als PDF speichern“. */
function berichtDrucken(){
  const g = zeitGrenzen();
  const liste = umsaetzeVon();
  const s = summen(liste);
  const v = vermoegen();
  const ausgaben = katSummen(liste, 'aus');
  const einnahmen = katSummen(liste, 'ein');
  const aktiv = db.vertraege.filter((x) => x.aktiv !== false);

  const tabelle = (kopf, zeilen) =>
    '<table><thead><tr>' + kopf.map((k, i) => '<th' + (i ? ' class="z"' : '') + '>' + h(k) + '</th>').join('') + '</tr></thead><tbody>' +
    zeilen.map((z) => '<tr>' + z.map((f, i) => '<td' + (i ? ' class="z"' : '') + '>' + h(f) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>';

  el('bericht').innerHTML =
    '<h1>Finanzbericht</h1>' +
    '<p>' + h(zeitLabel()) + ' (' + h(datumLang(g.von)) + ' bis ' + h(datumLang(g.bis)) + ')' +
    (filter.konten.length ? ' · Konten: ' + h(kontenAktiv().map((k) => k.name).join(', ')) : ' · alle Konten') +
    '<br>Erstellt am ' + h(datumLang(heute())) + ' mit Finanzhelfer ' + APP_VERSION + '</p>' +

    '<h2>Vermögen</h2>' +
    tabelle(['Posten','Betrag'], [
      ['Konten und Bargeld', eur(v.liquide)],
      ['Depots', eur(v.depots)],
      ['Verbindlichkeiten', '−' + eur(v.schulden)],
      ['Gesamtvermögen', eur(v.gesamt)]
    ]) +

    '<h2>Einnahmen und Ausgaben</h2>' +
    tabelle(['Posten','Betrag'], [
      ['Einnahmen', eur(s.ein)],
      ['Ausgaben', eur(s.aus)],
      ['Sparen und Anlage', eur(s.spar)],
      ['Saldo', eurVz(s.saldo)],
      ['Buchungen', String(s.anzahl)]
    ]) +

    (einnahmen.length ? '<h2>Einnahmen nach Kategorie</h2>' +
      tabelle(['Kategorie','Betrag','Anteil'], einnahmen.map((k) =>
        [k.name, eur(k.wert), Math.round(k.wert / Math.max(1, s.ein) * 100) + ' %'])) : '') +

    (ausgaben.length ? '<h2>Ausgaben nach Kategorie</h2>' +
      tabelle(['Kategorie','Betrag','Anteil'], ausgaben.map((k) =>
        [k.name, eur(k.wert), Math.round(k.wert / Math.max(1, s.aus) * 100) + ' %'])) : '') +

    (aktiv.length ? '<h2>Laufende Verträge</h2>' +
      tabelle(['Vertrag','Betrag','Turnus','pro Monat','kündbar bis'], aktiv.map((x) =>
        [x.name + (x.anbieter ? ' (' + x.anbieter + ')' : ''), eur(x.betrag), turnusName(x.turnus),
         eur(x.betrag / turnusMonate(x.turnus)), letzterKuendigungstag(x) ? datumLang(letzterKuendigungstag(x)) : '–'])) +
      '<p><b>Fixkosten: ' + eur(fixMonatlich()) + ' pro Monat, ' + eur(fixMonatlich() * 12) + ' pro Jahr.</b></p>' : '') +

    (db.positionen.length ? '<h2>Depot</h2>' +
      tabelle(['Wertpapier','Stück','Kurs','Wert','G/V'], db.positionen.map((p) =>
        [p.name, zahl(p.stueck, p.stueck % 1 ? 4 : 0), zahl(p.kurs) + ' ' + (p.waehrung || 'EUR'),
         eur(posWert(p)), eurVz(posGuv(p)) + ' (' + proz(posProz(p)) + ')'])) +
      '<p><b>Depotwert: ' + eur(depotWert()) + ', Gewinn/Verlust ' + eurVz(depotWert() - depotEinstand()) + '.</b></p>' : '') +

    '<h2>Buchungen im Zeitraum</h2>' +
    tabelle(['Datum','Empfänger / Zweck','Kategorie','Betrag'],
      liste.slice().sort((a, b) => (a.datum < b.datum ? -1 : 1)).map((u) =>
        [datumKurz(u.datum) + ausIso(u.datum).getFullYear(), (u.gegen || u.zweck).slice(0, 52), katName(u.kategorie), eurVz(u.betrag)]));

  toast('Im Dialog „Als PDF speichern“ wählen');
  setTimeout(() => window.print(), 350);
}

/* ===================================================================
 * SICHERHEIT
 * =================================================================== */
function sperreFensterAuf(){
  const schonAn = istVerschluesselt();
  infoZeigen(schonAn ? 'Passphrase ändern' : 'Daten verschlüsseln',
    '<p class="klein leise" style="margin-top:0">' +
    (schonAn
      ? 'Die Daten werden mit der neuen Passphrase neu verschlüsselt.'
      : 'Deine Daten werden mit AES-256-GCM verschlüsselt im Speicher dieses Browsers abgelegt. ' +
        'Der Schlüssel entsteht aus der Passphrase (PBKDF2, 310 000 Runden) und wird nirgends gespeichert.') +
    '</p>' +
    '<div class="kasten warnung"><b>Ohne Passphrase sind die Daten verloren</b>' +
    'Es gibt keinen Zweitschlüssel und keine Wiederherstellung. Schreib sie dir auf und leg vorher ' +
    'über <i>Daten → Sicherung als JSON</i> eine Kopie an.</div>' +
    '<div class="feld"><label>Passphrase</label><input type="password" id="np-1" autocomplete="new-password"></div>' +
    '<div class="feld"><label>Wiederholen</label><input type="password" id="np-2" autocomplete="new-password"></div>' +
    '<div class="btn-reihe"><button class="btn zweit" data-tun="ov-zu">Abbrechen</button>' +
    '<button class="btn" id="np-ok">' + (schonAn ? 'Ändern' : 'Verschlüsseln') + '</button></div>');

  el('np-ok').onclick = async () => {
    const p1 = el('np-1').value, p2 = el('np-2').value;
    if (p1.length < 6){ toast('Mindestens 6 Zeichen'); return; }
    if (p1 !== p2){ toast('Die Eingaben unterscheiden sich'); return; }
    el('np-ok').disabled = true;
    el('np-ok').textContent = 'Verschlüssele …';
    await sperreEinrichten(p1);
    ovZu('ov-info');
    toast('Daten sind verschlüsselt');
    neuZeichnen();
  };
}

function sperreAufhebenFragen(){
  frage('Sperre aufheben?',
    'Die Daten liegen danach unverschlüsselt im Speicher dieses Browsers. Jeder mit Zugriff auf das ' +
    'entsperrte Gerät kann sie lesen.', 'Aufheben', async () => {
      await sperreAufheben();
      toast('Sperre aufgehoben');
      neuZeichnen();
    }, true);
}

function allesLoeschenFragen(){
  frage('Wirklich alles löschen?',
    'Konten, Buchungen, Depot und Verträge werden entfernt – auch eine eingerichtete Verschlüsselung. ' +
    'Das lässt sich nicht zurücknehmen.', 'Alles löschen', () => {
      localStorage.removeItem(SP_KLAR);
      localStorage.removeItem(SP_TRESOR);
      tresorKey = null;
      db = leereDb();
      filter = { konten:[], kategorie:'', suche:'', nurUnsortiert:false };
      sichern();
      zeigeAnsicht('ueberblick');
      toast('Alles gelöscht');
    }, true);
}

/* ===================================================================
 * INFO-TEXTE
 * =================================================================== */
function infoThema(thema){
  if (thema === 'bruecke'){
    infoZeigen('Bankkonten anbinden',
      '<p class="klein">Eine Seite, die im Browser läuft, kann Konten nicht selbst abrufen – und darf es auch nicht:</p>' +
      '<ul class="klein leise"><li><b>FinTS/HBCI</b> ist kein Browser-Protokoll. Es braucht einen Prozess auf dem Rechner.</li>' +
      '<li><b>Aggregatoren</b> (Tink, Plaid, TrueLayer, Salt Edge, finAPI) verlangen ein geheimes Client-Secret ' +
      'und erlauben keine Zugriffe aus fremden Seiten. Ein Secret in einer öffentlichen Seite ist veröffentlicht.</li>' +
      '<li>Für den direkten Kontozugriff nach <b>PSD2</b> braucht man eine BaFin-Zulassung als Kontoinformationsdienst ' +
      'oder einen Vertrag mit einem zugelassenen Anbieter.</li></ul>' +
      '<p class="klein">Deshalb gibt es zwei Wege, die wirklich funktionieren:</p>' +
      '<p class="klein"><b>1. Auszug einlesen.</b> Aus dem Online-Banking herunterladen, hier hineinziehen. ' +
      'Kategorien setzt die App selbst, Doppelte erkennt sie.</p>' +
      '<p class="klein"><b>2. Eigene Brücke.</b> Ein kleiner Dienst bei dir, der mit der Bank spricht. ' +
      'Fertig gebaut gibt es ihn unter <a href="https://github.com/rianvegeta1991/finanzhelfer-bruecke" ' +
      'target="_blank" rel="noopener">finanzhelfer-bruecke</a> – er kann FinTS (ING, Commerzbank, Sparkassen, ' +
      'Volksbanken …), Bitvavo und Trade Republic. Wer selbst baut, muss nur diese Endpunkte liefern:</p>' +
      '<div class="kasten"><code>GET /konten</code><br>' +
      '<span class="mini">→ [{ref, name, bank, iban, art, saldo, waehrung}]</span><br><br>' +
      '<code>GET /umsaetze?konto=REF&amp;von=YYYY-MM-DD</code><br>' +
      '<span class="mini">→ [{datum, betrag, gegen, zweck, waehrung}]</span><br><br>' +
      '<code>GET /positionen</code> <span class="mini">(freiwillig, fürs Depot)</span></div>' +
      '<p class="klein leise">Beide Aufrufe tragen <code>Authorization: Bearer &lt;Token&gt;</code>. Die Brücke muss ' +
      'CORS für die Herkunft dieser Seite erlauben. Negativer Betrag = Abbuchung. Adresse und Token stehen ' +
      'unter <i>Mehr → Automatischer Abruf</i>.</p>');
    return;
  }
  if (thema === 'formate'){
    infoZeigen('Welche Auszüge gehen?',
      '<p class="klein"><b>CSV</b> – was Sparkasse, DKB, ING, comdirect, Consorsbank, N26 und die Volksbanken ' +
      'anbieten. Trennzeichen und Spalten erkennt die App selbst; Vorspann-Zeilen überspringt sie. Stimmt die ' +
      'Zuordnung nicht, lässt sie sich im Importfenster umstellen.</p>' +
      '<p class="klein"><b>CAMT.053</b> – der offizielle SEPA-Auszug als XML. Wird bevorzugt, weil Empfänger und ' +
      'Verwendungszweck dort in eigenen Feldern stehen.</p>' +
      '<p class="klein"><b>MT940</b> – das alte SWIFT-Format (<code>.sta</code>). Zweck und Name werden aus den ' +
      '<code>?20</code>- bis <code>?33</code>-Feldern zusammengesetzt.</p>' +
      '<p class="klein leise">Zahlen dürfen deutsch (1.234,56) oder englisch (1234.56) geschrieben sein, Datumsangaben ' +
      'als 31.12.2025, 31.12.25 oder 2025-12-31. Dateien in Windows-1252 werden erkannt, damit Umlaute stimmen.</p>');
    return;
  }
  if (thema === 'sicher'){
    infoZeigen('Wie sicher ist das?',
      '<p class="klein"><b>Was die App tut:</b> Deine Daten liegen ausschließlich im Speicher dieses Browsers. ' +
      'Es gibt kein Konto, keinen Server und keine Übertragung. Mit eingerichteter Sperre sind sie mit ' +
      'AES-256-GCM verschlüsselt; der Schlüssel entsteht per PBKDF2 (310 000 Runden, SHA-256) aus deiner ' +
      'Passphrase und wird nirgends abgelegt.</p>' +
      '<p class="klein"><b>Was nach draußen geht:</b> nur Kursabfragen – also Börsenkürzel wie ' +
      '<code>EUNL.DE</code> und dein Marktdaten-Schlüssel. Keine Kontodaten, keine Beträge, keine Namen. ' +
      'Der Abruf über eine eigene Brücke geht an die Adresse, die du selbst einträgst.</p>' +
      '<p class="klein"><b>Was sie nicht leisten kann:</b> Gegen Schadsoftware auf dem Gerät hilft keine ' +
      'Verschlüsselung im Browser – wer mitliest, während du entsperrt hast, sieht alles. Und wer die ' +
      'Passphrase verliert, verliert die Daten: es gibt keinen Zweitschlüssel.</p>' +
      '<p class="klein leise">Leg deshalb regelmäßig eine Sicherung an (<i>Daten → Sicherung als JSON</i>) und ' +
      'bewahre sie dort auf, wo du auch andere Finanzunterlagen hast.</p>');
  }
}
