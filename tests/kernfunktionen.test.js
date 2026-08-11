/**
 * Tests für die reinen Kernfunktionen aus kernfunktionen.js (Issue #61).
 *
 * Anders als die Firestore-Regel-Tests in diesem Ordner läuft hier KEIN
 * Emulator mit - die Funktionen sind bewusst DOM-/Netzwerk-unabhängig
 * (kein document/window/fetch/localStorage), deshalb reicht Node's
 * eingebauter Testrunner direkt aus.
 *
 * Ausführen:
 *     node --test tests/kernfunktionen.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    EIGENER_KURZNAME_MAX,
    EIGENER_NAME_MAX,
    eigeneFilmIdErzeugen,
    pruefeListenNamen,
    cacheEintragGueltig,
    extractTmdbId
} = require('../kernfunktionen.js');

// ---------------------------------------------------------------------
// eigeneFilmIdErzeugen
// ---------------------------------------------------------------------

test('eigeneFilmIdErzeugen: einfacher Titel wird zu einem lesbaren Slug', () => {
    assert.equal(eigeneFilmIdErzeugen('Iron Man', 2008), 'iron-man-2008');
});

test('eigeneFilmIdErzeugen: Akzente werden entfernt statt behalten (NFKD)', () => {
    assert.equal(eigeneFilmIdErzeugen('Amélie', 2001), 'amelie-2001');
});

test('eigeneFilmIdErzeugen: Sonderzeichen werden zu einzelnen Bindestrichen zusammengefasst', () => {
    assert.equal(eigeneFilmIdErzeugen('Spider-Man: No Way Home!', 2021), 'spider-man-no-way-home-2021');
});

test('eigeneFilmIdErzeugen: führende/nachgestellte Bindestriche werden entfernt', () => {
    assert.equal(eigeneFilmIdErzeugen('¡Amélie!', 2001), 'amelie-2001');
});

test('eigeneFilmIdErzeugen: Großschreibung wird ignoriert', () => {
    assert.equal(eigeneFilmIdErzeugen('THE MATRIX', 1999), 'the-matrix-1999');
});

test('eigeneFilmIdErzeugen: identischer Titel liefert identische ID (Kernvoraussetzung für geteilte Bewertungen)', () => {
    assert.equal(eigeneFilmIdErzeugen('Iron Man', 2008), eigeneFilmIdErzeugen('Iron Man', 2008));
});

// ---------------------------------------------------------------------
// pruefeListenNamen
// ---------------------------------------------------------------------

test('pruefeListenNamen: gültige, ungenutzte Namen werden akzeptiert (null = kein Fehler)', () => {
    assert.equal(pruefeListenNamen('Favoriten', 'Meine Lieblingsfilme', new Set(), new Set()), null);
});

test('pruefeListenNamen: leerer Kurzname wird abgelehnt', () => {
    assert.match(pruefeListenNamen('', 'Meine Lieblingsfilme', new Set(), new Set()), /Kurz- und Langname/);
});

test('pruefeListenNamen: leerer Langname wird abgelehnt', () => {
    assert.match(pruefeListenNamen('Favoriten', '', new Set(), new Set()), /Kurz- und Langname/);
});

test(`pruefeListenNamen: Kurzname mit genau ${EIGENER_KURZNAME_MAX} Zeichen ist noch erlaubt`, () => {
    const kurzname = 'x'.repeat(EIGENER_KURZNAME_MAX);
    assert.equal(pruefeListenNamen(kurzname, 'Langname', new Set(), new Set()), null);
});

test(`pruefeListenNamen: Kurzname mit ${EIGENER_KURZNAME_MAX + 1} Zeichen wird abgelehnt`, () => {
    const kurzname = 'x'.repeat(EIGENER_KURZNAME_MAX + 1);
    assert.match(pruefeListenNamen(kurzname, 'Langname', new Set(), new Set()), /Kurzname/);
});

test(`pruefeListenNamen: Langname mit genau ${EIGENER_NAME_MAX} Zeichen ist noch erlaubt`, () => {
    const name = 'x'.repeat(EIGENER_NAME_MAX);
    assert.equal(pruefeListenNamen('Kurz', name, new Set(), new Set()), null);
});

test(`pruefeListenNamen: Langname mit ${EIGENER_NAME_MAX + 1} Zeichen wird abgelehnt`, () => {
    const name = 'x'.repeat(EIGENER_NAME_MAX + 1);
    assert.match(pruefeListenNamen('Kurz', name, new Set(), new Set()), /Langname/);
});

test('pruefeListenNamen: bereits genutzter Kurzname wird abgelehnt', () => {
    const kurznamen = new Set(['favoriten']);
    assert.match(pruefeListenNamen('Favoriten', 'Neuer Langname', kurznamen, new Set()), /gibt es schon/);
});

test('pruefeListenNamen: bereits genutzter Kurzname wird unabhängig von Groß-/Kleinschreibung erkannt', () => {
    const kurznamen = new Set(['favoriten']);
    assert.match(pruefeListenNamen('FAVORITEN', 'Neuer Langname', kurznamen, new Set()), /gibt es schon/);
});

test('pruefeListenNamen: bereits genutzter Langname wird abgelehnt', () => {
    const namen = new Set(['meine lieblingsfilme']);
    assert.match(pruefeListenNamen('Neu', 'Meine Lieblingsfilme', new Set(), namen), /gibt es schon/);
});

test('pruefeListenNamen: Namen einer ausgenommenen Liste (z. B. beim Umbenennen der eigenen Liste) tauchen in den Sets gar nicht erst auf', () => {
    // Der Aufrufer (eigeneListeNamenPruefen in app.js) filtert die
    // ausgenommene Liste bereits vor dem Aufruf heraus - hier wird nur
    // geprüft, dass ein Set OHNE den eigenen Namen keinen Fehler auslöst.
    assert.equal(pruefeListenNamen('Favoriten', 'Meine Lieblingsfilme', new Set(), new Set()), null);
});

// ---------------------------------------------------------------------
// cacheEintragGueltig
// ---------------------------------------------------------------------

const EINE_WOCHE_MS = 7 * 24 * 60 * 60 * 1000;

test('cacheEintragGueltig: fehlender Eintrag ist ungültig', () => {
    assert.equal(cacheEintragGueltig(undefined, 1000, EINE_WOCHE_MS), false);
});

test('cacheEintragGueltig: frischer Eintrag ohne erforderliche Felder ist gültig', () => {
    const eintrag = { cachedAt: 1000 };
    assert.equal(cacheEintragGueltig(eintrag, 1000 + 1000, EINE_WOCHE_MS), true);
});

test('cacheEintragGueltig: abgelaufener Eintrag ist ungültig', () => {
    const eintrag = { cachedAt: 0 };
    assert.equal(cacheEintragGueltig(eintrag, EINE_WOCHE_MS + 1, EINE_WOCHE_MS), false);
});

test('cacheEintragGueltig: Eintrag genau an der Gültigkeitsgrenze ist bereits ungültig (< statt <=)', () => {
    const eintrag = { cachedAt: 0 };
    assert.equal(cacheEintragGueltig(eintrag, EINE_WOCHE_MS, EINE_WOCHE_MS), false);
});

test('cacheEintragGueltig: frischer Eintrag mit allen erforderlichen Feldern ist gültig', () => {
    const eintrag = { cachedAt: 1000, altersfreigabe: 12, backdropPath: '/x.jpg' };
    assert.equal(cacheEintragGueltig(eintrag, 1000, EINE_WOCHE_MS, ['altersfreigabe', 'backdropPath']), true);
});

test('cacheEintragGueltig: frischer, aber unvollständiger Eintrag (fehlendes Feld) ist ungültig - älterer Cache-Eintrag von vor einem neuen Feld', () => {
    const eintrag = { cachedAt: 1000 }; // wie ein Eintrag von vor Issue #67/#69
    assert.equal(cacheEintragGueltig(eintrag, 1000, EINE_WOCHE_MS, ['altersfreigabe', 'backdropPath']), false);
});

test('cacheEintragGueltig: erforderliches Feld mit Wert null zählt trotzdem als vorhanden ("in"-Prüfung, kein Falsy-Check)', () => {
    const eintrag = { cachedAt: 1000, altersfreigabe: null };
    assert.equal(cacheEintragGueltig(eintrag, 1000, EINE_WOCHE_MS, ['altersfreigabe']), true);
});

// ---------------------------------------------------------------------
// extractTmdbId
// ---------------------------------------------------------------------

test('extractTmdbId: liest die numerische ID aus einer regulären TMDB-URL', () => {
    assert.equal(extractTmdbId('https://www.themoviedb.org/movie/1726-iron-man'), '1726');
});

test('extractTmdbId: funktioniert auch ohne Titel-Slug in der URL', () => {
    assert.equal(extractTmdbId('https://www.themoviedb.org/movie/557'), '557');
});

test('extractTmdbId: liefert null bei fehlender URL', () => {
    assert.equal(extractTmdbId(null), null);
    assert.equal(extractTmdbId(''), null);
    assert.equal(extractTmdbId(undefined), null);
});

test('extractTmdbId: liefert null bei einer URL ohne TMDB-Film-Muster', () => {
    assert.equal(extractTmdbId('https://www.imdb.com/title/tt0371746/'), null);
});
