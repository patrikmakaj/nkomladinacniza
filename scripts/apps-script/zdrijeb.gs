/**
 * Turnir u pucanju jedanaesteraca — Google Apps Script.
 *
 * NE ide u build stranice. Zalijepi ga u sam Google Sheet:
 *   Extensions → Apps Script → obriši sve → zalijepi ovo → Save (💾).
 * Zatim osvježi Sheet; u izborniku se pojavi „Turnir".
 *
 * Redoslijed na dan turnira:
 *   1. Turnir → Postavi tablicu           (samo prvi put — napravi tabove)
 *   2. Upiši prijavljene ekipe u tab „Ekipe" (stupac Grupa ostavi prazan)
 *   3. Turnir → Ždrijeb i raspored        (u 18:30, kad se zatvore prijave)
 *   4. Tijekom večeri upisuj samo „Golovi D" i „Golovi G"
 *
 * Eliminacijske parove stranica popunjava sama čim grupe završe — u tab se
 * ne upisuje ništa osim rezultata.
 *
 * Zašto ždrijeb radi ovdje, a ne na stranici: ždrijeb mora biti zapisan na
 * jednom mjestu. Da ga generira skripta u pregledniku, svaki posjetitelj i
 * svaki refresh dobili bi drugačiji raspored.
 */

// ─────────────────────────────────────────────────────────────────────
// Postavke — po potrebi promijeni ovdje
// ─────────────────────────────────────────────────────────────────────

/** Početak prvog meča. */
var POCETAK_H = 19;
var POCETAK_MIN = 0;

/**
 * Početna procjena trajanja meča u minutama, uključujući izmjenu ekipa.
 * Koristi se dok se ne skupi dovoljno stvarnih mjerenja.
 */
var TRAJANJE_MIN = 15;

/**
 * Nakon ovoliko izmjerenih mečeva satnica se računa po stvarnom prosjeku
 * umjesto po procjeni gore. Ispod toga je uzorak premalen da mu se vjeruje.
 */
var MIN_UZORAKA = 3;

/** Sigurnosne granice za izmjereni prosjek — jedna duga pauza ne smije razbiti satnicu. */
var TRAJANJE_MIN_DONJA = 5;
var TRAJANJE_MIN_GORNJA = 40;

/** Pomiče li se satnica sama čim se upiše rezultat. */
var AUTO_POMAK = true;

/**
 * Vremenska zona turnira — namjerno fiksna, ne iz postavki tablice.
 * Sheet zna ostati na tuđoj zoni (Kijev je ljeti sat ispred Zagreba), a onda
 * bi svako zabilježeno vrijeme završetka bilo pomaknuto i satnica bi skočila
 * čim se upiše prvi rezultat.
 */
var ZONA = "Europe/Zagreb";

/** Koliko se mečeva igra istovremeno (broj golova). */
var TERENA = 2;

var TAB_EKIPE = "Ekipe";
var TAB_UTAKMICE = "Utakmice";

var ZAGLAVLJE_EKIPE = ["Grupa", "Ekipa", "Igrač 1", "Igrač 2", "Igrač 3", "Igrač 4", "Vratar", "Kotizacija"];
var ZAGLAVLJE_UTAKMICE = ["Redni", "Faza", "Grupa", "Vrijeme", "Teren", "Domaćin", "Gost", "Golovi D", "Golovi G", "Završeno"];

/** Redoslijed faza — kasnija faza ne može početi prije nego ranija završi. */
var FAZE_REDOM = { "Grupa": 0, "Četvrtfinale": 1, "Polufinale": 2, "Za 3. mjesto": 3, "Finale": 3 };

var PLAVA = "#10275c";

// ─────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Turnir")
    .addItem("Postavi tablicu", "postaviTablicu")
    .addSeparator()
    .addItem("Ždrijeb i raspored", "zdrijebIRaspored")
    .addItem("Pomakni satnicu", "pomakniRasporedRucno")
    .addSeparator()
    .addItem("Obriši raspored (zadrži ekipe)", "obrisiRaspored")
    .addToUi();
}

/**
 * Upozorenje kad se upiše neriješen rezultat.
 *
 * Turnir nema neriješenih — kod izjednačenja ide raspucavanje, pa se upisuje
 * konačan ishod. Jednak rezultat s obje strane stranica ne zna razriješiti:
 * ekipa ne bi dobila pobjedu, a eliminacijski par bi ostao prazan. Zato ga
 * odmah označimo crveno umjesto da se to otkrije tek pred finale.
 *
 * Ovo je jednostavan okidač — radi sam, bez posebnog odobravanja.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== TAB_UTAKMICE) return;

  var col = e.range.getColumn();
  if (col < 8 || col > 9) return; // samo Golovi D / Golovi G

  var red = e.range.getRow();
  if (red < 2) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var par = sh.getRange(red, 8, 1, 2);
  var v = par.getValues()[0];
  var oba = v[0] !== "" && v[1] !== "";
  var izjednaceno = oba && Number(v[0]) === Number(v[1]);

  par.setBackground(izjednaceno ? "#fde2e2" : null);
  if (izjednaceno) {
    ss.toast("Nema neriješenih — upiši ishod raspucavanja.", "Redak " + red, 5);
  }

  // Stvarno vrijeme završetka — sidro za satnicu. Piše se samo prvi put, da
  // ispravak rezultata ne pomakne trenutak koji se već dogodio. Ako se
  // rezultat obriše, briše se i vrijeme.
  var celija = sh.getRange(red, 10);
  if (!oba) {
    celija.clearContent();
  } else if (!celija.getValue()) {
    celija.setValue(Utilities.formatDate(new Date(), ZONA, "HH:mm"));
  }

  if (AUTO_POMAK) pomakniRaspored(true);
}

// ─────────────────────────────────────────────────────────────────────
// Pomicanje satnice
// ─────────────────────────────────────────────────────────────────────

/** "19:05" → 1145 (minute od ponoći). Vrijeme poslije ponoći ide na kraj dana. */
function uMinute(v) {
  var m = String(v == null ? "" : v).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  var min = Number(m[1]) * 60 + Number(m[2]);
  return min < 12 * 60 ? min + 24 * 60 : min;
}

/** 1145 → "19:05" */
function izMinuta(min) {
  var h = Math.floor(min / 60) % 24;
  return ("0" + h).slice(-2) + ":" + ("0" + (min % 60)).slice(-2);
}

/**
 * Koliko računati po meču.
 *
 * Dok nema dovoljno mjerenja koristi se procjena (TRAJANJE_MIN). Kad se
 * skupi barem MIN_UZORAKA, računa se stvarni prosjek — razmak između dva
 * uzastopna završetka na istom terenu, jer to je stvarni ciklus meča
 * uključujući izmjenu ekipa. Prvi meč na terenu se ne mjeri jer ne znamo
 * je li turnir uopće krenuo na vrijeme.
 */
function izmjerenoTrajanje(redovi) {
  var poTerenu = {};
  redovi.forEach(function (r) {
    if (!r.zavrsenoMin) return;
    (poTerenu[r.teren] || (poTerenu[r.teren] = [])).push(r);
  });

  var uzorci = [];
  for (var t in poTerenu) {
    var niz = poTerenu[t].sort(function (a, b) { return a.zavrsenoMin - b.zavrsenoMin; });
    for (var i = 1; i < niz.length; i++) {
      var d = niz[i].zavrsenoMin - niz[i - 1].zavrsenoMin;
      if (d >= TRAJANJE_MIN_DONJA && d <= TRAJANJE_MIN_GORNJA) uzorci.push(d);
    }
  }
  if (uzorci.length < MIN_UZORAKA) return { min: TRAJANJE_MIN, uzoraka: uzorci.length, izmjereno: false };

  var zbroj = uzorci.reduce(function (s, x) { return s + x; }, 0);
  return { min: Math.round(zbroj / uzorci.length), uzoraka: uzorci.length, izmjereno: true };
}

/**
 * Preračuna vremena početka SVIH neodigranih utakmica prema stvarnosti.
 *
 * Svaki teren ima svoj red — kašnjenje na terenu 1 ne pomiče teren 2. Kasnija
 * faza ne može početi prije nego ranija završi, inače bi polufinale dobilo
 * termin usred grupnih mečeva.
 *
 * Odigrane utakmice se ne diraju; one su povijest i služe kao sidro.
 */
function pomakniRaspored(tiho) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_UTAKMICE);
  if (!sh || sh.getLastRow() < 2) return null;

  var n = sh.getLastRow() - 1;
  var vals = sh.getRange(2, 1, n, 10).getValues();

  var redovi = vals.map(function (v, i) {
    return {
      row: i + 2,
      redni: Number(v[0]) || i + 1,
      faza: String(v[1] || "").trim(),
      vrijemeMin: uMinute(v[3]),
      teren: String(v[4] || "1").trim(),
      odigrano: v[7] !== "" && v[8] !== "",
      zavrsenoMin: uMinute(v[9]),
    };
  }).filter(function (r) { return r.faza; });

  if (!redovi.length) return null;

  var trajanje = izmjerenoTrajanje(redovi);

  var rang = function (r) {
    var x = FAZE_REDOM[r.faza];
    return x == null ? 99 : x;
  };
  var redom = redovi.slice().sort(function (a, b) {
    if (rang(a) !== rang(b)) return rang(a) - rang(b);
    if ((a.vrijemeMin || 0) !== (b.vrijemeMin || 0)) return (a.vrijemeMin || 0) - (b.vrijemeMin || 0);
    return a.redni - b.redni;
  });

  var terenSlobodan = {}; // teren → kad se oslobodi
  var fazaGotova = {};    // rang faze → kad zadnji meč te faze završi
  var promjene = [];

  redom.forEach(function (r) {
    var rr = rang(r);

    if (r.odigrano) {
      // Sidro: stvarni završetak ako ga imamo, inače procjena iz planiranog.
      var kraj = r.zavrsenoMin != null ? r.zavrsenoMin : (r.vrijemeMin || 0) + trajanje.min;
      terenSlobodan[r.teren] = Math.max(terenSlobodan[r.teren] || 0, kraj);
      fazaGotova[rr] = Math.max(fazaGotova[rr] || 0, kraj);
      return;
    }

    // Ranije faze moraju biti gotove.
    var najranije = 0;
    for (var k in fazaGotova) if (Number(k) < rr) najranije = Math.max(najranije, fazaGotova[k]);

    // Ako se na ovom terenu još ništa nije odigralo, nemamo dokaza o kašnjenju
    // pa se držimo planiranog vremena.
    var slobodan = terenSlobodan[r.teren];
    var pocetak = slobodan != null
      ? Math.max(slobodan, najranije)
      : Math.max(r.vrijemeMin || 0, najranije);

    if (r.vrijemeMin !== pocetak) promjene.push({ row: r.row, vrijeme: izMinuta(pocetak) });

    terenSlobodan[r.teren] = pocetak + trajanje.min;
    fazaGotova[rr] = Math.max(fazaGotova[rr] || 0, pocetak + trajanje.min);
  });

  promjene.forEach(function (p) { sh.getRange(p.row, 4).setValue(p.vrijeme); });

  if (!tiho) {
    SpreadsheetApp.getUi().alert(
      "Satnica osvježena",
      promjene.length + " " + (promjene.length === 1 ? "utakmica pomaknuta" : "utakmica pomaknuto") + ".\n\n" +
        (trajanje.izmjereno
          ? "Računato po izmjerenom prosjeku: " + trajanje.min + " min (" + trajanje.uzoraka + " mjerenja)."
          : "Računato po procjeni: " + trajanje.min + " min (mjerenja: " + trajanje.uzoraka + "/" + MIN_UZORAKA + ")."),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } else if (promjene.length) {
    ss.toast(promjene.length + " utakmica pomaknuto · " + trajanje.min + " min po meču", "Satnica", 4);
  }
  return promjene.length;
}

/** Isti posao iz izbornika, s porukom koliko je pomaknuto. */
function pomakniRasporedRucno() {
  var n = pomakniRaspored(false);
  if (n === null) SpreadsheetApp.getUi().alert("Nema rasporeda — prvo pokreni Ždrijeb i raspored.");
}

/** Napravi oba taba sa zaglavljima i formatiranjem. Sigurno je pokrenuti više puta. */
function postaviTablicu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var shE = pripremiTab(ss, TAB_EKIPE, ZAGLAVLJE_EKIPE);
  shE.setColumnWidth(1, 60);   // Grupa
  shE.setColumnWidth(2, 190);  // Ekipa
  for (var c = 3; c <= 7; c++) shE.setColumnWidth(c, 150);
  shE.setColumnWidth(8, 95);   // Kotizacija
  shE.getRange("A2:A").setHorizontalAlignment("center");
  shE.getRange("H2:H").setNumberFormat("0 €");

  var shU = pripremiTab(ss, TAB_UTAKMICE, ZAGLAVLJE_UTAKMICE);
  shU.setColumnWidth(1, 55);   // Redni
  shU.setColumnWidth(2, 110);  // Faza
  shU.setColumnWidth(3, 60);   // Grupa
  shU.setColumnWidth(4, 75);   // Vrijeme
  shU.setColumnWidth(5, 60);   // Teren
  shU.setColumnWidth(6, 190);  // Domaćin
  shU.setColumnWidth(7, 190);  // Gost
  shU.setColumnWidth(8, 85);
  shU.setColumnWidth(9, 85);
  shU.setColumnWidth(10, 90); // Završeno
  shU.getRange("A2:E").setHorizontalAlignment("center");
  shU.getRange("J2:J").setHorizontalAlignment("center").setFontColor("#64748B");
  shU.getRange("J1").setNote(
    "Popunjava se samo — trenutak kad je upisan rezultat.\n" +
      "Prema tome se pomiču vremena preostalih utakmica. Ne diraj ručno."
  );
  // Rezultat kao tekst bi razbio stranicu — drži ga brojčanim.
  shU.getRange("H2:I").setNumberFormat("0").setHorizontalAlignment("center");

  // Nema neriješenih, pa se upisuje konačan ishod uključujući raspucavanje.
  var napomena =
    "Serija od 5 jedanaesteraca.\n" +
    "Ako je izjednačeno, ide raspucavanje — upiši KONAČAN ishod, uključujući raspucavanje.\n" +
    "Jednak rezultat s obje strane stranica ne zna razriješiti.";
  shU.getRange("H1:I1").setNote(napomena);

  // Makni početni prazni „Sheet1" ako je ostao neiskorišten.
  var prvi = ss.getSheetByName("Sheet1") || ss.getSheetByName("List1");
  if (prvi && ss.getSheets().length > 2 && prvi.getLastRow() === 0) ss.deleteSheet(prvi);

  ss.setActiveSheet(shE);
  SpreadsheetApp.getUi().alert(
    "Tablica je spremna",
    'Napravljeni su tabovi "' + TAB_EKIPE + '" i "' + TAB_UTAKMICE + '".\n\n' +
      "Upiši prijavljene ekipe u tab Ekipe (stupac Grupa ostavi prazan), pa pokreni\n" +
      "Turnir → Ždrijeb i raspored.\n\n" +
      'Ne zaboravi dijeljenje: Share → General access → "Anyone with the link" → Viewer.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function pripremiTab(ss, ime, zaglavlje) {
  var sh = ss.getSheetByName(ime);
  if (!sh) sh = ss.insertSheet(ime);
  sh.getRange(1, 1, 1, zaglavlje.length)
    .setValues([zaglavlje])
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground(PLAVA)
    .setHorizontalAlignment("center");
  sh.setFrozenRows(1);
  return sh;
}

// ─────────────────────────────────────────────────────────────────────
// Ždrijeb
// ─────────────────────────────────────────────────────────────────────

/**
 * Broj grupa prema broju ekipa.
 *
 * Stranica zna sama složiti eliminacijske parove samo za 2 grupe (odmah
 * polufinale) i 4 grupe (četvrtfinale), pa se držimo toga.
 */
/**
 * Format prema broju prijavljenih ekipa.
 *
 * Cilj je 30-40 utakmica ukupno na dva terena — ispod toga je večer prekratka
 * za 20 € kotizacije, iznad toga se igra iza 22:30. Brojke po varijanti:
 *
 *    8 ekipa  1 grupa                30 utakmica   kraj ~21:30
 *    9 ekipa  1 grupa                38            ~22:10
 *   10 ekipa  2 grupe, prolaze 4     28            ~21:20
 *   11 ekipa  2 grupe, prolaze 4     33            ~21:50
 *   12 ekipa  2 grupe, prolaze 2     34            ~21:50
 *   13 ekipa  2 grupe, prolaze 2     40            ~22:20
 *   14+       4 grupe, prolaze 2     26 i naviše   ~21:10
 *
 * Vraća { grupa: broj grupa, prolazi: koliko ih iz svake ide dalje }.
 */
function format(n) {
  // Do 9 ekipa jedna skupina — svi sa svima. Dijeljenje u grupe ovdje daje
  // premalo mečeva po ekipi (8 ekipa u dvije grupe = samo 16 utakmica).
  if (n < 10) return { grupa: 1, prolazi: 4 };
  // 10 i 11: dvije grupe bi s prolaskom dvije dale samo 24 odnosno 29 utakmica,
  // pa prolaze prve četiri i ide se na četvrtfinale.
  if (n < 12) return { grupa: 2, prolazi: 4 };
  // 12 i 13: grupe su već dovoljno velike, prolaze prve dvije.
  if (n < 14) return { grupa: 2, prolazi: 2 };
  // 14+: dvije grupe bi značile 46 utakmica i kraj iza 23:00.
  return { grupa: 4, prolazi: 2 };
}

/** Fisher-Yates — nepristran ždrijeb. */
function promijesaj(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/** Svako sa svakim, jednom. */
function parovi(tim) {
  var out = [];
  for (var i = 0; i < tim.length; i++) {
    for (var j = i + 1; j < tim.length; j++) out.push({ home: tim[i], away: tim[j] });
  }
  return out;
}

function vrijemeZa(slot) {
  var min = POCETAK_H * 60 + POCETAK_MIN + slot * TRAJANJE_MIN;
  var h = Math.floor(min / 60) % 24;
  var m = min % 60;
  return ("0" + h).slice(-2) + ":" + ("0" + m).slice(-2);
}

/**
 * Posloži mečeve u termine, po TERENA komada istovremeno.
 *
 * Dva pravila: ista ekipa ne smije igrati dva meča u istom terminu (ne može
 * biti na oba gola), i po mogućnosti ne dva termina zaredom — inače netko
 * puca tri meča bez predaha dok drugi čekaju.
 */
function rasporedi(mecevi) {
  var preostali = mecevi.slice();
  var out = [];
  var slot = 0;
  var prosli = {};

  while (preostali.length) {
    var uSlotu = {};
    var stavljeno = 0;

    for (var teren = 1; teren <= TERENA && preostali.length; teren++) {
      var idx = -1;
      // Prvi izbor: nitko od dvojice nije igrao prošli termin ni u ovom.
      for (var i = 0; i < preostali.length; i++) {
        var m = preostali[i];
        if (uSlotu[m.home] || uSlotu[m.away]) continue;
        if (prosli[m.home] || prosli[m.away]) continue;
        idx = i; break;
      }
      // Ako takvog nema, dovoljno je da nisu već u ovom terminu.
      if (idx === -1) {
        for (var k = 0; k < preostali.length; k++) {
          var mm = preostali[k];
          if (uSlotu[mm.home] || uSlotu[mm.away]) continue;
          idx = k; break;
        }
      }
      if (idx === -1) break; // svi preostali sudaraju se s ovim terminom

      var pick = preostali.splice(idx, 1)[0];
      pick.slot = slot;
      pick.teren = teren;
      out.push(pick);
      uSlotu[pick.home] = true;
      uSlotu[pick.away] = true;
      stavljeno++;
    }

    if (!stavljeno) {
      // Nemoguće popuniti termin bez sudara — pomakni se dalje da se ne vrtimo.
      slot++;
      prosli = {};
      continue;
    }
    prosli = uSlotu;
    slot++;
  }
  return out;
}

function zdrijebIRaspored() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var shE = ss.getSheetByName(TAB_EKIPE);
  var shU = ss.getSheetByName(TAB_UTAKMICE);

  if (!shE || !shU) {
    ui.alert("Prvo pokreni Turnir → Postavi tablicu.");
    return;
  }

  var zadnji = shE.getLastRow();
  var imenaCol = zadnji > 1 ? shE.getRange(2, 2, zadnji - 1, 1).getValues() : [];
  var imena = [];
  for (var i = 0; i < imenaCol.length; i++) {
    var v = String(imenaCol[i][0] || "").trim();
    if (v) imena.push(v);
  }

  // Dvije ekipe s istim imenom srušile bi i tablicu i raspored.
  var vidjeno = {}, duplikati = [];
  imena.forEach(function (ime) {
    if (vidjeno[ime]) duplikati.push(ime);
    vidjeno[ime] = true;
  });
  if (duplikati.length) {
    ui.alert("Ista imena ekipa", "Ove ekipe se ponavljaju: " + duplikati.join(", ") + ".\nDaj im različita imena pa pokreni ponovo.", ui.ButtonSet.OK);
    return;
  }

  if (imena.length < 4) {
    ui.alert("Treba barem 4 prijavljene ekipe, a upisano ih je " + imena.length + ".");
    return;
  }

  if (shU.getLastRow() > 1) {
    var odg = ui.alert(
      "Raspored već postoji",
      "Tab " + TAB_UTAKMICE + " nije prazan. Ždrijeb briše sve utakmice i upisane rezultate. Nastaviti?",
      ui.ButtonSet.YES_NO
    );
    if (odg !== ui.Button.YES) return;
  }

  // ── Grupe ────────────────────────────────────────────────────────
  var f = format(imena.length);
  var n = f.grupa;
  var prolazi = f.prolazi;
  var slova = ["A", "B", "C", "D"].slice(0, n);
  var grupe = {};
  slova.forEach(function (g) { grupe[g] = []; });
  promijesaj(imena).forEach(function (ime, i) {
    grupe[slova[i % n]].push(ime); // serpentina → grupe ostaju ravnomjerne
  });

  var grupaZa = {};
  slova.forEach(function (g) {
    grupe[g].forEach(function (ime) { grupaZa[ime] = g; });
  });
  var colA = imenaCol.map(function (r) {
    var ime = String(r[0] || "").trim();
    return [ime ? grupaZa[ime] || "" : ""];
  });
  if (colA.length) shE.getRange(2, 1, colA.length, 1).setValues(colA);

  // ── Grupni mečevi ────────────────────────────────────────────────
  // Miješamo mečeve svih grupa pa raspoređujemo zajedno — tako se grupe
  // izmjenjuju umjesto da se cijela grupa A odigra prije grupe B.
  var svi = [];
  slova.forEach(function (g) {
    parovi(grupe[g]).forEach(function (m) {
      m.grupa = g;
      svi.push(m);
    });
  });
  var poredani = rasporedi(promijesaj(svi));

  var redovi = poredani.map(function (m, i) {
    return [i + 1, "Grupa", m.grupa, vrijemeZa(m.slot), m.teren, m.home, m.away, "", ""];
  });

  // ── Eliminacija ──────────────────────────────────────────────────
  // Ekipe ostaju prazne; stranica ih popunjava kad grupe završe.
  var zadnjiSlot = poredani.length ? poredani[poredani.length - 1].slot : 0;
  // Broj kvalificiranih (grupa × prolazi) određuje ide li se na četvrtfinale
  // ili odmah na polufinale. Stranica taj format iščita upravo iz ovih redaka.
  var kvalificiranih = n * prolazi;
  var koFaze =
    n === 1
      // Jedna skupina: tablica je već poredak, pa idu samo zadnja dva meča.
      ? [["Za 3. mjesto", 1], ["Finale", 1]]
      : kvalificiranih === 8
        ? [["Četvrtfinale", 1], ["Četvrtfinale", 2], ["Četvrtfinale", 1], ["Četvrtfinale", 2], ["Polufinale", 1], ["Polufinale", 2], ["Za 3. mjesto", 1], ["Finale", 1]]
        : [["Polufinale", 1], ["Polufinale", 2], ["Za 3. mjesto", 1], ["Finale", 1]];

  // Pauza od jednog termina između grupa i eliminacije.
  var slot = zadnjiSlot + 2;
  var zadnjaFaza = null;
  koFaze.forEach(function (f) {
    if (zadnjaFaza && f[0] !== zadnjaFaza) slot++; // nova faza → novi termin
    zadnjaFaza = f[0];
    redovi.push([redovi.length + 1, f[0], "", vrijemeZa(slot), f[1], "", "", "", ""]);
  });

  // ── Zapis ────────────────────────────────────────────────────────
  if (shU.getLastRow() > 1) shU.getRange(2, 1, shU.getLastRow() - 1, 10).clearContent();
  shU.getRange(2, 1, redovi.length, 9).setValues(redovi);

  var opis = slova.map(function (g) { return "Grupa " + g + ": " + grupe[g].length; }).join(" · ");
  ui.alert(
    "Ždrijeb gotov",
    imena.length + " ekipa u " + n + " " + (n === 1 ? "grupu" : n < 5 ? "grupe" : "grupa") + ".\n" +
      opis + "\n\n" +
      poredani.length + " grupnih mečeva na " + TERENA + " gola, prvi u " + vrijemeZa(0) + ".\n" +
      "Ukupno " + redovi.length + " redaka s eliminacijom.\n\n" +
      (n === 1
        ? "Prve dvije iz tablice idu u finale, treća i četvrta na meč za 3. mjesto."
        : "Prolaze prve " + prolazi + " iz svake grupe → " + kvalificiranih +
          (kvalificiranih === 8 ? " u četvrtfinalu." : " u polufinalu.")) +
      "\nParove stranica slaže sama — ti upisuješ samo rezultate.",
    ui.ButtonSet.OK
  );
}

/** Obriše raspored i oznake grupa; ekipe i sastavi ostaju. */
function obrisiRaspored() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var odg = ui.alert(
    "Obrisati raspored?",
    "Briše sve utakmice i rezultate te oznake grupa. Ekipe i sastavi ostaju.",
    ui.ButtonSet.YES_NO
  );
  if (odg !== ui.Button.YES) return;

  var shU = ss.getSheetByName(TAB_UTAKMICE);
  if (shU && shU.getLastRow() > 1) shU.getRange(2, 1, shU.getLastRow() - 1, 10).clearContent();

  var shE = ss.getSheetByName(TAB_EKIPE);
  if (shE && shE.getLastRow() > 1) shE.getRange(2, 1, shE.getLastRow() - 1, 1).clearContent();

  ui.alert("Raspored obrisan.");
}
