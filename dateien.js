/* Finanzhelfer – Excel- und PDF-Dateien als Tabelle
 * =================================================
 * Nicht jede Bank gibt CSV heraus: die FNZ Bank liefert Bestände als
 * Excel-Mappe, manche Banken den Auszug nur als PDF. Beides wird hier auf
 * dieselbe Form gebracht wie eine CSV – `{ kopf, zeilen }` – und läuft danach
 * durch dieselbe Spaltenzuordnung (`csvVorschlag`) und dieselbe Vorschau.
 * Downstream muss also nichts wissen, woher die Tabelle kam.
 *
 * Kein Node, kein Build, keine fremde Bibliothek: eine xlsx-Datei ist ein ZIP
 * voller XML, und die PDF wird hier von Hand zerlegt. Ausgepackt wird mit
 * `DecompressionStream`, das bringt der Browser selbst mit.
 *
 * Grenzen, ehrlich benannt:
 * - Das alte `.xls` (Binärformat vor 2007) geht nicht – als xlsx oder CSV
 *   speichern.
 * - Eine eingescannte PDF enthält keinen Text, nur ein Bild. OCR kann die App
 *   nicht, und das soll sie auch nicht vortäuschen.
 * - PDF ist ein Druckformat, kein Datenformat. Was hier herauskommt, ist eine
 *   gute Rekonstruktion – aber eben eine. Deshalb zeigt die Vorschau davor
 *   einen Warnhinweis.
 */

/* ===================================================================
 * ZIP (für xlsx)
 * =================================================================== */

/* Gelesen wird über das zentrale Verzeichnis am Dateiende, nicht über die
 * lokalen Kopfdaten: nur dort stehen die Größen verlässlich (bei gestreamt
 * geschriebenen ZIPs sind sie im lokalen Kopf 0). */
function zipVerzeichnis(puffer){
  const dv = new DataView(puffer);
  const b = new Uint8Array(puffer);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--){
    if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Die Datei ist kein gültiges ZIP – xlsx-Dateien sind welche.');
  const anzahl = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const eintraege = new Map();
  for (let i = 0; i < anzahl && p + 46 <= b.length; i++){
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const methode = dv.getUint16(p + 10, true);
    const groesse = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const kommLen = dv.getUint16(p + 32, true);
    const lokal = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(b.subarray(p + 46, p + 46 + nameLen));
    eintraege.set(name, { methode, groesse, lokal });
    p += 46 + nameLen + extraLen + kommLen;
  }
  return { dv, b, eintraege };
}

async function zipText(zip, name){
  const e = zip.eintraege.get(name);
  if (!e) return '';
  if (e.groesse === 0xFFFFFFFF) throw new Error('Die Datei nutzt ZIP64 – bitte als CSV speichern.');
  const lh = e.lokal;
  const nameLen = zip.dv.getUint16(lh + 26, true);
  const extraLen = zip.dv.getUint16(lh + 28, true);
  const start = lh + 30 + nameLen + extraLen;
  const roh = zip.b.subarray(start, start + e.groesse);
  if (e.methode === 0) return new TextDecoder('utf-8').decode(roh);
  if (e.methode !== 8) throw new Error('Die xlsx-Datei nutzt eine unbekannte Komprimierung.');
  return entpacken(roh, 'deflate-raw').then((u) => new TextDecoder('utf-8').decode(u));
}

/* `DecompressionStream` gibt es seit Chrome 80 / Safari 16.4 / Firefox 113.
 * Fehlt es, sagen wir das klar, statt still nichts zu tun. */
async function entpacken(bytes, art){
  if (typeof DecompressionStream !== 'function'){
    throw new Error('Dieser Browser kann keine komprimierten Dateien auspacken. Bitte als CSV speichern.');
  }
  const strom = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(art));
  const puffer = await new Response(strom).arrayBuffer();
  return new Uint8Array(puffer);
}

/* ===================================================================
 * XLSX
 * =================================================================== */

function xmlLesen(text){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Die Excel-Mappe ist beschädigt.');
  return doc;
}

/* Spaltenbuchstabe aus „BC12“ → 54 (nullbasiert). Ohne das verrutschen
 * Zeilen mit leeren Zellen, denn die fehlen in der XML schlicht. */
function xlsxSpalte(ref){
  const m = String(ref || '').match(/^([A-Z]+)/);
  if (!m) return -1;
  let n = 0;
  for (const z of m[1]) n = n * 26 + (z.charCodeAt(0) - 64);
  return n - 1;
}

/* Zahlen stehen in der Datei immer englisch („142.765“ sind 142 Komma 765).
 * Als Text weitergereicht würde daraus über die Tausenderpunkt-Regel von
 * `impZahl` die Zahl 142 765 – genau der Fehler, der schon einmal aus
 * Fondsanteilen Millionen gemacht hat. Deshalb hier auf deutsche Schreibweise
 * drehen, bevor die Zelle irgendwo als Text ankommt. */
function xlsxZahl(roh){
  const n = Number(roh);
  if (!isFinite(n)) return String(roh);
  const s = Math.abs(n) < 1e15 ? String(n) : n.toFixed(2);
  return s.indexOf('e') >= 0 ? String(roh) : s.replace('.', ',');
}

/* Excel speichert Datumsangaben als Zahl. 25569 = 01.01.1970 in Excel-Zählung. */
function xlsxDatum(n){
  if (!isFinite(n) || n <= 0) return String(n);
  const d = new Date(Math.round((n - 25569) * 86400000));
  if (isNaN(d.getTime())) return String(n);
  return String(d.getUTCDate()).padStart(2, '0') + '.' +
         String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear();
}

/* Welche Zellformate sind Datumsformate? Die eingebauten Nummern stehen fest,
 * eigene erkennt man am Formatcode (der steht immer englisch in der Datei,
 * auch bei deutschem Excel). */
const XLSX_DATUM_IDS = new Set(['14','15','16','17','18','19','20','21','22','45','46','47']);
function xlsxDatumStile(doc){
  const eigene = new Map();
  doc.querySelectorAll('numFmts > numFmt').forEach((n) => {
    eigene.set(n.getAttribute('numFmtId'), n.getAttribute('formatCode') || '');
  });
  const raus = [];
  doc.querySelectorAll('cellXfs > xf').forEach((x) => {
    const id = x.getAttribute('numFmtId') || '0';
    let datum = XLSX_DATUM_IDS.has(id);
    if (!datum && eigene.has(id)){
      const code = eigene.get(id).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
      datum = /[dy]/.test(code);
    }
    raus.push(datum);
  });
  return raus;
}

function xlsxText(knoten){
  if (!knoten) return '';
  return Array.from(knoten.getElementsByTagName('t')).map((t) => t.textContent).join('');
}

function xlsxMatrix(doc, texte, datumStil){
  const matrix = [];
  doc.querySelectorAll('sheetData > row').forEach((r) => {
    const felder = [];
    r.querySelectorAll('c').forEach((c) => {
      const sp = xlsxSpalte(c.getAttribute('r'));
      const art = c.getAttribute('t');
      let wert = '';
      if (art === 'inlineStr'){
        wert = xlsxText(c.querySelector('is'));
      } else {
        const v = c.querySelector('v');
        const roh = v ? v.textContent : '';
        if (art === 's') wert = texte[Number(roh)] || '';
        else if (art === 'e') wert = '';
        else if (art === 'b') wert = roh === '1' ? 'ja' : 'nein';
        else if (roh !== ''){
          const stil = Number(c.getAttribute('s') || 0);
          wert = datumStil[stil] ? xlsxDatum(Number(roh)) : xlsxZahl(roh);
        }
      }
      const i = sp >= 0 ? sp : felder.length;
      while (felder.length < i) felder.push('');
      felder[i] = wert;
    });
    matrix.push(felder);
  });
  return matrix.filter((z) => z.some((f) => String(f).trim() !== ''));
}

/* Alle Blätter einer Mappe als Matrix. Die Reihenfolge ist die aus Excel. */
async function xlsxBlaetter(puffer){
  const zip = zipVerzeichnis(puffer);
  if (!zip.eintraege.has('xl/workbook.xml')){
    throw new Error('Das ist keine Excel-Mappe (xl/workbook.xml fehlt).');
  }
  const texte = [];
  if (zip.eintraege.has('xl/sharedStrings.xml')){
    xmlLesen(await zipText(zip, 'xl/sharedStrings.xml'))
      .querySelectorAll('sst > si').forEach((si) => texte.push(xlsxText(si)));
  }
  const datumStil = zip.eintraege.has('xl/styles.xml')
    ? xlsxDatumStile(xmlLesen(await zipText(zip, 'xl/styles.xml'))) : [];

  // Blattnamen stehen in workbook.xml, die Dateinamen in den Beziehungen
  const wb = xmlLesen(await zipText(zip, 'xl/workbook.xml'));
  const pfade = new Map();
  if (zip.eintraege.has('xl/_rels/workbook.xml.rels')){
    xmlLesen(await zipText(zip, 'xl/_rels/workbook.xml.rels'))
      .querySelectorAll('Relationship').forEach((r) => {
        let ziel = r.getAttribute('Target') || '';
        if (!ziel.startsWith('/')) ziel = 'xl/' + ziel.replace(/^\.\//, '');
        pfade.set(r.getAttribute('Id'), ziel.replace(/^\//, ''));
      });
  }
  const blaetter = [];
  const knoten = Array.from(wb.querySelectorAll('sheets > sheet'));
  for (let i = 0; i < knoten.length; i++){
    const s = knoten[i];
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const pfad = pfade.get(rid) || ('xl/worksheets/sheet' + (i + 1) + '.xml');
    if (!zip.eintraege.has(pfad)) continue;
    const matrix = xlsxMatrix(xmlLesen(await zipText(zip, pfad)), texte, datumStil);
    if (matrix.length) blaetter.push({ name: s.getAttribute('name') || ('Blatt ' + (i + 1)), matrix });
  }
  if (!blaetter.length) throw new Error('In der Mappe steht keine gefüllte Tabelle.');
  return blaetter;
}

/* ===================================================================
 * PDF
 * ===================================================================
 * Eine PDF ist eine Sammlung nummerierter Objekte; Text steckt in
 * komprimierten Inhaltsströmen als Folge von Befehlen. Gelesen wird in vier
 * Schritten: Objekte finden → Ströme auspacken → Befehle ausführen und dabei
 * Textstücke mit ihrer Position merken → aus den Positionen Zeilen und
 * Spalten rekonstruieren.
 */

/* Bytes als Zeichen 1:1 – nicht über TextDecoder, denn „iso-8859-1“ wird dort
 * als Windows-1252 behandelt und verbiegt 0x80–0x9F. */
function byteText(b){
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return s;
}
function textBytes(s){
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
  return u;
}

/* Alle „N 0 obj … endobj“ einsammeln. Über Ströme wird hinweggesprungen,
 * sonst findet die Suche in Binärdaten Scheinobjekte. */
function pdfObjekte(roh){
  const map = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(roh))){
    const start = m.index + m[0].length;
    let ende;
    const sIdx = roh.indexOf('stream', start);
    const eIdx = roh.indexOf('endobj', start);
    if (sIdx >= 0 && (eIdx < 0 || sIdx < eIdx)){
      const stromEnde = roh.indexOf('endstream', sIdx);
      ende = stromEnde < 0 ? (eIdx < 0 ? roh.length : eIdx) : roh.indexOf('endobj', stromEnde);
      if (ende < 0) ende = stromEnde + 9;
      re.lastIndex = ende;
    } else {
      ende = eIdx < 0 ? roh.length : eIdx;
    }
    map.set(Number(m[1]), roh.slice(start, ende));
  }
  return map;
}

/* Der Wörterbuchteil eines Objekts – alles vor „stream“. */
function pdfDict(koerper){
  const i = koerper.indexOf('stream');
  return i < 0 ? koerper : koerper.slice(0, i);
}

/* Inhalt eines Stroms, ausgepackt. Nur FlateDecode und unkomprimiert –
 * mehr kommt in Textseiten nicht vor. */
async function pdfStrom(koerper){
  const m = koerper.match(/stream\r\n|stream\n|stream\r/);
  if (!m) return '';
  const dict = koerper.slice(0, m.index);
  const start = m.index + m[0].length;
  let ende = koerper.indexOf('endstream', start);
  if (ende < 0) ende = koerper.length;
  const laenge = Number((dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/) || [])[1]);
  const daten = koerper.slice(start, isFinite(laenge) && laenge > 0 && start + laenge <= ende ? start + laenge : ende);
  if (!/\/Filter/.test(dict)) return daten;
  if (!/FlateDecode/.test(dict)) return '';
  if (/\/Predictor/.test(dict)) return '';
  const bytes = textBytes(daten);
  // FlateDecode ist zlib; manche Erzeuger schreiben den Strom aber ohne
  // zlib-Kopf, deshalb der zweite Versuch.
  try { return byteText(await entpacken(bytes, 'deflate')); }
  catch (e){
    try { return byteText(await entpacken(bytes, 'deflate-raw')); }
    catch (e2){ return ''; }
  }
}

/* Seiten in Lesereihenfolge: dem Seitenbaum folgen. Findet sich keiner,
 * bleibt die Objektnummer – besser als gar nichts. */
function pdfSeitenFolge(objekte){
  const knoten = new Map();
  const kind = new Set();
  const seiten = new Set();
  objekte.forEach((koerper, num) => {
    const d = pdfDict(koerper);
    if (/\/Type\s*\/Pages\b/.test(d)){
      const kids = (d.match(/\/Kids\s*\[([\s\S]*?)\]/) || ['', ''])[1];
      const liste = (kids.match(/(\d+)\s+\d+\s+R/g) || []).map((s) => Number(s.match(/\d+/)[0]));
      knoten.set(num, liste);
      liste.forEach((k) => kind.add(k));
    } else if (/\/Type\s*\/Page\b/.test(d)){
      seiten.add(num);
    }
  });
  const folge = [];
  const gehe = (num, tiefe) => {
    if (tiefe > 50 || folge.includes(num)) return;
    if (knoten.has(num)) knoten.get(num).forEach((k) => gehe(k, tiefe + 1));
    else if (seiten.has(num)) folge.push(num);
  };
  Array.from(knoten.keys()).filter((n) => !kind.has(n)).forEach((n) => gehe(n, 0));
  if (!folge.length) return Array.from(seiten).sort((a, b) => a - b);
  Array.from(seiten).sort((a, b) => a - b).forEach((n) => { if (!folge.includes(n)) folge.push(n); });
  return folge;
}

/* Balancierter Ausschnitt „<< … >>“ ab einer Fundstelle. */
function pdfKlammer(text, ab){
  const start = text.indexOf('<<', ab);
  if (start < 0) return '';
  let tiefe = 0;
  for (let i = start; i < text.length - 1; i++){
    if (text[i] === '<' && text[i + 1] === '<'){ tiefe++; i++; }
    else if (text[i] === '>' && text[i + 1] === '>'){ tiefe--; i++; if (!tiefe) return text.slice(start, i + 1); }
  }
  return text.slice(start);
}

/* Verweise auflösen: „/Resources 7 0 R“ → Wörterbuch von Objekt 7. */
function pdfWert(dict, name, objekte){
  const re = new RegExp('\\/' + name + '\\s*(\\d+)\\s+\\d+\\s+R');
  const ref = dict.match(re);
  if (ref && objekte.has(Number(ref[1]))) return pdfDict(objekte.get(Number(ref[1])));
  const i = dict.indexOf('/' + name);
  return i < 0 ? '' : pdfKlammer(dict, i);
}

function hexZuText(hex){
  let s = '';
  for (let i = 0; i + 4 <= hex.length; i += 4){
    const c = parseInt(hex.substr(i, 4), 16);
    if (isFinite(c) && c) s += String.fromCharCode(c);
  }
  return s;
}

/* ToUnicode-CMap: bildet die Zeichenkennungen einer Teilmenge-Schrift auf
 * echte Zeichen ab. Ohne sie käme bei vielen PDFs Buchstabensalat heraus. */
function pdfCmap(txt){
  const map = new Map();
  let m;
  const bf = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = bf.exec(txt))){
    const paare = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || [];
    paare.forEach((p) => {
      const t = p.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      map.set(parseInt(t[1], 16), hexZuText(t[2]));
    });
  }
  const br = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = br.exec(txt))){
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    let r;
    while ((r = re.exec(m[1]))){
      const von = parseInt(r[1], 16), bis = Math.min(parseInt(r[2], 16), parseInt(r[1], 16) + 4096);
      if (r[3] !== undefined){
        const basis = parseInt(r[3], 16);
        for (let c = von; c <= bis; c++) map.set(c, String.fromCharCode(basis + (c - von)));
      } else {
        (r[4].match(/<([0-9A-Fa-f]+)>/g) || []).forEach((e, i) => map.set(von + i, hexZuText(e.replace(/[<>]/g, ''))));
      }
    }
  }
  return map;
}

/* Die Stellen, an denen WinAnsi von Latin-1 abweicht – darunter das Euro-
 * Zeichen und die deutschen Anführungszeichen. */
const WINANSI = { 128:'€', 130:'‚', 131:'ƒ', 132:'„', 133:'…', 134:'†', 135:'‡', 136:'ˆ', 137:'‰',
  138:'Š', 139:'‹', 140:'Œ', 142:'Ž', 145:'‘', 146:'’', 147:'“', 148:'”', 149:'•', 150:'–',
  151:'—', 152:'˜', 153:'™', 154:'š', 155:'›', 156:'œ', 158:'ž', 159:'Ÿ' };

/* Schriftarten einer Seite einsammeln: je Kurzname die CMap und ob die Codes
 * ein oder zwei Byte breit sind. */
async function pdfSchriften(resDict, objekte){
  const schriften = new Map();
  const fontDict = pdfWert(resDict, 'Font', objekte);
  const re = /\/([^\s\/\[\]<>]+)\s+(\d+)\s+\d+\s+R/g;
  let m;
  while ((m = re.exec(fontDict))){
    const obj = objekte.get(Number(m[2]));
    if (!obj) continue;
    const d = pdfDict(obj);
    const eintrag = { breit: /\/Subtype\s*\/Type0\b/.test(d), cmap: null };
    const tu = d.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (tu && objekte.has(Number(tu[1]))){
      const txt = await pdfStrom(objekte.get(Number(tu[1])));
      if (txt) eintrag.cmap = pdfCmap(txt);
    }
    schriften.set(m[1], eintrag);
  }
  return schriften;
}

/* Zerlegt einen Inhaltsstrom in Zahlen, Zeichenketten, Namen und Befehle. */
function pdfToken(s){
  const raus = [];
  const n = s.length;
  let i = 0;
  while (i < n){
    const c = s[i];
    if (c === '%'){ while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0'){ i++; continue; }
    if (c === '('){
      let tiefe = 1, j = i + 1, txt = '';
      while (j < n && tiefe){
        const z = s[j];
        if (z === '\\'){
          const nx = s[j + 1];
          if (nx >= '0' && nx <= '7'){
            let okt = '', k = j + 1;
            while (k < n && okt.length < 3 && s[k] >= '0' && s[k] <= '7'){ okt += s[k]; k++; }
            txt += String.fromCharCode(parseInt(okt, 8)); j = k; continue;
          }
          if (nx === '\n' || nx === '\r'){ j += 2; continue; }
          const karte = { n:'\n', r:'\r', t:'\t', b:'\b', f:'\f' };
          txt += karte[nx] !== undefined ? karte[nx] : nx;
          j += 2; continue;
        }
        if (z === '('){ tiefe++; txt += z; j++; continue; }
        if (z === ')'){ tiefe--; if (tiefe) txt += z; j++; continue; }
        txt += z; j++;
      }
      raus.push({ t:'str', v: txt }); i = j; continue;
    }
    if (c === '<' && s[i + 1] === '<'){ raus.push({ t:'op', v:'<<' }); i += 2; continue; }
    if (c === '>' && s[i + 1] === '>'){ raus.push({ t:'op', v:'>>' }); i += 2; continue; }
    if (c === '<'){
      const e = s.indexOf('>', i);
      raus.push({ t:'hex', v: s.slice(i + 1, e < 0 ? n : e).replace(/[^0-9A-Fa-f]/g, '') });
      i = e < 0 ? n : e + 1; continue;
    }
    if (c === '/'){
      let j = i + 1;
      while (j < n && !/[\s()<>\[\]{}\/%]/.test(s[j])) j++;
      raus.push({ t:'name', v: s.slice(i + 1, j) }); i = j; continue;
    }
    if (c === '[' || c === ']'){ raus.push({ t:'op', v:c }); i++; continue; }
    if (/[-+.\d]/.test(c)){
      let j = i;
      while (j < n && /[-+.\d]/.test(s[j])) j++;
      const z = parseFloat(s.slice(i, j));
      raus.push({ t:'num', v: isFinite(z) ? z : 0 }); i = j; continue;
    }
    let j = i;
    while (j < n && !/[\s()<>\[\]{}\/%]/.test(s[j])) j++;
    if (j === i) j++;
    raus.push({ t:'op', v: s.slice(i, j) }); i = j; continue;
  }
  return raus;
}

function matMal(a, b){
  return [ a[0]*b[0] + a[1]*b[2],       a[0]*b[1] + a[1]*b[3],
           a[2]*b[0] + a[3]*b[2],       a[2]*b[1] + a[3]*b[3],
           a[4]*b[0] + a[5]*b[2] + b[4], a[4]*b[1] + a[5]*b[3] + b[5] ];
}

/* Zeichenkette in Text übersetzen – über die CMap der aktiven Schrift. */
function pdfEntziffern(roh, schrift, hex){
  if (hex){
    const codes = [];
    const breite = schrift && schrift.breit ? 4 : 2;
    for (let i = 0; i + breite <= roh.length; i += breite) codes.push(parseInt(roh.substr(i, breite), 16));
    return codes.map((c) => pdfZeichen(c, schrift)).join('');
  }
  if (schrift && schrift.breit){
    let s = '';
    for (let i = 0; i + 1 < roh.length; i += 2) s += pdfZeichen((roh.charCodeAt(i) << 8) | roh.charCodeAt(i + 1), schrift);
    return s;
  }
  let s = '';
  for (let i = 0; i < roh.length; i++) s += pdfZeichen(roh.charCodeAt(i), schrift);
  return s;
}
function pdfZeichen(code, schrift){
  if (schrift && schrift.cmap && schrift.cmap.has(code)) return schrift.cmap.get(code);
  return WINANSI[code] || String.fromCharCode(code);
}

/* Führt die Textbefehle aus und gibt Textstücke mit Position zurück.
 * Die Breite einzelner Zeichen kennen wir ohne Schriftmetrik nicht – deshalb
 * bekommt jedes Stück nur seinen Anfangspunkt, und innerhalb einer TJ-Liste
 * wird ein Leerzeichen eingesetzt, wenn der Versatz groß genug ist. */
function pdfStuecke(inhalt, schriften){
  const raus = [];
  const toks = pdfToken(inhalt);
  let ctm = [1,0,0,1,0,0], tm = ctm.slice(), tlm = ctm.slice();
  const stapel = [];
  let zl = 0, groesse = 10, schrift = null, hs = 1;
  let arg = [];

  const setzen = (text) => {
    if (!text) return;
    const m = matMal(tm, ctm);
    raus.push({ x: m[4], y: m[5], groesse: Math.abs(groesse * (m[3] || 1)) || 10, text });
  };
  const versetzen = (tx, ty) => { tlm = matMal([1,0,0,1,tx,ty], tlm); tm = tlm.slice(); };

  toks.forEach((tk) => {
    if (tk.t !== 'op'){ arg.push(tk); return; }
    const z = (i) => { const a = arg[arg.length - i]; return a && a.t === 'num' ? a.v : 0; };
    switch (tk.v){
      case 'q': stapel.push(ctm.slice()); break;
      case 'Q': if (stapel.length) ctm = stapel.pop(); break;
      case 'cm': ctm = matMal([z(6), z(5), z(4), z(3), z(2), z(1)], ctm); break;
      case 'BT': tm = [1,0,0,1,0,0]; tlm = tm.slice(); break;
      case 'Tf': {
        const nam = arg.filter((a) => a.t === 'name').pop();
        schrift = nam ? schriften.get(nam.v) || null : schrift;
        groesse = z(1) || groesse;
        break;
      }
      case 'TL': zl = z(1); break;
      case 'Td': versetzen(z(2), z(1)); break;
      case 'TD': zl = -z(1); versetzen(z(2), z(1)); break;
      case 'Tm': tlm = [z(6), z(5), z(4), z(3), z(2), z(1)]; tm = tlm.slice(); break;
      case 'T*': versetzen(0, -zl); break;
      case 'Tz': hs = (z(1) || 100) / 100; break;
      case 'Tj': case "'": case '"': {
        if (tk.v !== 'Tj') versetzen(0, -zl);
        const s = arg.filter((a) => a.t === 'str' || a.t === 'hex').pop();
        if (s) setzen(pdfEntziffern(s.v, schrift, s.t === 'hex'));
        break;
      }
      case 'TJ': {
        let text = '';
        let offen = false;
        for (let i = 0; i < arg.length; i++){
          const a = arg[i];
          if (a.t === 'op' && a.v === '[') { offen = true; text = ''; continue; }
          if (!offen) continue;
          if (a.t === 'str' || a.t === 'hex') text += pdfEntziffern(a.v, schrift, a.t === 'hex');
          else if (a.t === 'num' && a.v <= -120 && text && !/\s$/.test(text)) text += ' ';
        }
        setzen(text);
        break;
      }
      default: break;
    }
    if (tk.v !== '[' && tk.v !== ']') arg = [];
    else arg.push(tk);
  });
  return raus;
}

/* Textstücke einer Seite zu Zeilen bündeln: gleiche Höhe = eine Zeile. */
function pdfZeilen(stuecke){
  const sortiert = stuecke.slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const zeilen = [];
  sortiert.forEach((s) => {
    if (!String(s.text).trim()) return;
    const letzte = zeilen[zeilen.length - 1];
    const toleranz = Math.max(1.6, s.groesse * 0.4);
    if (letzte && Math.abs(letzte.y - s.y) <= toleranz) letzte.teile.push(s);
    else zeilen.push({ y: s.y, teile: [s] });
  });
  zeilen.forEach((z) => z.teile.sort((a, b) => a.x - b.x));
  return zeilen;
}

/* Spalten aus den Anfangspunkten: x-Werte, die sich über viele Zeilen
 * wiederholen, sind Tabellenspalten. */
function pdfSpalten(zeilen){
  const xs = [];
  zeilen.forEach((z) => z.teile.forEach((t) => xs.push(t.x)));
  xs.sort((a, b) => a - b);
  const gruppen = [];
  xs.forEach((x) => {
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && x - letzte.x <= 4){ letzte.n++; letzte.x = (letzte.x * (letzte.n - 1) + x) / letzte.n; }
    else gruppen.push({ x, n: 1 });
  });
  const schwelle = Math.max(3, Math.round(zeilen.length * 0.25));
  return gruppen.filter((g) => g.n >= schwelle).map((g) => g.x).sort((a, b) => a - b);
}

function pdfAlsSpalten(zeilen){
  const spalten = pdfSpalten(zeilen);
  if (spalten.length < 3) return [];
  return zeilen.map((z) => {
    const felder = new Array(spalten.length).fill('');
    z.teile.forEach((t) => {
      let i = 0;
      for (let k = 0; k < spalten.length; k++) if (t.x >= spalten[k] - 2.5) i = k;
      felder[i] = (felder[i] ? felder[i] + ' ' : '') + t.text;
    });
    return felder.map((f) => f.replace(/\s+/g, ' ').trim());
  }).filter((z) => z.some((f) => f !== ''));
}

/* Notlösung, wenn keine Spalten zu erkennen sind: jede Zeile als Text lesen
 * und Datum, Betrag und Rest herausschneiden. Fortsetzungszeilen ohne Datum
 * hängen sich an die vorige Buchung an – so stehen mehrzeilige
 * Verwendungszwecke beieinander. */
const PDF_ZEILE = /^(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})\s+(?:(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})\s+)?(.*?)\s+(-?[\d.\s]*\d,\d{2})\s*([+-SH])?$/;
function pdfAlsZeilentext(zeilen){
  const raus = [];
  zeilen.forEach((z) => {
    const text = z.teile.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const m = text.match(PDF_ZEILE);
    if (m){
      let betrag = m[4].replace(/\s/g, '');
      if (m[5] === '-' || m[5] === 'S') betrag = '-' + betrag.replace('-', '');
      raus.push([m[1], m[2] || m[1], m[3].trim(), betrag]);
    } else if (raus.length && !/^\s*$/.test(text) && text.length < 120){
      const letzte = raus[raus.length - 1];
      letzte[2] = (letzte[2] + ' ' + text).trim();
    }
  });
  return raus.length ? [['Buchungstag', 'Valuta', 'Verwendungszweck', 'Betrag']].concat(raus) : [];
}

/* Wie brauchbar ist eine Tabelle? Gezählt wird, wie viele Zeilen das ergeben,
 * worauf es ankommt – bei Auszügen Datum und Betrag, bei Beständen eine ISIN
 * oder ein Name mit Zahlen daneben. Danach entscheidet sich, welche der
 * beiden Rekonstruktionen gewinnt. */
function tabelleGuete(zeilen, zweck){
  if (!zeilen.length) return 0;
  const breite = Math.max.apply(null, zeilen.map((z) => z.length));
  if (zweck === 'positionen'){
    // Eine ISIN ist das stärkste Zeichen für eine Bestandsliste. Sonst zählt
    // eine Bezeichnung mit mindestens zwei Zahlen daneben – Datumsangaben
    // ausgenommen, sonst sieht jede Buchungszeile wie ein Bestand aus.
    let punkte = 0;
    zeilen.forEach((z) => {
      const isin = z.some((f) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(String(f).replace(/\s/g, '')));
      const zahlen = z.filter((f) => String(f).trim() !== '' && !impDatum(f) && isFinite(impZahlGenau(f))).length;
      const text = z.some((f) => String(f).trim().length > 3 && !/^[\d.,\s-]+$/.test(String(f)) && !impDatum(f));
      if (isin) punkte += 3;
      else if (text && zahlen >= 2) punkte += 1;
    });
    return punkte;
  }
  let beste = 0;
  for (let d = 0; d < breite; d++){
    for (let b = 0; b < breite; b++){
      if (d === b) continue;
      const treffer = zeilen.filter((z) => impDatum(z[d]) && isFinite(impZahl(z[b])) && String(z[b]).trim() !== '').length;
      if (treffer > beste) beste = treffer;
    }
  }
  return beste;
}

/* Der ganze Weg: PDF → Tabelle. */
async function pdfTabelle(puffer, zweck){
  const b = new Uint8Array(puffer);
  const roh = byteText(b);
  if (!/%PDF-/.test(roh.slice(0, 1024))) throw new Error('Das ist keine PDF-Datei.');
  if (/\/Encrypt\s/.test(roh)){
    throw new Error('Die PDF ist mit einem Passwort geschützt. Öffne sie und speichere sie ohne Schutz.');
  }
  const objekte = pdfObjekte(roh);
  const folge = pdfSeitenFolge(objekte);
  if (!folge.length) throw new Error('In der PDF ist keine Seite zu finden.');

  const alleZeilen = [];
  for (const num of folge){
    const koerper = objekte.get(num);
    if (!koerper) continue;
    const d = pdfDict(koerper);
    const res = pdfWert(d, 'Resources', objekte);
    const schriften = await pdfSchriften(res, objekte);
    const refs = (d.match(/\/Contents\s*(?:\[([\s\S]*?)\]|(\d+)\s+\d+\s+R)/) || []);
    const nummern = refs[1] ? (refs[1].match(/(\d+)\s+\d+\s+R/g) || []).map((s) => Number(s.match(/\d+/)[0]))
                            : (refs[2] ? [Number(refs[2])] : []);
    let inhalt = '';
    for (const n of nummern) if (objekte.has(n)) inhalt += await pdfStrom(objekte.get(n)) + '\n';
    if (!inhalt.trim()) continue;
    pdfZeilen(pdfStuecke(inhalt, schriften)).forEach((z) => alleZeilen.push(z));
  }
  if (!alleZeilen.length){
    throw new Error('In der PDF steht kein auslesbarer Text – vermutlich ein Scan. Ein Bild kann die App nicht lesen.');
  }

  const ausSpalten = pdfAlsSpalten(alleZeilen);
  const ausText = pdfAlsZeilentext(alleZeilen);
  const gA = tabelleGuete(ausSpalten, zweck);
  const gB = tabelleGuete(ausText.slice(1), zweck);
  const matrix = gB > gA ? ausText : ausSpalten;
  if (!matrix.length || Math.max(gA, gB) === 0){
    throw new Error('Aus der PDF ließ sich keine Tabelle rekonstruieren. Lade den Auszug als CSV herunter, ' +
      'wenn deine Bank das anbietet.');
  }
  return { matrix, zeilenGesamt: alleZeilen.length, weg: gB > gA ? 'Textzeilen' : 'Spalten' };
}

/* ===================================================================
 * gemeinsamer Einstieg
 * =================================================================== */

/* Aus einer Matrix wird dieselbe Struktur, die impCsvLesen liefert –
 * damit Zuordnung und Vorschau nichts von der Herkunft wissen müssen. */
function tabelleAusMatrix(matrix, art, zusatz){
  const kopfIdx = csvKopfZeile(matrix);
  const kopf = (matrix[kopfIdx] || []).map((s) => String(s).trim());
  const breite = Math.max.apply(null, matrix.map((z) => z.length));
  while (kopf.length < breite) kopf.push('');
  const zeilen = matrix.slice(kopfIdx + 1).filter((z) => z.some((f) => String(f).trim() !== ''));
  return Object.assign({
    art, kopf, zeilen,
    zuordnung: art === 'positionen-tabelle' ? csvPosVorschlag(kopf) : csvVorschlag(kopf)
  }, zusatz || {});
}

/* Woran erkennt man das Format? An den ersten Bytes, nicht an der Endung –
 * die lügt öfter, als man denkt. */
function dateiFormat(puffer, name){
  const b = new Uint8Array(puffer, 0, Math.min(8, puffer.byteLength));
  if (b[0] === 0x50 && b[1] === 0x4B && (b[2] === 3 || b[2] === 5 || b[2] === 7)) return 'xlsx';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'xls';
  return /\.xlsx?$/i.test(name || '') ? 'xls' : 'text';
}

/* Liest eine Datei und liefert entweder Text (CSV, XML, MT940) oder eine
 * fertige Tabelle. `zweck` steuert nur, wonach die PDF-Erkennung sucht. */
async function dateiEinlesen(datei, zweck){
  const puffer = await datei.arrayBuffer();
  const format = dateiFormat(puffer, datei.name);

  if (format === 'xls'){
    throw new Error('Das alte Excel-Format (.xls) kann die App nicht lesen. ' +
      'Öffne die Datei und speichere sie als .xlsx oder als CSV.');
  }
  if (format === 'xlsx'){
    const blaetter = await xlsxBlaetter(puffer);
    const bewertet = blaetter.map((bl, i) => ({ i, name: bl.name, guete: tabelleGuete(bl.matrix, zweck) }));
    const beste = bewertet.slice().sort((a, b) => b.guete - a.guete)[0];
    return { art:'xlsx', blaetter, blatt: beste ? beste.i : 0,
             quelle: 'Excel-Mappe', blattNamen: blaetter.map((bl) => bl.name) };
  }
  if (format === 'pdf'){
    const erg = await pdfTabelle(puffer, zweck);
    return { art:'pdf', matrix: erg.matrix, quelle:'PDF', weg: erg.weg, zeilenGesamt: erg.zeilenGesamt };
  }

  // Textdateien: Auszüge kommen oft in Windows-1252 (Sparkasse, Volksbank).
  const utf8 = new TextDecoder('utf-8').decode(puffer);
  let text = utf8;
  if (utf8.includes('�')){
    try { text = new TextDecoder('windows-1252').decode(puffer); } catch (e){ text = utf8; }
  }
  return { art:'text', text };
}
