/* Finanzhelfer – Speicher und Verschlüsselung
 *
 * Alles bleibt auf dem Gerät: es gibt keinen Server und kein Konto. Gespeichert
 * wird im localStorage, und zwar in genau einem von zwei Zuständen:
 *
 *   offen     → 'finanzhelfer-daten' enthält das JSON im Klartext
 *   gesperrt  → 'finanzhelfer-tresor' enthält {salt, iv, ct}; ct ist mit AES-GCM
 *               verschlüsselt, der Schlüssel kommt per PBKDF2 aus der Passphrase
 *
 * Beide Schlüssel existieren nie gleichzeitig – beim Sperren wird der Klartext
 * gelöscht, beim Entsperren-und-Aufheben der Tresor. Sonst läge eine Kopie der
 * Kontodaten offen herum, obwohl die App „verschlüsselt“ anzeigt.
 *
 * Die Passphrase wird nirgends abgelegt. Wer sie vergisst, verliert die Daten;
 * dafür gibt es den Export. */

const SP_KLAR   = 'finanzhelfer-daten';
const SP_TRESOR = 'finanzhelfer-tresor';
const SP_PBKDF2 = 310000;   // Runden – bewusst hoch; einmalig beim Ent-/Sperren

let db = null;              // der geladene Datenbestand, global
let tresorKey = null;       // CryptoKey, nur im Arbeitsspeicher
let speicherTimer = null;

/* ---------- leerer Bestand ---------- */
function leereDb(){
  return {
    v: 1,
    konten: [],
    umsaetze: [],
    depots: [],
    positionen: [],
    vertraege: [],
    depotVerlauf: [],  // taeglicher Depotwert, siehe depotStandFesthalten()
    regeln: [],          // eigene Kategorie-Regeln des Nutzers, stechen REGELN
    erledigt: [],        // abgelehnte Vertragsvorschläge (Signaturen), damit sie nicht wiederkommen
    einst: {
      kursKey: '',       // Schlüssel für die Marktdaten-API
      kursDienst: 'twelvedata',
      autoKurse: true,
      autoAbruf: true,   // beim Start selbsttätig bei der Brücke nachfragen
      sperreMin: 15,     // Minuten bis zur Selbstsperre; 0 = nie
      startAnsicht: 'ueberblick'
    },
    zuletztKurse: ''
  };
}

/* ---------- Zustand ---------- */
function speicherZustand(){
  if (localStorage.getItem(SP_TRESOR)) return db ? 'offen' : 'gesperrt';
  if (localStorage.getItem(SP_KLAR))   return 'offen';
  return 'leer';
}
function istVerschluesselt(){ return !!localStorage.getItem(SP_TRESOR); }

/* Lädt den Klartext-Bestand, falls vorhanden. Gibt false zurück, wenn ein
 * Tresor wartet – dann muss erst entsperrt werden. */
function ladeKlartext(){
  if (localStorage.getItem(SP_TRESOR)) return false;
  const roh = localStorage.getItem(SP_KLAR);
  db = roh ? pruefeDb(JSON.parse(roh)) : leereDb();
  return true;
}

/* Fehlende Felder nachziehen – so überlebt ein alter Bestand neue Versionen. */
function pruefeDb(d){
  const leer = leereDb();
  const fertig = Object.assign(leer, d || {});
  fertig.einst = Object.assign(leer.einst, (d && d.einst) || {});
  ['konten','umsaetze','depots','positionen','vertraege','regeln','erledigt','depotVerlauf'].forEach((f) => {
    if (!Array.isArray(fertig[f])) fertig[f] = [];
  });
  return fertig;
}

/* ---------- Verschlüsselung ---------- */
function b64(buf){
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function vonB64(s){
  const roh = atob(s);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return bytes;
}

async function leiteSchluessel(pass, salt){
  const basis = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt, iterations:SP_PBKDF2, hash:'SHA-256' },
    basis,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}

/* Richtet die Sperre ein bzw. ändert die Passphrase. Der Klartext verschwindet. */
async function sperreEinrichten(pass){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  tresorKey = await leiteSchluessel(pass, salt);
  localStorage.setItem(SP_TRESOR, JSON.stringify({ v:1, salt:b64(salt), iv:'', ct:'' }));
  await schreiben();
  localStorage.removeItem(SP_KLAR);
  return true;
}

/* Entsperrt. Gibt false zurück, wenn die Passphrase nicht passt – AES-GCM
 * merkt das selbst, das Entschlüsseln wirft dann einfach. */
async function entsperren(pass){
  const huelle = JSON.parse(localStorage.getItem(SP_TRESOR) || 'null');
  if (!huelle) return false;
  const key = await leiteSchluessel(pass, vonB64(huelle.salt));
  if (!huelle.ct){                      // frisch eingerichtet, noch nichts drin
    tresorKey = key; db = leereDb(); return true;
  }
  try {
    const klar = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv:vonB64(huelle.iv) }, key, vonB64(huelle.ct)
    );
    db = pruefeDb(JSON.parse(new TextDecoder().decode(klar)));
    tresorKey = key;
    return true;
  } catch (e){
    return false;
  }
}

/* Hebt die Sperre auf: Bestand landet wieder im Klartext. */
async function sperreAufheben(){
  if (!db) return false;
  localStorage.removeItem(SP_TRESOR);
  tresorKey = null;
  localStorage.setItem(SP_KLAR, JSON.stringify(db));
  return true;
}

/* Schließt den Bestand aus dem Arbeitsspeicher aus. */
function sperren(){
  db = null;
  tresorKey = null;
}

/* ---------- Schreiben ---------- */
async function schreiben(){
  if (!db) return;
  const text = JSON.stringify(db);
  if (tresorKey){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, tresorKey, new TextEncoder().encode(text));
    const huelle = JSON.parse(localStorage.getItem(SP_TRESOR) || '{}');
    huelle.iv = b64(iv);
    huelle.ct = b64(ct);
    localStorage.setItem(SP_TRESOR, JSON.stringify(huelle));
  } else {
    localStorage.setItem(SP_KLAR, text);
  }
}

/* Sammelschreiben: viele kleine Änderungen (z. B. beim Import) sollen nicht
 * jedes Mal durch PBKDF2/AES laufen. */
function sichern(){
  clearTimeout(speicherTimer);
  speicherTimer = setTimeout(() => { schreiben().catch((e) => console.warn('[Speicher]', e)); }, 250);
}
/* Sofort schreiben – vor dem Sperren und beim Verlassen der Seite. */
function sichernJetzt(){ clearTimeout(speicherTimer); return schreiben(); }

/* ---------- Export ----------
 * Semikolon als Trenner und Komma als Dezimalzeichen: so öffnet Excel die
 * Datei in deutscher Einstellung ohne Importdialog. Das BOM davor sorgt
 * dafür, dass Umlaute nicht zerfallen. */
function csvFeld(w){
  const s = String(w === null || w === undefined ? '' : w);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/* Zwei Nachkommastellen mit Komma. Ohne die Rundung stünde in der Datei
 * 849,2399999999998 – das ist reines Gleitkomma-Rauschen. */
function csvZahl(n, stellen){
  const s = (stellen === undefined ? 2 : stellen);
  return (Number(n) || 0).toFixed(s).replace('.', ',');
}
function csvBauen(kopf, zeilen){
  return '﻿' + [kopf].concat(zeilen).map((z) => z.map(csvFeld).join(';')).join('\r\n');
}
function dateiSpeichern(name, inhalt, typ){
  const blob = new Blob([inhalt], { type: typ || 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
