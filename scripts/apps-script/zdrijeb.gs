/**
 * Ždrijeb i raspored za turnir — Google Apps Script.
 *
 * NE ide u build stranice. Zalijepi ga u sam Google Sheet:
 *   Extensions → Apps Script → zalijepi ovaj kod → Save.
 * Nakon prvog spremanja u Sheetu se pojavi izbornik „Turnir".
 *
 * Zašto ovdje, a ne na stranici: ždrijeb mora biti zapisan na jednom mjestu.
 * Kad bi ga generirala skripta u pregledniku, svaki posjetitelj i svaki
 * refresh dobili bi drugačiji raspored.
 *
 * Očekivani tabovi:
 *   Ekipe     — Grupa | Ekipa | Igrač 1..4 | Vratar | Kotizacija
 *   Utakmice  — Redni | Faza | Grupa | Vrijeme | Domaćin | Gost | Golovi D | Golovi G
 *
 * Postupak na dan turnira:
 *   1. Upiši prijavljene ekipe u tab „Ekipe" (stupac Grupa ostavi prazan).
 *   2. Turnir → Ždrijeb i raspored.
 *   3. Tijekom večeri upisuj samo rezultate u „Golovi D" i „Golovi G".
 *      Eliminacijske parove stranica popunjava sama.
 */

// ─────────────────────────────────────────────────────────────────────
// Postavke
// ─────────────────────────────────────────────────────────────────────

/** Kad počinje prvi meč (0-23 h, minute). */
var POCETAK_H = 19;
var POCETAK_MIN = 0;

/** Koliko minuta traje jedan meč, uključujući izmjenu ekipa. */
var TRAJANJE_MIN = 8;

/** Koliko ekipa iz svake grupe ide dalje. */
var PROLAZI = 2;

var TAB_EKIPE = "Ekipe";
var TAB_UTAKMICE = "Utakmice";

// ─────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Turnir")
    .addItem("Ždrijeb i raspored", "zdrijebIRaspored")
    .addItem("Obriši raspored (zadrži ekipe)", "obrisiRaspored")
    .addToUi();
}

/**
 * Koliko grupa za zadani broj ekipa.
 *
 * Cilj je 3-5 ekipa po grupi i broj grupa koji daje čist bracket:
 * 2 grupe → 4 u polufinalu, 4 grupe → 8 u četvrtfinalu. Stranica zna
 * automatski složiti parove samo za ta dva slučaja.
 */
function brojGrupa(n) {
  if (n < 4) return 1;
  if (n <= 10) return 2;
  return 4;
}

/** Fisher-Yates — nepristran ždrijeb. */
function promijesaj(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** Round-robin parovi unutar grupe: svako sa svakim jednom. */
function parovi(tim) {
  var out = [];
  for (var i = 0; i < tim.length; i++) {
    for (var j = i + 1; j < tim.length; j++) out.push([tim[i], tim[j]]);
  }
  return out;
}

/**
 * Poredaj mečeve grupe tako da ista ekipa ne igra dva puta zaredom
 * kad god je to moguće — inače netko puca tri meča bez predaha.
 */
function rasporediBezUzastopnih(mecevi) {
  var preostali = mecevi.slice();
  var out = [];
  var zadnji = null;
  while (preostali.length) {
    var idx = 0;
    if (zadnji) {
      for (var i = 0; i < preostali.length; i++) {
        var m = preostali[i];
        if (m[0] !== zadnji[0] && m[0] !== zadnji[1] && m[1] !== zadnji[0] && m[1] !== zadnji[1]) {
          idx = i;
          break;
        }
      }
    }
    var pick = preostali.splice(idx, 1)[0];
    out.push(pick);
    zadnji = pick;
  }
  return out;
}

function vrijemeZa(index) {
  var min = POCETAK_H * 60 + POCETAK_MIN + index * TRAJANJE_MIN;
  var h = Math.floor(min / 60) % 24;
  var m = min % 60;
  return ("0" + h).slice(-2) + ":" + ("0" + m).slice(-2);
}

function zdrijebIRaspored() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var shE = ss.getSheetByName(TAB_EKIPE);
  var shU = ss.getSheetByName(TAB_UTAKMICE);

  if (!shE || !shU) {
    ui.alert('Nedostaje tab "' + TAB_EKIPE + '" ili "' + TAB_UTAKMICE + '".');
    return;
  }

  // Imena ekipa iz stupca B, bez praznih redaka
  var zadnji = shE.getLastRow();
  var imena = [];
  if (zadnji > 1) {
    var vals = shE.getRange(2, 2, zadnji - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i][0] || "").trim();
      if (v) imena.push(v);
    }
  }

  if (imena.length < 4) {
    ui.alert("Treba barem 4 prijavljene ekipe, a upisano ih je " + imena.length + ".");
    return;
  }

  var postojeciRezultati = shU.getLastRow() > 1;
  if (postojeciRezultati) {
    var odg = ui.alert(
      "Raspored već postoji",
      "Tab " + TAB_UTAKMICE + " nije prazan. Ždrijeb će ga prebrisati zajedno s upisanim rezultatima. Nastaviti?",
      ui.ButtonSet.YES_NO
    );
    if (odg !== ui.Button.YES) return;
  }

  // ── Ždrijeb ──────────────────────────────────────────────────────
  var n = brojGrupa(imena.length);
  var slova = ["A", "B", "C", "D"].slice(0, n);
  var mijesano = promijesaj(imena);
  var grupe = {};
  slova.forEach(function (g) {
    grupe[g] = [];
  });
  // Serpentina: ekipe se redom dijele po grupama, pa su grupe ravnomjerne.
  mijesano.forEach(function (ime, i) {
    grupe[slova[i % n]].push(ime);
  });

  // Upiši grupu uz svaku ekipu (stupac A), po imenu
  var grupaZa = {};
  slova.forEach(function (g) {
    grupe[g].forEach(function (ime) {
      grupaZa[ime] = g;
    });
  });
  var colA = [];
  var imenaCol = shE.getRange(2, 2, zadnji - 1, 1).getValues();
  for (var r = 0; r < imenaCol.length; r++) {
    var ime = String(imenaCol[r][0] || "").trim();
    colA.push([ime ? grupaZa[ime] || "" : ""]);
  }
  shE.getRange(2, 1, colA.length, 1).setValues(colA);

  // ── Grupni mečevi ────────────────────────────────────────────────
  // Rotiramo grupe da se ne odigra cijela grupa A pa tek onda B.
  var poGrupi = {};
  slova.forEach(function (g) {
    poGrupi[g] = rasporediBezUzastopnih(parovi(grupe[g]));
  });
  var redovi = [];
  var maxLen = 0;
  slova.forEach(function (g) {
    maxLen = Math.max(maxLen, poGrupi[g].length);
  });
  for (var k = 0; k < maxLen; k++) {
    slova.forEach(function (g) {
      var m = poGrupi[g][k];
      if (!m) return;
      var idx = redovi.length;
      redovi.push([idx + 1, "Grupa", g, vrijemeZa(idx), m[0], m[1], "", ""]);
    });
  }

  // ── Eliminacija ──────────────────────────────────────────────────
  // Ekipe ostaju prazne; stranica ih popunjava kad grupe završe.
  var koFaze = n === 4
    ? ["Četvrtfinale", "Četvrtfinale", "Četvrtfinale", "Četvrtfinale", "Polufinale", "Polufinale", "Za 3. mjesto", "Finale"]
    : n === 2
      ? ["Polufinale", "Polufinale", "Za 3. mjesto", "Finale"]
      : [];
  koFaze.forEach(function (faza) {
    var idx = redovi.length;
    redovi.push([idx + 1, faza, "", vrijemeZa(idx), "", "", "", ""]);
  });

  // ── Zapis ────────────────────────────────────────────────────────
  if (shU.getLastRow() > 1) {
    shU.getRange(2, 1, shU.getLastRow() - 1, 8).clearContent();
  }
  shU.getRange(2, 1, redovi.length, 8).setValues(redovi);

  var opis = slova
    .map(function (g) {
      return "Grupa " + g + ": " + grupe[g].length;
    })
    .join(" · ");
  ui.alert(
    "Ždrijeb gotov",
    imena.length + " ekipa u " + n + " " + (n === 1 ? "grupu" : "grupe") + ".\n" +
      opis + "\n\n" +
      redovi.length + " mečeva, prvi u " + vrijemeZa(0) + ".\n\n" +
      "Prolaze prve " + PROLAZI + " iz svake grupe. Eliminacijske parove stranica slaže sama.",
    ui.ButtonSet.OK
  );
}

/** Obriše raspored i grupe, ostavlja prijavljene ekipe i sastave. */
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
  if (shU && shU.getLastRow() > 1) shU.getRange(2, 1, shU.getLastRow() - 1, 8).clearContent();

  var shE = ss.getSheetByName(TAB_EKIPE);
  if (shE && shE.getLastRow() > 1) shE.getRange(2, 1, shE.getLastRow() - 1, 1).clearContent();

  ui.alert("Raspored obrisan.");
}
