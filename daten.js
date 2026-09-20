/* Finanzhelfer – Stammdaten
 * Kategorien, Erkennungsregeln für die automatische Zuordnung, Turnus-Tabelle,
 * Formatierungshilfen. Alles global, kein Modulsystem (wie in den Nachbarprojekten). */

/* ---------- Kategorien ----------
 * art: 'ein'  = Einnahme
 *      'aus'  = Ausgabe
 *      'spar' = Sparen/Anlage – Geld verlässt das Konto, bleibt aber Vermögen.
 *               Zählt deshalb NICHT in die Ausgaben, sondern wird eigens ausgewiesen.
 *      'neutral' = Umbuchung zwischen eigenen Konten. Fällt aus jeder Auswertung
 *               heraus, sonst taucht dieselbe Summe als Ausgabe und als Einnahme auf. */
const KATEGORIEN = [
  { id:'gehalt',      name:'Gehalt & Lohn',        art:'ein', farbe:'#2e8b6f', icon:'💼' },
  { id:'kapital',     name:'Kapitalerträge',       art:'ein', farbe:'#3f9e86', icon:'📈' },
  { id:'erstattung',  name:'Erstattungen',         art:'ein', farbe:'#57b39c', icon:'↩️' },
  { id:'einnahmen',   name:'Sonstige Einnahmen',   art:'ein', farbe:'#6fc4ae', icon:'➕' },

  { id:'wohnen',      name:'Miete & Wohnen',       art:'aus', farbe:'#c0603f', icon:'🏠' },
  { id:'energie',     name:'Strom, Gas, Wasser',   art:'aus', farbe:'#d4823d', icon:'💡' },
  { id:'lebensmittel',name:'Lebensmittel',         art:'aus', farbe:'#d9a441', icon:'🛒' },
  { id:'restaurant',  name:'Restaurant & Café',    art:'aus', farbe:'#c98a5e', icon:'🍽️' },
  { id:'mobilitaet',  name:'Mobilität & Auto',     art:'aus', farbe:'#4a7fb5', icon:'🚗' },
  { id:'reisen',      name:'Reisen & Urlaub',      art:'aus', farbe:'#5e9ecf', icon:'✈️' },
  { id:'gesundheit',  name:'Gesundheit',           art:'aus', farbe:'#5aab7d', icon:'💊' },
  { id:'versicherung',name:'Versicherungen',       art:'aus', farbe:'#7b83c4', icon:'🛡️' },
  { id:'telekom',     name:'Telefon & Internet',   art:'aus', farbe:'#8a76c9', icon:'📱' },
  { id:'abos',        name:'Abos & Medien',        art:'aus', farbe:'#a86cbf', icon:'🎬' },
  { id:'freizeit',    name:'Freizeit & Sport',     art:'aus', farbe:'#c46bab', icon:'⚽' },
  { id:'shopping',    name:'Shopping',             art:'aus', farbe:'#cf6f8e', icon:'🛍️' },
  { id:'bildung',     name:'Bildung',              art:'aus', farbe:'#6f9ac4', icon:'📚' },
  { id:'kinder',      name:'Kinder & Familie',     art:'aus', farbe:'#c9855f', icon:'🧸' },
  { id:'haustier',    name:'Haustier',             art:'aus', farbe:'#a9925e', icon:'🐾' },
  { id:'spenden',     name:'Spenden & Geschenke',  art:'aus', farbe:'#b06f6f', icon:'🎁' },
  { id:'steuern',     name:'Steuern & Abgaben',    art:'aus', farbe:'#8f6f5e', icon:'🏛️' },
  { id:'gebuehren',   name:'Gebühren & Zinsen',    art:'aus', farbe:'#96736b', icon:'🏦' },
  { id:'bargeld',     name:'Bargeldabhebung',      art:'aus', farbe:'#7e8894', icon:'💶' },
  { id:'sonstiges',   name:'Sonstiges',            art:'aus', farbe:'#8d97a3', icon:'❓' },

  { id:'sparen',      name:'Sparen & Anlage',      art:'spar',    farbe:'#3d7fa8', icon:'🐖' },
  { id:'umbuchung',   name:'Umbuchung',            art:'neutral', farbe:'#9aa4b0', icon:'🔁' }
];

const KAT_MAP = Object.fromEntries(KATEGORIEN.map((k) => [k.id, k]));
function kat(id){ return KAT_MAP[id] || KAT_MAP.sonstiges; }
function katName(id){ return kat(id).name; }
function katFarbe(id){ return kat(id).farbe; }

/* ---------- Automatische Erkennung ----------
 * Reine Stichwortsuche im zusammengelegten Text aus Gegenseite + Verwendungszweck,
 * klein geschrieben und ohne Umlaute (siehe normal()). Die erste passende Regel
 * gewinnt, deshalb stehen eindeutige Anbieternamen vor allgemeinen Begriffen.
 * `vz` schränkt eine Regel auf ein Vorzeichen ein: 1 = nur Gutschriften,
 * -1 = nur Lastschriften. Ohne `vz` gilt sie für beide Richtungen. */
const REGELN = [
  { kat:'gehalt',      vz: 1, worte:['gehalt','lohn','bezuege','salaer','entgeltabrechnung','verguetung','honorar'] },
  { kat:'kapital',     vz: 1, worte:['dividende','zinsgutschrift','ausschuettung','ertragsgutschrift','kupon'] },
  { kat:'erstattung',  vz: 1, worte:['erstattung','rueckzahlung','retoure','rueckerstattung','kostenerstattung'] },

  { kat:'wohnen',      worte:['miete','mietzins','nebenkosten','hausgeld','wohnungsbau','kaltmiete','warmmiete','wohngeld','grundsteuer','hausverwaltung'] },
  { kat:'energie',     worte:['stadtwerke','energie','strom','vattenfall','e.on','eon ','enbw','rwe','lichtblick','naturstrom','gasag','wasserwerk','abwasser','yello','entsorgung','muellabfuhr'] },
  { kat:'telekom',     worte:['telekom','vodafone','o2 ','telefonica','1und1','1&1','congstar','pyur','unitymedia','m-net','netcologne','mobilfunk','dsl','glasfaser','aldi talk','winsim','fraenk'] },
  { kat:'abos',        worte:['netflix','spotify','disney','amazon prime','prime video','apple.com/bill','itunes','youtube','dazn','sky deutschland','waipu','audible','deezer','paramount','rundfunk','ard zdf','abonnement','patreon','twitch','playstation network','xbox','nintendo','steam','adobe','dropbox','google one','icloud','microsoft 365','chatgpt','anthropic','openai'] },
  { kat:'lebensmittel',worte:['rewe','edeka','aldi','lidl','kaufland','penny','netto','norma','globus','denns','alnatura','bioladen','tegut','famila','marktkauf','nahkauf','supermarkt','baecker','metzger','fleischerei','getraenkemarkt','wochenmarkt','flink','gorillas','picnic'] },
  { kat:'restaurant',  worte:['restaurant','gaststaette','pizzeria','mcdonald','burger king','kfc','subway','starbucks','cafe','kantine','mensa','lieferando','wolt','uber eats','doener','imbiss','vapiano','nordsee','backwerk','dean & david','five guys','eisdiele','biergarten'] },
  { kat:'mobilitaet',  worte:['tankstelle','aral','shell','esso','total energies','totalenergies','agip','star tank','bft','adac','db vertrieb','deutsche bahn','bahn.de','bvg','hvv','mvg','rmv','vrr','vrs','kvb','vbb','deutschlandticket','flixbus','uber','freenow','sixt','europcar','carsharing','share now','parkhaus','parkgebuehr','easypark','tuev','dekra','werkstatt','autohaus','kfz-steuer','kfz steuer','reifen','ionity','supercharger'] },
  { kat:'reisen',      worte:['booking.com','airbnb','hotel','hostel','lufthansa','eurowings','ryanair','easyjet','condor','tui ','expedia','opodo','ferienwohnung','camping','reisebuero','trivago','skyscanner','omio'] },
  { kat:'versicherung',worte:['versicherung','allianz','axa','huk','ergo ','debeka','signal iduna','gothaer','wuerttembergische','provinzial','lvm','barmenia','hansemerkur','haftpflicht','hausrat','rechtsschutz','berufsunfaehig','risikoleben'] },
  { kat:'gesundheit',  worte:['apotheke','arzt','praxis','zahnarzt','klinik','krankenhaus','physiotherapie','krankenkasse','aok','barmer','techniker krankenkasse','dak','ikk','kkh','hkk','optiker','fielmann','apollo optik','heilpraktiker','doc morris','shop apotheke'] },
  { kat:'freizeit',    worte:['fitness','mcfit','fitx','clever fit','urban sports','sportverein','schwimmbad','therme','kino','cinemaxx','cineplex','theater','museum','konzert','eventim','ticketmaster','freizeitpark','bowling','kletterhalle','sportverein'] },
  { kat:'shopping',    worte:['amazon','zalando','otto ','about you','h&m','hennes','c&a','zara','primark','tk maxx','tchibo','ikea','xxxlutz','hoeffner','obi ','bauhaus','hornbach','toom','media markt','saturn','mediamarkt','conrad','thalia','hugendubel','douglas','dm-drogerie','dm drogerie','rossmann','decathlon','intersport','ebay','etsy','shein','temu','asos','galeria','woolworth','paypal'] },
  { kat:'bildung',     worte:['udemy','coursera','volkshochschule','universitaet','hochschule','studienbeitrag','semesterbeitrag','sprachschule','babbel','duolingo','fahrschule','nachhilfe'] },
  { kat:'kinder',      worte:['kita','kindergarten','schulgeld','kindergeld','unterhalt','jugendamt','spielzeug','babymarkt','windeln'] },
  { kat:'haustier',    worte:['tierarzt','fressnapf','zooplus','futterhaus','tierheim','hundesteuer','tierklinik'] },
  { kat:'spenden',     worte:['spende','unicef','greenpeace','brot fuer die welt','aerzte ohne grenzen','wwf','caritas','diakonie','kirchensteuer','foerderverein'] },
  { kat:'steuern',     worte:['finanzamt','steuer','zoll','kapitalertragsteuer','solidaritaetszuschlag'] },
  { kat:'gebuehren',   worte:['kontofuehrung','kontogebuehr','entgelt fuer','sollzinsen','ueberziehung','mahngebuehr','depotgebuehr','ordergebuehr','fremdwaehrungsentgelt','auslandseinsatzentgelt'] },
  { kat:'bargeld',     vz:-1, worte:['geldautomat','bargeldauszahlung','barauszahlung','cash group','atm '] },
  { kat:'sparen',      worte:['sparplan','tagesgeld','festgeld','depotuebertrag','wertpapierkauf','wertpapierabrechnung','trade republic','scalable capital','flatex','comdirect','consorsbank','justtrade','smartbroker','bausparen','riester','ruerup','vermoegenswirksame','coinbase','bitpanda','kraken.com','binance'] },
  { kat:'umbuchung',   worte:['umbuchung','uebertrag','eigenuebertrag','interne buchung','kreditkartenabrechnung','ausgleich kreditkarte'] }
];

/* ---------- Turnus ----------
 * `monate` trägt die Rechnung: Jahresbetrag = Betrag × 12 / monate. */
const TURNUS = [
  { id:'monatlich',    name:'monatlich',        monate:1,     kurz:'mtl.'  },
  { id:'quartal',      name:'vierteljährlich',  monate:3,     kurz:'vj.'   },
  { id:'halbjahr',     name:'halbjährlich',     monate:6,     kurz:'hj.'   },
  { id:'jaehrlich',    name:'jährlich',         monate:12,    kurz:'jhrl.' },
  { id:'woechentlich', name:'wöchentlich',      monate:12/52, kurz:'wtl.'  }
];
const TURNUS_MAP = Object.fromEntries(TURNUS.map((t) => [t.id, t]));
function turnusMonate(id){ return (TURNUS_MAP[id] || TURNUS_MAP.monatlich).monate; }
function turnusName(id){ return (TURNUS_MAP[id] || TURNUS_MAP.monatlich).name; }
function turnusKurz(id){ return (TURNUS_MAP[id] || TURNUS_MAP.monatlich).kurz; }

/* ---------- Kontoarten ----------
 * `schuld: true` heißt: der Saldo ist eine Verbindlichkeit und wird im Vermögen
 * abgezogen. Eingetragen wird dort die offene Summe als positive Zahl. */
const KONTOARTEN = [
  { id:'giro',        name:'Girokonto',        icon:'🏦', schuld:false },
  { id:'tagesgeld',   name:'Tages-/Festgeld',  icon:'🐖', schuld:false },
  { id:'bar',         name:'Bargeld',          icon:'💶', schuld:false },
  { id:'kreditkarte', name:'Kreditkarte',      icon:'💳', schuld:true  },
  { id:'kredit',      name:'Kredit/Darlehen',  icon:'📉', schuld:true  }
];
const KONTOART_MAP = Object.fromEntries(KONTOARTEN.map((k) => [k.id, k]));
function kontoart(id){ return KONTOART_MAP[id] || KONTOART_MAP.giro; }

/* ---------- Wertpapierarten ---------- */
const WP_ARTEN = [
  { id:'aktie',   name:'Aktie'     },
  { id:'etf',     name:'ETF'       },
  { id:'fonds',   name:'Fonds'     },
  { id:'anleihe', name:'Anleihe'   },
  { id:'krypto',  name:'Krypto'    },
  { id:'sonst',   name:'Sonstiges' }
];

/* Farbtöne für die Depot-Aufteilung – bewusst andere Reihe als die Kategorien,
 * damit ein Ring nicht aussieht wie eine Kategorienauswertung. */
const DEPOT_FARBEN = ['#3d7fa8','#4f9d8c','#c98a5e','#8a76c9','#c46bab','#d9a441','#5aab7d','#7e8894','#b06f6f','#6f9ac4'];

/* ---------- Formatierung ---------- */
const NF_EUR  = new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR', minimumFractionDigits:2 });
const NF_EUR0 = new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR', maximumFractionDigits:0 });

function eur(n, knapp){
  const z = Number(n) || 0;
  // Ab vierstelligen Beträgen sind die Cents auf dem Handy nur noch Ballast
  if (knapp && Math.abs(z) >= 1000) return NF_EUR0.format(z);
  return NF_EUR.format(z);
}
function eurVz(n, knapp){ const z = Number(n) || 0; return (z > 0 ? '+' : '') + eur(z, knapp); }
function zahl(n, stellen){
  const s = (stellen === undefined || stellen === null) ? 2 : stellen;
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits:s, maximumFractionDigits:s }).format(Number(n) || 0);
}
function proz(n){ const z = Number(n) || 0; return (z > 0 ? '+' : '') + zahl(z, 1) + ' %'; }

const MONATE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const MONATE_KURZ = ['Jan','Feb','Mrz','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

function heute(){ return isoTag(new Date()); }
function isoTag(d){
  // Ohne toISOString rechnen: das schöbe in unserer Zeitzone auf den Vortag
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function ausIso(s){ const t = String(s).split('-').map(Number); return new Date(t[0], (t[1]||1)-1, t[2]||1); }
function datumKurz(s){ const d = ausIso(s); return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.'; }
function datumLang(s){ const d = ausIso(s); return d.getDate() + '. ' + MONATE[d.getMonth()] + ' ' + d.getFullYear(); }
function tageBis(iso){ return Math.round((ausIso(iso) - ausIso(heute())) / 86400000); }
function tageAddieren(iso, tage){ const d = ausIso(iso); d.setDate(d.getDate() + tage); return isoTag(d); }
function monateAddieren(iso, monate){
  const d = ausIso(iso);
  const tag = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.round(monate));
  // Auf den 31. folgt im Februar der 28./29., nicht der 3. März
  d.setDate(Math.min(tag, new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()));
  return isoTag(d);
}
/* Wochen sauber addieren, ohne über monateAddieren zu gehen (12/52 rundet auf 0). */
function turnusWeiter(iso, turnusId){
  if (turnusId === 'woechentlich') return tageAddieren(iso, 7);
  return monateAddieren(iso, turnusMonate(turnusId));
}

/* Für den Stichwortvergleich: klein, ohne Umlaute, ohne doppelte Leerzeichen. */
function normal(s){
  return String(s || '').toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/\s+/g,' ').trim();
}

/* Zufalls-ID. crypto.randomUUID fehlt in älteren iOS-Safari-Versionen. */
function neueId(){
  if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
