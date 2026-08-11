/* =====================================================================
   kernfunktionen.js - reine, DOM-/Netzwerk-unabhängige Kernfunktionen
   ---------------------------------------------------------------------
   Aus app.js ausgelagert, damit sie OHNE Browser-Umgebung (kein
   document/window/fetch/localStorage) isoliert mit node --test geprüft
   werden können (Issue #61) - genau das Vorgehen, das CLAUDE.md unter
   "Testphilosophie" für Logik-Änderungen vorschreibt: "Kernfunktionen
   extrahieren, mit echten und mit Fehlerfällen durchspielen".

   Klassisches Skript wie app.js/ui.js (kein Modul, globaler Scope) - in
   index.html VOR app.js eingebunden, damit app.js diese Funktionen und
   Konstanten als normale Globals weiterverwendet. Verhalten im Browser
   bleibt dadurch unverändert, es ist reine Umsortierung von Code.

   Der module.exports-Block am Dateiende greift ausschließlich unter
   Node (node --test): im Browser existiert kein globales "module" und
   der Block wird übersprungen, ohne dort irgendeinen Effekt zu haben.
   ===================================================================== */

// Feldgrenzen für Kurz-/Langname einer eigenen Liste (Relaunch Stufe 2) -
// dieselben Werte wie in firestore.rules (gueltigeListenDaten), dort aber
// serverseitig ein zweites Mal geprüft und deshalb bewusst nicht von hier
// importiert (Firestore-Regeln können nichts aus diesem Repo laden).
const EIGENER_KURZNAME_MAX = 15;
const EIGENER_NAME_MAX = 40;

// Erzeugt aus Titel + Jahr dieselbe Art von ID wie posters/neuer-film.py
// (id_slug_erzeugen) - bewusst identischer Algorithmus, damit ein Film,
// der bereits in einer kuratierten Liste existiert, beim Hinzufügen zu
// einer eigenen Liste dieselbe ID bekommt und seine Bewertung dadurch
// automatisch übernommen wird (Bewertungen sind rein über die Film-ID
// verknüpft, siehe getRating/setRating in app.js).
function eigeneFilmIdErzeugen(titel, jahr) {
    // \p{Diacritic}: Unicode-Eigenschaft für Akzentzeichen - fasst nach
    // NFKD-Zerlegung (z. B. "é" -> "e" + Akzent) alle Akzente, nicht nur
    // die im lateinischen Bereich üblichen.
    const ohneAkzente = titel.normalize('NFKD').replace(/\p{Diacritic}/gu, '');
    const slug = ohneAkzente.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${slug}-${jahr}`;
}

// Reine Prüfung von Kurz-/Langname einer eigenen Liste gegen Längengrenzen
// und gegen bereits genutzte Namen (case-insensitive). Die Ermittlung DER
// bereits genutzten Namen (alleListenNamenGenutzt in app.js, liest den
// globalen Listen-Katalog) bleibt bewusst in app.js - hier nur die reine
// Prüflogik anhand der beiden übergebenen Sets. Gibt bei einem Fehler den
// anzuzeigenden Text zurück, sonst null.
function pruefeListenNamen(kurzname, name, kurznamenGenutzt, namenGenutzt) {
    if (!kurzname || !name) {
        return 'Bitte Kurz- und Langname angeben.';
    }
    if (kurzname.length > EIGENER_KURZNAME_MAX) {
        return `Kurzname darf höchstens ${EIGENER_KURZNAME_MAX} Zeichen lang sein.`;
    }
    if (name.length > EIGENER_NAME_MAX) {
        return `Langname darf höchstens ${EIGENER_NAME_MAX} Zeichen lang sein.`;
    }
    if (kurznamenGenutzt.has(kurzname.toLowerCase()) || namenGenutzt.has(name.toLowerCase())) {
        return 'Diesen Namen gibt es schon - bitte einen anderen wählen.';
    }
    return null;
}

// Prüft, ob ein Zwischenspeicher-Eintrag (TMDB-Titel/Laufzeit oder
// Streaming-Anbieter, siehe tmdbDetailsFuerAlleLaden/tmdbProvidersFuerAlleLaden
// in app.js) noch gültig ist: vorhanden, nicht abgelaufen UND - falls
// angegeben - alle erforderlichen Felder enthalten. Ein fehlendes Feld
// zählt als ungültig, auch wenn die Gültigkeitsdauer selbst noch nicht
// abgelaufen ist - wichtig für ältere Cache-Einträge von vor einem neuen
// Feld (z. B. "altersfreigabe" seit Issue #67, "backdropPath" seit Issue
// #69), die sonst bis zu 7 Tage fälschlich als vollständig gälten.
function cacheEintragGueltig(eintrag, jetzt, gueltigkeitMs, erforderlicheFelder = []) {
    if (!eintrag) return false;
    if ((jetzt - eintrag.cachedAt) >= gueltigkeitMs) return false;
    return erforderlicheFelder.every(feld => feld in eintrag);
}

// Liest die numerische TMDB-Film-ID aus einem TMDB-URL heraus (z. B.
// "https://www.themoviedb.org/movie/1726-iron-man" -> "1726"). Liefert
// null bei fehlender oder nicht passender URL.
function extractTmdbId(tmdbUrl) {
    if (!tmdbUrl) return null;
    const treffer = tmdbUrl.match(/themoviedb\.org\/movie\/(\d+)/);
    return treffer ? treffer[1] : null;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EIGENER_KURZNAME_MAX,
        EIGENER_NAME_MAX,
        eigeneFilmIdErzeugen,
        pruefeListenNamen,
        cacheEintragGueltig,
        extractTmdbId
    };
}
