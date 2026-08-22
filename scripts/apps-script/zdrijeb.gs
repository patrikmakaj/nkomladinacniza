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

/** Trajanje jednog meča u minutama, uključujući izmjenu ekipa. */
var TRAJANJE_MIN = 8;

/** Koliko se mečeva igra istovremeno (broj golova). */
var TERENA = 2;

/** Koliko ekipa iz svake grupe prolazi dalje. */
var PROLAZI = 2;

var TAB_EKIPE = "Ekipe";
var TAB_UTAKMICE = "Utakmice";

var ZAGLAVLJE_EKIPE = ["Grupa", "Ekipa", "Igrač 1", "Igrač 2", "Igrač 3", "Igrač 4", "Vratar", "Kotizacija"];
var ZAGLAVLJE_UTAKMICE = ["Redni", "Faza", "Grupa", "Vrijeme", "Teren", "Domaćin", "Gost", "Golovi D", "Golovi G"];

var PLAVA = "#10275c";

// ─────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Turnir")
    .addItem("Postavi tablicu", "postaviTablicu")
    .addSeparator()
    .addItem("Ždrijeb i raspored", "zdrijebIRaspored")
    .addItem("Obriši raspored (zadrži ekipe)", "obrisiRaspored")
    .addToUi();
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
  shU.getRange("A2:E").setHorizontalAlignment("center");
  // Rezultat kao tekst bi razbio stranicu — drži ga brojčanim.
  shU.getRange("H2:I").setNumberFormat("0").setHorizontalAlignment("center");

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
function brojGrupa(n) {
  if (n < 4) return 1;
  // Ispod 12 ekipa 4 grupe bi dale grupu od dvije ekipe — jedan meč i obje
  // dalje. Radije dvije veće grupe, pa svaka ekipa odigra više mečeva.
  if (n < 12) return 2;
  return 4;
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
  var n = brojGrupa(imena.length);
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
  var koFaze =
    n === 4
      ? [["Četvrtfinale", 1], ["Četvrtfinale", 2], ["Četvrtfinale", 1], ["Četvrtfinale", 2], ["Polufinale", 1], ["Polufinale", 2], ["Za 3. mjesto", 1], ["Finale", 1]]
      : n === 2
        ? [["Polufinale", 1], ["Polufinale", 2], ["Za 3. mjesto", 1], ["Finale", 1]]
        : [];

  // Pauza od jednog termina između grupa i eliminacije.
  var slot = zadnjiSlot + 2;
  var zadnjaFaza = null;
  koFaze.forEach(function (f) {
    if (zadnjaFaza && f[0] !== zadnjaFaza) slot++; // nova faza → novi termin
    zadnjaFaza = f[0];
    redovi.push([redovi.length + 1, f[0], "", vrijemeZa(slot), f[1], "", "", "", ""]);
  });

  // ── Zapis ────────────────────────────────────────────────────────
  if (shU.getLastRow() > 1) shU.getRange(2, 1, shU.getLastRow() - 1, 9).clearContent();
  shU.getRange(2, 1, redovi.length, 9).setValues(redovi);

  var opis = slova.map(function (g) { return "Grupa " + g + ": " + grupe[g].length; }).join(" · ");
  ui.alert(
    "Ždrijeb gotov",
    imena.length + " ekipa u " + n + " " + (n === 1 ? "grupu" : n < 5 ? "grupe" : "grupa") + ".\n" +
      opis + "\n\n" +
      poredani.length + " grupnih mečeva na " + TERENA + " gola, prvi u " + vrijemeZa(0) + ".\n" +
      "Ukupno " + redovi.length + " redaka s eliminacijom.\n\n" +
      "Prolaze prve " + PROLAZI + " iz svake grupe. Eliminacijske parove stranica slaže sama —\n" +
      "ti upisuješ samo rezultate.",
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
  if (shU && shU.getLastRow() > 1) shU.getRange(2, 1, shU.getLastRow() - 1, 9).clearContent();

  var shE = ss.getSheetByName(TAB_EKIPE);
  if (shE && shE.getLastRow() > 1) shE.getRange(2, 1, shE.getLastRow() - 1, 1).clearContent();

  ui.alert("Raspored obrisan.");
}
