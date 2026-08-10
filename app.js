/* =====================================================================
   app.js - Datenhaltung, Rendering und Bewertungen
   ---------------------------------------------------------------------
   Zuständig für: Laden und Validieren der aktiven Filmliste (siehe
   lists/manifest.json), Aufbau der
   Navigation und Filmkarten, Popcorn-Bewertungen sowie die daraus
   abgeleitete Fortschrittsanzeige.

   Wird als klassisches Script geladen (NICHT type="module"), damit die
   Funktionen global verfügbar bleiben - die generierten Karten nutzen
   onclick-Attribute, die auf globale Funktionen zugreifen.
   Wird nach ui.js geladen, da renderNav() dessen Funktionen benötigt.
   ===================================================================== */

// ================================================================
// FILM-DATENBANK
// Neue Filme hinzufügen, Reihenfolge ändern oder Sektionen anpassen:
// Einfach hier im Array editieren - der Rest rendert sich automatisch.
// Jede Sektion braucht: id (für Anker-Links, ohne Leerzeichen),
// title (Überschrift im Text), navLabel (Kurzform fürs Menü)
// und movies[] mit title, poster (Bild-URL) und desc.
// ================================================================
// Filmdaten werden zur Laufzeit aus moviedata.json geladen (siehe unten fetchAndRender()).
let MOVIE_DATA = [];

// Escaped Sonderzeichen, damit Titel/Beschreibungen nie HTML brechen
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Wie escapeHtml(), aber zusätzlich für den Einsatz INNERHALB eines
// HTML-Attributwerts (z. B. src="...", data-movie-id="...") geeignet:
// escapeHtml() allein lässt " und ' unverändert durch (die Text-Node-
// Serialisierung des Browsers escaped nur &, < und >), wodurch ein Wert
// mit einem " weiterhin aus dem Attribut ausbrechen und z. B. ein
// zusätzliches onerror="..." einschleusen könnte (Issue #55). Betrifft
// vor allem Felder aus eigenen Listen (movie.id, movie.poster), die
// über eine Gruppe geteilt und damit im Browser ANDERER Nutzer gerendert
// werden - firestore.rules kann den Inhalt einzelner filme[]-Einträge
// nicht prüfen (keine Element-Iteration in Security Rules möglich),
// daher ist dieses Escaping beim Rendern die eigentliche Absicherung.
function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Beschriftung des Gruppen-Eintrags. Ist eine Gruppe aktiv, steht deren
// Name darin, sonst schlicht "Gruppen". Lange Namen werden gekürzt,
// damit die Desktop-Leiste nicht umbricht.
const GRUPPENNAME_MAXLAENGE = 20;

function groupNavLabel() {
    const name = typeof window.getAktiveGruppeName === 'function'
        ? window.getAktiveGruppeName()
        : null;
    if (!name) return 'Gruppen';
    const gekuerzt = name.length > GRUPPENNAME_MAXLAENGE
        ? name.slice(0, GRUPPENNAME_MAXLAENGE - 1).trimEnd() + '…'
        : name;
    return 'Gruppe: ' + gekuerzt;
}

// Beschriftung des Konto-Eintrags: vor der Anmeldung "Login",
// danach "Mein Profil".
function kontoNavLabel() {
    return typeof window.getKontoLabel === 'function'
        ? window.getKontoLabel()
        : 'Login';
}

// Beschriftung des Listen-Eintrags: Name der aktiven Filmreihe.
function listeNavLabel() {
    const eintrag = findeListeNachId(aktiveListeId);
    return eintrag ? eintrag.kurzname : 'Listen';
}

function renderNav() {
    const nav = document.getElementById('mobileNav');
    const closeButton = `<button class="nav-close" aria-label="Menü schließen">✕</button>`;
    const homeLink = `<a href="#top" class="nav-home" data-fill-key="nav-home" aria-label="Zur Startseite"><span class="nav-home-icon">🏠</span> Home <span class="nav-progress" data-progress-key="nav-home"></span></a>`;
    // Konto, Gruppen und Listen bilden zusammen einen Block, abgesetzt von
    // Home und von den Sektionen der aktiven Liste (Konto/Gruppen-Logik in
    // groups.js). Listen steht bewusst zuletzt in diesem Block, direkt vor
    // den Sektionen der aktiven Liste, die sie betrifft.
    const kontoLink = `<a href="#" class="nav-konto" data-nav-konto title="Konto verwalten"><span class="nav-konto-icon">👤</span> ${escapeHtml(kontoNavLabel())}</a>`;
    const streamingLink = `<a href="#" class="nav-streaming" data-nav-streaming title="Streaming-Anbieter wählen"><span class="nav-streaming-icon">📺</span> Streaming</a>`;
    const groupLink = `<a href="#" class="nav-groups" data-nav-groups title="Gruppen verwalten"><span class="nav-groups-icon">👥</span> ${escapeHtml(groupNavLabel())}</a>`;
    const listenLink = `<a href="#" class="nav-listen" data-nav-listen title="Filmreihe wechseln"><span class="nav-listen-icon">📚</span> ${escapeHtml(listeNavLabel())}</a>`;
    // Auf Desktop senkrechter Strich, auf Mobil waagerechte Linie (siehe CSS)
    const trenner = `<span class="nav-trenner" aria-hidden="true"></span>`;
    // Eigene Listen bestehen aus genau einer Sektion mit der technischen
    // ID "inhalt" (siehe ladeUndRendereAktiveListe) - die braucht keinen
    // eigenen Unterpunkt, der Listeneintrag selbst genügt als Anker.
    const links = MOVIE_DATA.filter(section => section.id !== 'inhalt').map((section, i) =>
        `<a href="#${section.id}" data-section-id="${section.id}" data-fill-key="${section.id}">${i + 1}. ${escapeHtml(section.navLabel)} <span class="nav-progress" data-progress-key="${section.id}"></span></a>`
    ).join('');
    nav.innerHTML = closeButton + homeLink + trenner + kontoLink + streamingLink + groupLink + listenLink + trenner + links;

    // Klick-Handler per addEventListener statt Inline-onclick binden.
    // Robuster als String-Interpolation in onclick-Attributen, da so
    // keine Sonderzeichen (Anführungszeichen o.ä.) in IDs die
    // generierten Attribute versehentlich zerstören können.
    nav.querySelector('.nav-close').addEventListener('click', toggleSidebar);
    nav.querySelector('.nav-home').addEventListener('click', goHome);
    nav.querySelectorAll('a[data-section-id]').forEach(link => {
        link.addEventListener('click', event => goToSection(event, link.dataset.sectionId));
    });

    // groups.js wird als Modul geladen und ist eventuell noch nicht bereit -
    // deshalb erst beim Klick nachsehen, ob die Funktion existiert.
    nav.querySelector('[data-nav-listen]').addEventListener('click', event => {
        event.preventDefault();
        closeSidebar();
        if (typeof window.openListenPanel === 'function') {
            window.openListenPanel();
        } else {
            console.warn('Listenverwaltung noch nicht geladen.');
        }
    });
    nav.querySelector('[data-nav-konto]').addEventListener('click', event => {
        event.preventDefault();
        closeSidebar();
        if (typeof window.openKontoPanel === 'function') {
            window.openKontoPanel();
        } else {
            console.warn('Kontoverwaltung noch nicht geladen.');
        }
    });
    nav.querySelector('[data-nav-streaming]').addEventListener('click', event => {
        event.preventDefault();
        closeSidebar();
        if (typeof window.openStreamingPanel === 'function') {
            window.openStreamingPanel();
        } else {
            console.warn('Streaming-Anbieterauswahl noch nicht geladen.');
        }
    });
    nav.querySelector('[data-nav-groups]').addEventListener('click', event => {
        event.preventDefault();
        closeSidebar();
        if (typeof window.openGroupPanel === 'function') {
            window.openGroupPanel();
        } else {
            console.warn('Gruppenverwaltung noch nicht geladen.');
        }
    });
}

// Wird von groups.js aufgerufen, sobald sich Anmeldestatus oder aktive
// Gruppe ändern. Nur die Beschriftungen neu setzen, statt die ganze
// Navigation aufzubauen - so gehen Klick-Handler und Fortschritts-
// Füllung nicht verloren.
function updateNavLabels() {
    const gruppe = document.querySelector('[data-nav-groups]');
    if (gruppe) {
        gruppe.innerHTML =
            `<span class="nav-groups-icon">👥</span> ${escapeHtml(groupNavLabel())}`;
    }
    const konto = document.querySelector('[data-nav-konto]');
    if (konto) {
        konto.innerHTML =
            `<span class="nav-konto-icon">👤</span> ${escapeHtml(kontoNavLabel())}`;
    }
}

window.onAktiveGruppeGeaendert = updateNavLabels;
window.onKontoStatusGeaendert = updateNavLabels;
window.getVerfuegbareListen = () => VERFUEGBARE_LISTEN.map(l => ({
    id: l.id,
    name: l.name,
    kurzname: l.kurzname,
    eigene: !!l.eigene,
    herkunft: l.herkunft,
    bearbeitbar: l.eigene ? l.bearbeitbar : undefined,
    sperrgrund: l.eigene ? l.sperrgrund : undefined,
    erstellerName: l.herkunft === 'geteilt' ? l.erstellerName : undefined,
    anzahlFilme: l.eigene ? l.filme.length : undefined
}));
window.getAktiveListeId = () => aktiveListeId;
window.listeWechseln = listeWechseln;
window.eigeneListeAnlegen = eigeneListeAnlegen;
window.eigeneListeUmbenennen = eigeneListeUmbenennen;
window.eigeneListeLoeschen = eigeneListeLoeschen;
window.getEigeneListenAnzahl = () => eigeneListenLesen().length;
window.getEigeneListenMax = () => EIGENE_LISTEN_MAX;
window.getKontoListenAnzahl = () => kontoListenCacheLesen().length;
window.getKontoListenMax = () => KONTO_LISTEN_MAX;

// Streaming-Anbieterauswahl (Issue #33) - für die Auswahl-Ansicht in groups.js
window.getStreamingAnbieterListe = () => STREAMING_ANBIETER.map(a => ({ ...a }));
window.getAusgewaehlteAnbieter = ausgewaehlteAnbieterLesen;
window.getAnbieterMax = () => AUSGEWAEHLTE_ANBIETER_MAX;
window.anbieterAuswahlUmschalten = anbieterAuswahlUmschalten;

// Scrollt sanft nach ganz oben und schließt dabei das mobile Drawer-Menü
function goHome(event) {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeSidebar();
}

// Scrollt gezielt zu einer Sektion. Wird per JS statt per nativem
// Anker-Sprung erledigt, da der native Sprung in manchen mobilen
// Browsern nicht zuverlässig funktioniert, wenn der Link in einem
// Container mit CSS-"transform" liegt (unser Slide-in-Menü).
function goToSection(event, sectionId) {
    event.preventDefault();
    const target = document.getElementById(sectionId);
    closeSidebar();
    if (target) {
        // kurze Verzögerung, damit die Schließen-Animation des Menüs
        // den Scrollvorgang nicht stört
        setTimeout(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
    } else {
        console.warn('Ziel-Sektion nicht gefunden:', sectionId);
    }
}

// --- Bewertungssystem (0-5 Popcorn-Tüten), NUR lokal im Browser gespeichert ---
// Nutzt localStorage - die Bewertung bleibt auf diesem Gerät/Browser und
// wird nirgendwo hochgeladen oder synchronisiert.
// --- "Gesehen"-Status (Issue #3), NUR lokal im Browser gespeichert ---
// Unabhängig von der Popcorn-Bewertung: reines Ja/Nein pro Film.
// Setzt den Hintergrund eines Nav-Buttons als Fortschritts-Füllung:
// links "pct" Prozent grün (gesehen), rest transparent/normal.
function applyNavFill(fillKey, pct) {
    document.querySelectorAll('.quick-nav a[data-fill-key="' + fillKey + '"]').forEach(link => {
        link.style.background =
            `linear-gradient(to right, rgba(76, 175, 80, 0.45) ${pct}%, rgba(255, 255, 255, 0.05) ${pct}%)`;
    });
}

// Setzt den "(n/n)"-Text im Nav-Button (nur auf Mobile sichtbar,
// siehe .nav-progress CSS) - ergänzt die Füllung um genaue Zahlen.
function applyNavProgressText(progressKey, watched, total) {
    document.querySelectorAll('.nav-progress[data-progress-key="' + progressKey + '"]').forEach(el => {
        el.textContent = `(${watched}/${total})`;
    });
}

// Ein Film gilt als "gesehen", sobald er bewertet wurde (Rating > 0).
// Bewusst kein eigener, separater Gesehen-Status mehr - eine Bewertung
// impliziert ja bereits, dass der Film geschaut wurde.
function updateProgress() {
    let total = 0;
    let watchedTotal = 0;

    MOVIE_DATA.forEach(section => {
        let sectionTotal = 0;
        let sectionWatched = 0;
        section.movies.forEach(movie => {
            sectionTotal++;
            total++;
            if (getRating(movie.id) > 0) {
                sectionWatched++;
                watchedTotal++;
            }
        });
        const counter = document.querySelector('.section-count[data-section-id="' + section.id + '"]');
        if (counter) counter.textContent = `(${sectionWatched}/${sectionTotal})`;

        const sectionPct = sectionTotal > 0 ? (sectionWatched / sectionTotal * 100) : 0;
        applyNavFill(section.id, sectionPct);
        applyNavProgressText(section.id, sectionWatched, sectionTotal);
    });

    const overallPct = total > 0 ? (watchedTotal / total * 100) : 0;
    applyNavFill('nav-home', overallPct);
    applyNavProgressText('nav-home', watchedTotal, total);
}

function ratingKey(movieId) {
    return 'mcu-rating-' + movieId;
}

// Zeitstempel je Bewertung, gesammelt in EINEM Eintrag. Nötig, um beim
// Abgleich mit einer Gruppe entscheiden zu können, welcher Stand neuer
// ist (z. B. Handy gegen PC). Bewusst getrennt von den Bewertungen
// selbst, damit der bisherige Speicheraufbau unverändert bleibt.
const RATING_TIMES_KEY = 'mcu-rating-times';

function getRatingTimes() {
    try {
        return JSON.parse(localStorage.getItem(RATING_TIMES_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function getRatingTime(movieId) {
    return getRatingTimes()[movieId] || 0;
}

function setRatingTime(movieId, zeitstempel) {
    try {
        const alle = getRatingTimes();
        alle[movieId] = zeitstempel;
        localStorage.setItem(RATING_TIMES_KEY, JSON.stringify(alle));
    } catch (e) {
        console.warn('Zeitstempel konnte nicht gespeichert werden:', e);
    }
}

// Gemeinsamer Kern für eigene Eingaben und für Stände, die aus einer
// Gruppe übernommen werden. Kümmert sich um Speichern und Anzeige.
function speichereBewertung(movieId, wert, zeitstempel) {
    try {
        localStorage.setItem(ratingKey(movieId), String(wert));
    } catch (e) {
        console.warn('Bewertung konnte nicht gespeichert werden:', e);
    }
    setRatingTime(movieId, zeitstempel);
    updateRatingDisplay(movieId);
    updateProgress(); // Bewertung > 0 zählt als "gesehen" -> Fortschritt neu berechnen

    // Die Bewertungen der Gruppe werden erst nach eigener Abgabe
    // sichtbar - deshalb hier neu zeichnen.
    if (typeof updateGroupDisplay === 'function') updateGroupDisplay(movieId);

    const card = document.querySelector('.movie-card[data-movie-id="' + movieId + '"]');
    if (card) card.classList.toggle('watched', wert > 0);
}

// Übernimmt einen Stand aus der Gruppe, OHNE ihn erneut hochzuladen -
// sonst würden sich zwei Geräte gegenseitig endlos aktualisieren.
function applyRemoteRating(movieId, wert, zeitstempel) {
    speichereBewertung(movieId, wert, zeitstempel);
}

function getRating(movieId) {
    try {
        return parseInt(localStorage.getItem(ratingKey(movieId)) || '0', 10);
    } catch (e) {
        return 0; // z.B. privates Surfen ohne Storage-Zugriff
    }
}

function setRating(movieId, value, event) {
    event.stopPropagation(); // verhindert, dass die Karte das Poster-Overlay öffnet
    const current = getRating(movieId);
    const next = (current === value) ? 0 : value; // erneutes Antippen setzt zurück
    const jetzt = Date.now();

    speichereBewertung(movieId, next, jetzt);

    // Falls eine Gruppe aktiv ist, wird die Änderung geteilt. groups.js
    // wird als Modul geladen und ist eventuell noch nicht bereit -
    // deshalb erst hier nachsehen, ob die Funktion existiert.
    if (typeof window.onRatingChanged === 'function') {
        window.onRatingChanged(movieId, next, jetzt);
    }
}

function updateRatingDisplay(movieId) {
    const widget = document.querySelector('.movie-rating[data-movie-id="' + movieId + '"]');
    if (!widget) return;
    const current = getRating(movieId);
    widget.querySelectorAll('.popcorn').forEach(el => {
        const val = parseInt(el.dataset.value, 10);
        el.classList.toggle('filled', val <= current);
    });
}

function renderRatingWidget(movieId) {
    const current = getRating(movieId);
    const bags = [1, 2, 3, 4, 5].map(i => {
        const filled = i <= current ? ' filled' : '';
        return `<span class="popcorn${filled}" data-value="${i}" onclick="setRating('${movieId}', ${i}, event)" role="button" aria-label="${i} von 5 Popcorn-Tüten bewerten">🍿</span>`;
    }).join('');
    return `<div class="movie-rating" data-movie-id="${movieId}">${bags}</div>`;
}

function renderMovieRuntime(movie) {
    // Platzhalter - wird von titelUndLaufzeitAnzeigen() befüllt, sobald
    // Titel/Laufzeit aus dem Cache oder von TMDB vorliegen.
    return `<span class="movie-runtime" data-laufzeit-slot="${movie.id}"></span>`;
}

function renderMovieAltersfreigabe(movie) {
    // Platzhalter - wird von titelUndLaufzeitAnzeigen() befüllt (Issue #67).
    // Bleibt leer (und damit per CSS unsichtbar), wenn TMDB keine deutsche
    // FSK-Freigabe kennt.
    return `<span class="movie-altersfreigabe" data-altersfreigabe-slot="${movie.id}"></span>`;
}

function renderMovieMeta(movie) {
    const tmdbLink = movie.tmdb
        ? `<a href="${escapeHtml(movie.tmdb)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" data-tmdb-label-slot="${movie.id}" aria-label="Film auf TMDB ansehen"><img class="meta-icon tmdb-karten-icon" src="tmdb-logo.svg" alt="TMDB" loading="lazy"></a>`
        : '';
    const tmdbId = extractTmdbId(movie.tmdb);
    const trailerBtn = tmdbId
        ? `<button class="trailer-karten-btn" data-tmdb-id="${tmdbId}" onclick="trailerVonKarteOeffnen(this, event)">🎬 Trailer</button>`
        : '';
    return `<div class="movie-meta-left">${tmdbLink}${trailerBtn}</div>`;
}

// --- Bewertungen der Gruppe auf den Filmkarten (Issue #16, Schritt 6) ---
// Die eigene Bewertung ist immer sichtbar. Die der anderen erscheinen
// bewusst erst, nachdem man selbst bewertet hat - so lässt man sich beim
// eigenen Urteil nicht beeinflussen.

function renderGroupSlot(movieId) {
    return `<div class="movie-group-slot" data-group-movie-id="${movieId}"></div>`;
}

function buildGroupInfo(movieId) {
    const mitglieder = window.GRUPPEN_BEWERTUNGEN || [];
    if (mitglieder.length === 0) return '';   // keine Gruppe aktiv

    const eigeneKennung = typeof window.getEigeneUid === 'function' ? window.getEigeneUid() : null;
    const andere = mitglieder.filter(m => m.uid !== eigeneKennung);

    // roh kann aus einem direkten Firestore-Schreibzugriff (unter Umgehung
    // der App) beliebigen Typ/Inhalt haben - firestore.rules prüft nur,
    // dass ratings insgesamt eine Map ist, nicht den Inhalt einzelner
    // Bewertungen (Issue #54). Deshalb hier hart auf eine ganze Zahl
    // 0-5 validieren statt dem Wert per "|| 0" nur bei Falsy-Werten zu
    // misstrauen - alles andere (Text, Objekte, Arrays, Zahlen außerhalb
    // des gültigen Bereichs) wird zu 0. So bleibt b.wert beim späteren
    // Rendern (Zeile mit <strong>${b.wert}</strong>) und in der
    // Mittelwertbildung immer eine geprüfte kleine Ganzzahl - kein
    // zusätzliches Escaping an der Ausgabe nötig.
    const fremdeBewertungen = andere
        .map(m => {
            const roh = m.ratings && m.ratings[movieId] && m.ratings[movieId].value;
            const wert = (Number.isInteger(roh) && roh >= 0 && roh <= 5) ? roh : 0;
            return { name: m.name, wert };
        })
        .filter(b => b.wert > 0);

    if (fremdeBewertungen.length === 0) return '';   // niemand sonst hat bewertet

    if (getRating(movieId) === 0) {
        return `<div class="movie-group verdeckt">
                    👥 ${fremdeBewertungen.length} Bewertung(en) aus der Gruppe -
                    sichtbar, sobald du selbst bewertet hast
                </div>`;
    }

    const alleWerte = fremdeBewertungen.map(b => b.wert).concat(getRating(movieId));
    const schnitt = (alleWerte.reduce((a, b) => a + b, 0) / alleWerte.length)
        .toFixed(1).replace('.', ',');

    const namen = fremdeBewertungen
        .map(b => `<span class="gruppe-person">${escapeHtml(b.name)} <strong>${b.wert}</strong></span>`)
        .join('');

    return `<div class="movie-group">
                <span class="gruppe-schnitt">👥 Ø ${schnitt}</span>${namen}
            </div>`;
}

// Füllt alle Platzhalter neu. Wird aufgerufen, wenn Gruppendaten
// eintreffen und wenn sich die eigene Bewertung ändert.
function updateGroupDisplay(movieId) {
    const auswahl = movieId
        ? [document.querySelector('[data-group-movie-id="' + movieId + '"]')]
        : Array.from(document.querySelectorAll('[data-group-movie-id]'));

    auswahl.forEach(slot => {
        if (!slot) return;
        slot.innerHTML = buildGroupInfo(slot.dataset.groupMovieId);
    });
}

// groups.js meldet über diesen Weg, dass neue Gruppendaten vorliegen.
window.onGruppeAktualisiert = () => updateGroupDisplay();

// --- Trailer live über TMDB abfragen (Issue Trailer-Einbindung) ---
// Bewusst KEINE feste Speicherung: zeigt immer den Trailer, den TMDB
// aktuell führt, auch wenn sich das zugrundeliegende YouTube-Video
// ändert. Getestet und bestätigt: der Browser darf die TMDB-API direkt
// ansprechen, keine CORS-Sperre.
//
// Der Schlüssel steht zwangsläufig im öffentlichen Quelltext (wie der
// Firebase-Schlüssel), hier aber ohne serverseitige Zugriffsregeln als
// zweite Absicherung - bekanntes, akzeptiertes Restrisiko bei kleinem
// Projekt und TMDBs großzügigem kostenlosen Kontingent.
const TMDB_API_KEY = 'f95f3fc3a440179586a593719e24375c';

// Vermeidet, denselben Film innerhalb einer Sitzung mehrfach abzufragen.
const trailerCache = {};

// Liest die TMDB-Film-Kennung aus dem bereits vorhandenen tmdb-Link
// (z. B. aus .../movie/557-spider-man wird 557) - kein eigenes
// Datenfeld nötig.
function extractTmdbId(tmdbUrl) {
    if (!tmdbUrl) return null;
    const treffer = tmdbUrl.match(/themoviedb\.org\/movie\/(\d+)/);
    return treffer ? treffer[1] : null;
}

// --- Titel, Laufzeit und Altersfreigabe live über TMDB (Issue #67) ---
// moviedata.json enthält bewusst keinen Text mehr dafür - alles wird
// bei jedem Aufruf aktuell nachgeladen. Um die Seite trotzdem schnell
// zu halten und nicht bei jedem Besuch 47 Anfragen an TMDB zu stellen:
// 1. alle Filme WERDEN GLEICHZEITIG statt nacheinander abgefragt
// 2. das Ergebnis wird 7 Tage lokal zwischengespeichert
// Die Altersfreigabe (FSK) wird bewusst über append_to_response=release_dates
// im selben Aufruf mitgeladen statt über eine eigene Anfrage pro Film -
// verdoppelt sonst die Anzahl der TMDB-Anfragen ohne Nutzen.
const TMDB_DETAILS_CACHE_KEY = 'mcu-tmdb-details-cache';
const TMDB_DETAILS_GUELTIG_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

function tmdbDetailsCacheLesen() {
    try {
        return JSON.parse(localStorage.getItem(TMDB_DETAILS_CACHE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function tmdbDetailsCacheSchreiben(cache) {
    try {
        localStorage.setItem(TMDB_DETAILS_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('TMDB-Cache konnte nicht gespeichert werden:', e);
    }
}

// Liste aller Filme mit einer aus dem tmdb-Link auslesbaren Kennung.
function alleMovieTmdbIds() {
    const liste = [];
    MOVIE_DATA.forEach(section => {
        section.movies.forEach(movie => {
            const tmdbId = extractTmdbId(movie.tmdb);
            if (tmdbId) liste.push({ id: movie.id, tmdbId, tmdbUrl: movie.tmdb });
        });
    });
    return liste;
}

// Trägt Titel und Laufzeit an allen Stellen nach, an denen sie
// gebraucht werden (sichtbarer Titel, Laufzeit-Badge, TMDB-Icon-Label,
// Poster-Alternativtext) - unabhängig davon, ob der Wert aus dem Cache
// oder frisch von TMDB kommt.
function titelUndLaufzeitAnzeigen(movieId, titel, laufzeit, altersfreigabe) {
    const titelEl = document.querySelector(`[data-titel-slot="${movieId}"]`);
    if (titelEl) {
        titelEl.textContent = titel;
        titelEl.classList.remove('laedt');
    }

    // Rechts neben dem Titel, links von der Laufzeit (Issue #67)
    const altersfreigabeEl = document.querySelector(`[data-altersfreigabe-slot="${movieId}"]`);
    if (altersfreigabeEl) {
        altersfreigabeEl.textContent = altersfreigabe ? `FSK ${altersfreigabe}` : '';
    }

    const laufzeitEl = document.querySelector(`[data-laufzeit-slot="${movieId}"]`);
    if (laufzeitEl) {
        laufzeitEl.innerHTML = laufzeit
            ? `<span class="runtime-icon" aria-hidden="true">🎞️</span>${escapeHtml(laufzeit)}`
            : '';
    }

    const tmdbLinkEl = document.querySelector(`[data-tmdb-label-slot="${movieId}"]`);
    if (tmdbLinkEl) tmdbLinkEl.setAttribute('aria-label', titel + ' auf TMDB ansehen');

    const posterImgEl = document.querySelector(`.movie-card[data-movie-id="${movieId}"] .movie-poster img`);
    if (posterImgEl) posterImgEl.alt = titel;
}

// Lädt Titel + Laufzeit für alle übergebenen Filme. Bereits gültige
// Cache-Einträge werden sofort angezeigt (kein Warten), nur wirklich
// veraltete oder fehlende Einträge werden parallel neu abgefragt.
async function tmdbDetailsFuerAlleLaden(movieList) {
    const cache = tmdbDetailsCacheLesen();
    const jetzt = Date.now();
    const zuLaden = [];

    movieList.forEach(({ id, tmdbId }) => {
        const eintrag = cache[tmdbId];
        if (eintrag && (jetzt - eintrag.cachedAt) < TMDB_DETAILS_GUELTIG_MS) {
            titelUndLaufzeitAnzeigen(id, eintrag.title, eintrag.laufzeit, eintrag.altersfreigabe);
        } else {
            zuLaden.push({ id, tmdbId });
        }
    });

    if (zuLaden.length === 0) return;

    await Promise.all(zuLaden.map(async ({ id, tmdbId }) => {
        try {
            const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=de-DE&append_to_response=release_dates`;
            const antwort = await fetch(url);
            if (!antwort.ok) throw new Error('HTTP ' + antwort.status);
            const daten = await antwort.json();

            const jahr = (daten.release_date || '').slice(0, 4) || '????';
            const rohtitel = daten.title || daten.original_title || 'Unbekannter Titel';
            const titel = `${rohtitel} (${jahr})`;
            const laufzeit = daten.runtime ? `${daten.runtime} Min.` : '---';
            const altersfreigabe = ermittleAltersfreigabe(daten);

            cache[tmdbId] = { title: titel, laufzeit, altersfreigabe, cachedAt: Date.now() };
            titelUndLaufzeitAnzeigen(id, titel, laufzeit, altersfreigabe);
        } catch (err) {
            console.warn('Titel/Laufzeit konnten nicht geladen werden für', id, err);
            titelUndLaufzeitAnzeigen(id, 'Titel nicht verfügbar', '');
        }
    }));

    tmdbDetailsCacheSchreiben(cache);
}

// Liest die deutsche FSK-Freigabe aus release_dates (Issue #67). TMDB
// liefert pro Land mehrere Einträge (Kino, Video, ...) mit teils leerer
// certification - der erste nicht-leere Wert für DE wird verwendet.
// "0" (freigegeben ohne Altersbeschränkung) ist ein gültiges Ergebnis und
// wird bewusst NICHT wie ein fehlender Wert behandelt.
function ermittleAltersfreigabe(daten) {
    const laender = (daten.release_dates && daten.release_dates.results) || [];
    const de = laender.find(land => land.iso_3166_1 === 'DE');
    if (!de) return null;
    const eintrag = (de.release_dates || []).find(r => r.certification);
    return eintrag ? eintrag.certification : null;
}

// --- Streaming-Anbieter (Issue #33) ---
// Rein lokale Funktion: Nutzer wählen bis zu 4 bevorzugte Anbieter, die
// Auswahl wird nirgendwo hochgeladen. Bewusst eine feste, kuratierte Liste
// statt aller von TMDB für DE gemeldeten Anbieter (Shops wie "Apple TV
// Store" oder "Google Play Movies" wären für die meisten Nutzer nur
// Rauschen) - IDs/Logos stammen von
// GET /watch/providers/movie?watch_region=DE, nicht geraten.
// Liste bewusst auf Filmanbieter zugeschnitten (Nutzer-Feedback: reine
// TV-/Serien-Sender bringen hier wenig). "Sky" und "maxdome" existieren bei
// TMDB für DE nur unter diesen Namen (kein separater "Sky"- bzw.
// "maxdome"-Eintrag ohne Zusatz) - Namen daher unverändert von TMDB
// übernommen, um nicht fälschlich ein Abo-Angebot zu suggerieren, wo es
// sich um Sky Go (App-Zugang zum bestehenden Abo) bzw. einen reinen
// Leihen/Kaufen-Shop (maxdome Store) handelt.
const STREAMING_ANBIETER = [
    { id: 9,    name: 'Amazon Prime Video', logo: '/pvske1MyAoymrs5bguRfVqYiM9a.jpg' },
    { id: 10,   name: 'Amazon Video',       logo: '/qR6FKvnPBx2O37FDg8PNM7efwF3.jpg' },
    { id: 350,  name: 'Apple TV',           logo: '/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg' },
    { id: 337,  name: 'Disney Plus',        logo: '/97yvRBw1GzX7fXprcF80er19ot.jpg' },
    { id: 178,  name: 'MagentaTV',          logo: '/nCsFBTEmlCMc5NA4fwPuluTz6AO.jpg' },
    { id: 2412, name: 'Magenta TV+',        logo: '/qqTyjCCJuuARytrY7rNRAKka1VF.jpg' },
    { id: 20,   name: 'maxdome Store',      logo: '/cBN4jd4wPq6on0kESiTlevqvlnL.jpg' },
    { id: 8,    name: 'Netflix',            logo: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
    { id: 531,  name: 'Paramount Plus',     logo: '/h5DcR0J2EESLitnhR8xLG1QymTE.jpg' },
    { id: 29,   name: 'Sky Go',             logo: '/vDdk3LyjWkYlfCtkrhkjFKFK1Hg.jpg' },
    { id: 130,  name: 'Sky Store',          logo: '/59TxOAYcoFaufd6CWm465oPchD.jpg' },
    { id: 30,   name: 'WOW',                logo: '/9r5zFWuYnwjzO1JrNjSbLQwUc3P.jpg' }
];

const AUSGEWAEHLTE_ANBIETER_KEY = 'selected_providers';
// Bewusst 8 statt 4 (Issue #33 CR): bei mehreren Haushalts-Abos (z. B.
// Amazon + Magenta mit je zwei Angeboten) reichen 4 Plätze schnell nicht -
// da kaum ein Film gleichzeitig bei allen 8 verfügbar ist, bleibt die Karte
// trotzdem übersichtlich.
const AUSGEWAEHLTE_ANBIETER_MAX = 8;

function ausgewaehlteAnbieterLesen() {
    try {
        const rohdaten = JSON.parse(localStorage.getItem(AUSGEWAEHLTE_ANBIETER_KEY) || '[]');
        return Array.isArray(rohdaten) ? rohdaten : [];
    } catch (e) {
        return [];
    }
}

function ausgewaehlteAnbieterSchreiben(ids) {
    try {
        localStorage.setItem(AUSGEWAEHLTE_ANBIETER_KEY, JSON.stringify(ids));
    } catch (e) {
        console.warn('Anbieterauswahl konnte nicht gespeichert werden:', e);
    }
}

// An/abwählen eines Anbieters. Gibt zurück, ob die Änderung angewendet
// wurde - schlägt nur fehl, wenn beim Anwählen das Maximum bereits
// erreicht ist (die Checkboxen sind dann zwar schon deaktiviert, diese
// Prüfung bleibt aber die eigentliche Quelle der Wahrheit).
function anbieterAuswahlUmschalten(id) {
    const aktuelle = ausgewaehlteAnbieterLesen();
    const index = aktuelle.indexOf(id);
    if (index >= 0) {
        aktuelle.splice(index, 1);
    } else if (aktuelle.length < AUSGEWAEHLTE_ANBIETER_MAX) {
        aktuelle.push(id);
    } else {
        return { ok: false, ausgewaehlt: aktuelle };
    }
    ausgewaehlteAnbieterSchreiben(aktuelle);
    anbieterKartenAktualisieren();
    return { ok: true, ausgewaehlt: aktuelle };
}

const TMDB_PROVIDERS_CACHE_KEY = 'mcu-tmdb-providers-cache';
const TMDB_PROVIDERS_GUELTIG_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

function tmdbProvidersCacheLesen() {
    try {
        return JSON.parse(localStorage.getItem(TMDB_PROVIDERS_CACHE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function tmdbProvidersCacheSchreiben(cache) {
    try {
        localStorage.setItem(TMDB_PROVIDERS_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('Anbieter-Cache konnte nicht gespeichert werden:', e);
    }
}

// Setzt die Streaming-Logos auf einer einzelnen Filmkarte anhand der
// ausgewählten Anbieter und deren tatsächlicher Verfügbarkeit (flatrate
// vs. nur leihbar/käuflich). JustWatch-Attribution erscheint bewusst HIER,
// direkt bei den Logos auf jeder Karte, nicht nur zentral im
// Infos-Bereich - TMDB verlangt einen Hinweis "on each media item".
// Aufbau der Zeile: JustWatch-Pfeil (verlinkt) | Anbieter-Logos | Text.
// Der JustWatch-Link ist bewusst dieselbe TMDB-URL wie beim TMDB-Icon, nur
// um "/watch" erweitert (z. B. .../movie/557-spider-man/watch) - TMDBs
// eigene API liefert keine echte justwatch.com-URL heraus (CORS verhindert
// zudem das Auslesen der TMDB-Webseite selbst), diese Erweiterung ist der
// verlässliche, offizielle Weg zur Anbieter-Übersicht des Films.
function zeigeAnbieterAufKarte(movieId, anbieter, tmdbUrl) {
    const slot = document.querySelector(`[data-anbieter-slot="${movieId}"]`);
    if (!slot) return;

    const ausgewaehlt = ausgewaehlteAnbieterLesen();
    const logos = ausgewaehlt.map(id => {
        const info = STREAMING_ANBIETER.find(a => a.id === id);
        if (!info) return '';
        const istFlatrate = anbieter.flatrate.includes(id);
        const istKauf = !istFlatrate && anbieter.kauf.includes(id);
        if (!istFlatrate && !istKauf) return '';
        const titel = istFlatrate ? `Im Abo bei ${info.name}` : `Leihen/Kaufen bei ${info.name}`;
        return `<img class="anbieter-logo ${istFlatrate ? 'anbieter-flatrate' : 'anbieter-kauf'}" src="https://image.tmdb.org/t/p/w45${info.logo}" alt="${escapeHtml(info.name)}" title="${escapeHtml(titel)}" loading="lazy">`;
    }).filter(Boolean).join('');

    if (!logos) { slot.innerHTML = ''; return; }

    const jwIcon = `<img class="justwatch-icon" src="justwatch-icon.svg" alt="JustWatch" loading="lazy">`;
    const jwVerlinkt = tmdbUrl
        ? `<a href="${escapeHtml(tmdbUrl)}/watch" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="Streaming-Verfügbarkeit auf JustWatch ansehen" aria-label="Streaming-Verfügbarkeit auf JustWatch ansehen">${jwIcon}</a>`
        : jwIcon;

    slot.innerHTML = jwVerlinkt + logos + `<span class="anbieter-attribution">Powered by JustWatch</span>`;
}

// Wendet den zuletzt geladenen Anbieter-Cache erneut auf alle sichtbaren
// Karten an - ohne Netzwerkzugriff. Wird nach einer Änderung der Auswahl
// aufgerufen, damit die Karten sofort reagieren.
function anbieterKartenAktualisieren() {
    const cache = tmdbProvidersCacheLesen();
    alleMovieTmdbIds().forEach(({ id, tmdbId, tmdbUrl }) => {
        const eintrag = cache[tmdbId];
        if (eintrag) {
            zeigeAnbieterAufKarte(id, eintrag.anbieter, tmdbUrl);
        } else {
            const slot = document.querySelector(`[data-anbieter-slot="${id}"]`);
            if (slot) slot.innerHTML = '';
        }
    });
}

// Lädt für alle übergebenen Filme die Verfügbarkeit bei Streaming-Anbietern
// in Deutschland nach - Pattern identisch zu tmdbDetailsFuerAlleLaden
// (Cache-Treffer sofort anzeigen, Rest parallel nachladen, 7 Tage gültig).
// Schlägt eine Einzelabfrage fehl (offline, API-Fehler), bleibt die Karte
// einfach ohne Streaming-Logos - kein Abbruch für die anderen Filme.
async function tmdbProvidersFuerAlleLaden(movieList) {
    const cache = tmdbProvidersCacheLesen();
    const jetzt = Date.now();
    const zuLaden = [];

    movieList.forEach(({ id, tmdbId, tmdbUrl }) => {
        const eintrag = cache[tmdbId];
        if (eintrag && (jetzt - eintrag.cachedAt) < TMDB_PROVIDERS_GUELTIG_MS) {
            zeigeAnbieterAufKarte(id, eintrag.anbieter, tmdbUrl);
        } else {
            zuLaden.push({ id, tmdbId, tmdbUrl });
        }
    });

    if (zuLaden.length === 0) return;

    await Promise.all(zuLaden.map(async ({ id, tmdbId, tmdbUrl }) => {
        try {
            const url = `https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`;
            const antwort = await fetch(url);
            if (!antwort.ok) throw new Error('HTTP ' + antwort.status);
            const daten = await antwort.json();
            const de = (daten.results && daten.results.DE) || {};
            const anbieter = {
                flatrate: (de.flatrate || []).map(a => a.provider_id),
                kauf: [...(de.rent || []), ...(de.buy || [])].map(a => a.provider_id)
            };
            cache[tmdbId] = { anbieter, cachedAt: Date.now() };
            zeigeAnbieterAufKarte(id, anbieter, tmdbUrl);
        } catch (err) {
            console.warn('Anbieter konnten nicht geladen werden für', id, err);
        }
    }));

    tmdbProvidersCacheSchreiben(cache);
}

function waehleTrailer(videos) {
    if (!Array.isArray(videos)) return null;
    const kandidaten = videos.filter(v => v.site === 'YouTube' && v.type === 'Trailer');
    if (kandidaten.length === 0) return null;
    // Offiziellen Trailer bevorzugen, sonst den erstbesten nehmen -
    // besser irgendein Trailer als gar keiner.
    return kandidaten.find(v => v.official) || kandidaten[0];
}

async function trailerAbfragen(tmdbId, sprache) {
    const url = sprache
        ? `https://api.themoviedb.org/3/movie/${tmdbId}/videos?api_key=${TMDB_API_KEY}&language=${sprache}`
        : `https://api.themoviedb.org/3/movie/${tmdbId}/videos?api_key=${TMDB_API_KEY}`;
    const antwort = await fetch(url);
    if (!antwort.ok) throw new Error('HTTP ' + antwort.status);
    const daten = await antwort.json();
    return waehleTrailer(daten.results);
}

async function trailerLaden(tmdbId) {
    if (trailerCache[tmdbId] !== undefined) return trailerCache[tmdbId];

    try {
        let treffer = await trailerAbfragen(tmdbId, 'de-DE');
        if (!treffer) {
            // Kein deutscher Trailer hinterlegt - auf Englisch ausweichen
            treffer = await trailerAbfragen(tmdbId, null);
        }
        trailerCache[tmdbId] = treffer;
        return treffer;
    } catch (err) {
        console.warn('Trailer konnte nicht geladen werden:', err);
        trailerCache[tmdbId] = null;
        return null;
    }
}

// eigeneKarte (optional): { attribute, werkzeugeHtml } - zusätzliche
// Attribute am äußeren div (z. B. draggable) und zusätzliches HTML
// (Entfernen-Button, Pfeile) für Filmkarten in eigenen Listen. Ohne
// diesen Parameter unverändertes Verhalten für kuratierte Listen.
function renderMovieCard(movie, eigeneKarte) {
    const watchedClass = getRating(movie.id) > 0 ? ' watched' : '';
    const zusatzAttribute = eigeneKarte ? eigeneKarte.attribute : '';
    const werkzeugeHtml = eigeneKarte ? eigeneKarte.werkzeugeHtml : '';
    return `
<div class="movie-card${watchedClass}" data-movie-id="${escapeAttr(movie.id)}"${zusatzAttribute}>
    ${werkzeugeHtml}
    <div class="movie-poster" onclick="event.stopPropagation(); openOverlay(this.closest('.movie-card'))">
        <img src="${escapeAttr(movie.poster)}" alt="Filmposter" loading="lazy" onerror="handlePosterError(this)">
    </div>
    <div class="movie-content">
        <div class="movie-oben" onclick="obenBereichAngeklickt(event, this.closest('.movie-card'))">
            <div class="movie-title-row">
                <div class="movie-title laedt" data-titel-slot="${movie.id}">Lädt…</div>
                ${renderMovieAltersfreigabe(movie)}
                ${renderMovieRuntime(movie)}
            </div>
            <div class="movie-desc">${escapeHtml(movie.desc)}</div>
        </div>
        <div class="movie-meta-row">
            ${renderMovieMeta(movie)}
            ${renderRatingWidget(movie.id)}
        </div>
        <div class="movie-anbieter-row" data-anbieter-slot="${movie.id}"></div>
        ${renderGroupSlot(movie.id)}
    </div>
</div>`;
}

function renderContent() {
    const container = document.querySelector('.container.content-wrapper');
    // Eigene Listen bestehen aus genau einer Sektion mit der technischen
    // ID "inhalt" (siehe ladeUndRendereAktiveListe) - eigene Werkzeuge
    // (Film hinzufügen, Umsortieren) statt der sonst üblichen Sektions-
    // Überschrift, siehe renderEigeneListeWerkzeuge/renderEigenerFilmCard.
    const eigeneListeAktiv = MOVIE_DATA.length === 1 && MOVIE_DATA[0].id === 'inhalt';

    // Überschrift der aktiven Liste kommt bewusst aus dem Katalog
    // (lists/manifest.json bzw. den eigenen Listen), nicht fest im Code.
    const aktiveListe = findeListeNachId(aktiveListeId);
    const listenTitelHtml = aktiveListe
        ? `<h2 class="listen-titel">${escapeHtml(aktiveListe.name)}${eigeneListeAktiv ? ' <span class="section-count" data-section-id="inhalt"></span>' : ''}</h2>`
        : '';

    let inhaltHtml;
    if (eigeneListeAktiv) {
        const filme = MOVIE_DATA[0].movies;
        inhaltHtml = renderEigeneListeWerkzeuge(aktiveListe)
            + filme.map((m, i) => renderEigenerFilmCard(m, aktiveListeId, i, filme.length, aktiveListe.bearbeitbar)).join('');
    } else {
        inhaltHtml = MOVIE_DATA.map(section => `
<h2 id="${section.id}">${escapeHtml(section.title)} <span class="section-count" data-section-id="${section.id}"></span></h2>
${section.movies.map(m => renderMovieCard(m)).join('')}
    `).join('');
    }

    container.innerHTML = listenTitelHtml + inhaltHtml;
    updateProgress();
    updateGroupDisplay();   // falls Gruppendaten bereits vorliegen

    // Titel und Laufzeit stehen nicht mehr in moviedata.json, sondern
    // werden live von TMDB nachgeladen (mit Zwischenspeicherung, siehe
    // tmdbDetailsFuerAlleLaden). Läuft im Hintergrund, blockiert also
    // nicht den Aufbau der restlichen Karte.
    tmdbDetailsFuerAlleLaden(alleMovieTmdbIds());
    tmdbProvidersFuerAlleLaden(alleMovieTmdbIds());
}

// Lädt moviedata.json und rendert erst danach Navigation und Filmkarten.
// Hinweis: fetch() auf eine lokale Datei funktioniert nur über http(s) -
// z. B. auf GitHub Pages, oder lokal über einen einfachen Webserver
// (python3 -m http.server), NICHT per Doppelklick/file://.
// Prüft die geladenen Daten Eintrag für Eintrag. Fehlerhafte Sektionen
// oder Filme werden übersprungen statt die komplette Seite lahmzulegen -
// ein vergessenes Komma bei einem Film soll nicht die anderen 46 kosten.
// Gibt {sections, skippedSections, skippedMovies} zurück.
function validateMovieData(raw) {
    const result = { sections: [], skippedSections: 0, skippedMovies: 0 };

    if (!Array.isArray(raw)) {
        console.error('Filmliste enthält kein Array auf oberster Ebene.');
        return result;
    }

    raw.forEach((section, sIdx) => {
        if (!section || typeof section !== 'object') {
            console.warn(`Sektion ${sIdx + 1} übersprungen: kein gültiges Objekt.`);
            result.skippedSections++;
            return;
        }
        if (!section.id || !section.title) {
            console.warn(`Sektion ${sIdx + 1} übersprungen: "id" oder "title" fehlt.`, section);
            result.skippedSections++;
            return;
        }
        if (!Array.isArray(section.movies)) {
            console.warn(`Sektion "${section.title}" übersprungen: "movies" ist kein Array.`);
            result.skippedSections++;
            return;
        }

        const validMovies = [];
        section.movies.forEach((movie, mIdx) => {
            if (!movie || typeof movie !== 'object') {
                console.warn(`Film ${mIdx + 1} in "${section.title}" übersprungen: kein gültiges Objekt.`);
                result.skippedMovies++;
                return;
            }
            // "tmdb" ist jetzt Pflicht statt "title": Titel und Laufzeit
            // werden live von TMDB nachgeladen, ohne Link gäbe es beides
            // nicht - der Film wäre unbenutzbar.
            if (!movie.id || !movie.tmdb) {
                console.warn(`Film ${mIdx + 1} in "${section.title}" übersprungen: "id" oder "tmdb" fehlt.`, movie);
                result.skippedMovies++;
                return;
            }
            // Fehlende optionale Felder sind kein Grund zum Überspringen -
            // lieber den Film mit Lücke zeigen als gar nicht.
            validMovies.push({
                ...movie,
                desc: movie.desc || '',
                poster: movie.poster || ''
            });
        });

        result.sections.push({
            ...section,
            navLabel: section.navLabel || section.title,
            movies: validMovies
        });
    });

    return result;
}

// Springt ein Posterbild nicht an (Datei fehlt, falscher Pfad, offline),
// wird statt des kaputten Bild-Symbols ein Platzhalter angezeigt.
function handlePosterError(imgElement) {
    const poster = imgElement.closest('.movie-poster');
    const card = imgElement.closest('.movie-card');
    imgElement.remove();
    if (poster) poster.classList.add('poster-missing');
    if (card) card.classList.add('no-poster');
    console.warn('Poster konnte nicht geladen werden:', imgElement.getAttribute('src'));
}

// --- Mehrere Filmreihen (Relaunch Stufe 1) ---
// Statt einer festen Datei gibt es jetzt einen Katalog verfügbarer
// Listen (lists/manifest.json). Die zuletzt gewählte Liste wird lokal
// gemerkt, Bewertungen und Gruppen bleiben davon unberührt - Film-IDs
// (Titel+Jahr) sind listenübergreifend eindeutig, dasselbe Speicher-
// schema funktioniert also unverändert weiter.
const AKTIVE_LISTE_KEY = 'mcu-aktive-liste';
let VERFUEGBARE_LISTEN = [];
let aktiveListeId = null;

function aktiveListeIdLesen() {
    try {
        return localStorage.getItem(AKTIVE_LISTE_KEY);
    } catch (e) {
        return null;
    }
}

function aktiveListeIdSchreiben(listeId) {
    try {
        localStorage.setItem(AKTIVE_LISTE_KEY, listeId);
    } catch (e) {
        console.warn('Listenauswahl konnte nicht gespeichert werden:', e);
    }
}

function findeListeNachId(listeId) {
    return VERFUEGBARE_LISTEN.find(l => l.id === listeId) || null;
}

// Wechselt zu einer anderen Liste: lädt deren Daten, baut Navigation
// und Inhalt neu auf. Wird vom "Listen"-Bereich aus aufgerufen.
async function listeWechseln(listeId) {
    const eintrag = findeListeNachId(listeId);
    if (!eintrag) {
        console.warn('Unbekannte Liste:', listeId);
        return;
    }
    aktiveListeId = listeId;
    aktiveListeIdSchreiben(listeId);
    // Sortier-/Formularzustand gehört zur zuvor aktiven Liste - beim
    // Wechsel zurücksetzen, sonst bliebe z. B. der Sortier-Modus einer
    // eigenen Liste beim Wechsel zu einer anderen aktiv.
    sortierModusAktiv = false;
    eigenerFormularOffen = false;
    await ladeUndRendereAktiveListe();
    if (typeof window.onAktiveListeGeaendert === 'function') {
        window.onAktiveListeGeaendert();
    }
}

// --- Eigene Listen (Relaunch Stufe 2) ---
// Komplett lokal gespeichert, taucht NICHT in lists/manifest.json auf.
// Jede eigene Liste besteht aus genau einer Sektion mit der technischen
// ID "inhalt" (siehe ladeUndRendereAktiveListe/renderContent/renderNav) -
// so funktioniert dieselbe Rendering-, Bewertungs- und Fortschritts-
// Logik wie bei kuratierten Listen unverändert weiter.
const EIGENE_LISTEN_KEY = 'mcu-eigene-listen';
const EIGENE_LISTEN_MAX = 3;
// Konto-Listen-Cache: Spiegel der Firestore-Daten (users/{uid}/listen),
// dient NUR der Anzeige - Firestore ist hier die führende Quelle, anders
// als bei Bewertungen (Issue #37, bewusste Abweichung vom sonstigen
// Grundsatz "lokal ist führend").
const KONTO_LISTEN_CACHE_KEY = 'mcu-konto-listen-cache';
const KONTO_LISTEN_MAX = 10;
const EIGENE_LISTE_FILME_MAX = 50;
const EIGENER_KURZNAME_MAX = 15;
const EIGENER_NAME_MAX = 40;
// Feste Obergrenze, mit wie vielen Gruppen GLEICHZEITIG geteilt werden
// darf (Relaunch Stufe 4, Issue #39) - muss zur fest ausgerollten Prüfung
// istMitgliedEinerDieserGruppen() in firestore.rules passen, da Firstore-
// Regeln nicht über ein Array iterieren können.
const GETEILT_GRUPPEN_MAX = 5;

// Katalog aus lists/manifest.json, OHNE eigene Listen - wird beim Start
// einmal befüllt (siehe fetchAndRender). VERFUEGBARE_LISTEN ist davon
// abgeleitet und enthält zusätzlich die eigenen Listen (lokal + Konto)
// sowie mit mir geteilte Listen aus Gruppen.
let KATALOG_LISTEN = [];

// Geteilte Listen ANDERER Mitglieder (Relaunch Stufe 4, Issue #39) -
// bewusst NUR im Arbeitsspeicher, kein localStorage-Cache: sollen laut
// Issue "beim Öffnen bzw. beim Wechseln frisch nachgeladen" werden
// (siehe groups.js: geteilteListenLaden/geteilteListeEinzelnLaden).
let GETEILTE_LISTEN = [];

window.geteilteListenSetzen = function (listen) {
    GETEILTE_LISTEN = listen;
    listenKatalogNeuAufbauen();
};

// UI-Zustand für die Werkzeuge auf der Inhaltsseite einer eigenen Liste
// (siehe renderEigeneListeWerkzeuge/renderEigenerFilmCard weiter unten).
let eigenerFormularOffen = false;
let eigenerBeschreibungModus = 'tmdb';
let sortierModusAktiv = false;
let ziehenderFilmId = null;
let teilenPanelOffenFuer = null;

// Zustand der TMDB-Live-Suche im "Film hinzufügen"-Formular (Issue #49).
// eigenerSucheErgebnisse und eigenerAusgewaehlterFilm bleiben bewusst nur
// im Speicher (kein localStorage) - die Suche ist reine Formular-Hilfe,
// keine dauerhaft zu speichernde Information.
let eigenerSucheErgebnisse = [];
let eigenerAusgewaehlterFilm = null; // { tmdbId, titel, jahr, posterPfad }
let eigenerSucheDebounceTimer = null;

function eigeneListenLesen() {
    try {
        const roh = JSON.parse(localStorage.getItem(EIGENE_LISTEN_KEY) || '[]');
        return Array.isArray(roh) ? roh : [];
    } catch (e) {
        return [];
    }
}

function eigeneListenSchreiben(listen) {
    try {
        localStorage.setItem(EIGENE_LISTEN_KEY, JSON.stringify(listen));
    } catch (e) {
        console.warn('Eigene Listen konnten nicht gespeichert werden:', e);
    }
}

// Cache der kontogebundenen Listen (siehe KONTO_LISTEN_CACHE_KEY oben).
// Wird von groups.js bei Login/Änderungen befüllt (kontoListenCacheSetzen
// & Co. weiter unten), hier nur Lesen/Schreiben.
function kontoListenCacheLesen() {
    try {
        const roh = JSON.parse(localStorage.getItem(KONTO_LISTEN_CACHE_KEY) || '[]');
        return Array.isArray(roh) ? roh : [];
    } catch (e) {
        return [];
    }
}

function kontoListenCacheSchreiben(listen) {
    try {
        localStorage.setItem(KONTO_LISTEN_CACHE_KEY, JSON.stringify(listen));
    } catch (e) {
        console.warn('Konto-Listen-Cache konnte nicht gespeichert werden:', e);
    }
}

// Für groups.js: Cache nach dem Laden aus Firestore komplett ersetzen
// bzw. nach einer einzelnen Änderung (Anlegen/Speichern/Löschen)
// aktualisieren - hält den Cache ohne eigene Firestore-Kenntnis in app.js
// synchron.
window.kontoListenCacheSetzen = function (listen) {
    kontoListenCacheSchreiben(listen);
    listenKatalogNeuAufbauen();
};
window.kontoListenCacheAktualisieren = function (liste) {
    const alle = kontoListenCacheLesen();
    const index = alle.findIndex(l => l.id === liste.id);
    if (index === -1) alle.push(liste); else alle[index] = liste;
    kontoListenCacheSchreiben(alle);
    listenKatalogNeuAufbauen();
};
window.kontoListenCacheEntfernen = function (listeId) {
    kontoListenCacheSchreiben(kontoListenCacheLesen().filter(l => l.id !== listeId));
    listenKatalogNeuAufbauen();
};

// Grund, warum eine eigene Liste GERADE NICHT bearbeitet werden kann,
// oder null wenn sie bearbeitbar ist. Lokale Listen sind immer
// bearbeitbar. Konto-Listen brauchen laut Issue #37 bewusst eine
// Internetverbindung (kein Offline-Bearbeiten, keine Warteschlange wie
// bei Bewertungen) UND eine echte Anmeldung (nicht anonym). Geteilte
// Listen (Issue #39) gehören nie einem selbst - für Empfänger IMMER nur
// lesbar, unabhängig vom Anmeldestatus.
function eigeneListeSperrgrund(liste) {
    if (liste.herkunft === 'geteilt') {
        return `Diese Liste von ${liste.erstellerName || 'jemand anderem'} gehört nicht dir - du kannst sie ansehen und bewerten, aber nicht bearbeiten.`;
    }
    if (liste.herkunft !== 'konto') return null;
    if (!(typeof window.istEchtAngemeldet === 'function' && window.istEchtAngemeldet())) {
        return 'Diese Liste ist nur lesbar, weil du nicht mehr angemeldet bist.';
    }
    if (!navigator.onLine) {
        return 'Zum Bearbeiten wird eine Internetverbindung benötigt.';
    }
    return null;
}

function eigeneListeAlsKatalogEintrag(liste, herkunft) {
    const eintrag = {
        id: liste.id,
        name: liste.name,
        kurzname: liste.kurzname,
        eigene: true,
        herkunft,
        filme: liste.filme,
        geteiltInGruppen: liste.geteiltInGruppen || [],
        ownerUid: liste.ownerUid,
        erstellerName: liste.erstellerName
    };
    eintrag.sperrgrund = eigeneListeSperrgrund(eintrag);
    eintrag.bearbeitbar = !eintrag.sperrgrund;
    return eintrag;
}

// Sucht eine eigene Liste unabhängig von ihrer Herkunft (lokal, Konto
// oder mit mir geteilt) und markiert das Ergebnis entsprechend -
// Grundlage für alle Änderungsfunktionen weiter unten, die mehrere
// Speicherorte gleich behandeln können sollen.
function eigeneListeFinden(listeId) {
    const lokal = eigeneListenLesen().find(l => l.id === listeId);
    if (lokal) return { ...lokal, herkunft: 'lokal' };
    const konto = kontoListenCacheLesen().find(l => l.id === listeId);
    if (konto) return { ...konto, herkunft: 'konto' };
    const geteilt = GETEILTE_LISTEN.find(l => l.id === listeId);
    if (geteilt) return { ...geteilt, herkunft: 'geteilt' };
    return null;
}

// --- Mit Gruppen teilen (Relaunch Stufe 4, Issue #39) ---
// Nur Konto-Listen können geteilt werden (setzt Stufe 3 voraus - eine
// rein lokale Liste ohne Anmeldung ist für andere technisch nicht
// erreichbar). Teilen/Beenden läuft über dieselbe Persistierung wie
// jede andere Änderung (eigeneListePersistieren -> kontoListeSpeichern
// in groups.js), es wird nur das Feld geteiltInGruppen angepasst.

async function listeMitGruppeTeilen(listeId, gid) {
    const liste = eigeneListeFinden(listeId);
    if (!liste || liste.herkunft !== 'konto') {
        return { ok: false, fehler: 'Nur Konto-Listen können geteilt werden.' };
    }
    const sperrgrund = eigeneListeSperrgrund(liste);
    if (sperrgrund) return { ok: false, fehler: sperrgrund };

    const bisherige = liste.geteiltInGruppen || [];
    if (bisherige.includes(gid)) return { ok: true }; // schon geteilt, nichts zu tun
    if (bisherige.length >= GETEILT_GRUPPEN_MAX) {
        return { ok: false, fehler: `Eine Liste kann mit höchstens ${GETEILT_GRUPPEN_MAX} Gruppen gleichzeitig geteilt werden.` };
    }

    liste.geteiltInGruppen = [...bisherige, gid];
    try {
        await eigeneListePersistieren(liste);
        // Zeiger bei der Gruppe anlegen, damit Mitglieder die Liste
        // überhaupt finden (siehe listePointerHinzufuegen in groups.js -
        // der eigentliche Lesezugriff läuft unabhängig davon über
        // geteiltInGruppen auf der Liste selbst).
        if (typeof window.listePointerHinzufuegen === 'function' && typeof window.getEigeneUid === 'function') {
            await window.listePointerHinzufuegen(gid, window.getEigeneUid(), listeId);
        }
    } catch (err) {
        return { ok: false, fehler: 'Teilen fehlgeschlagen: ' + (err.message || err) };
    }
    return { ok: true };
}

async function listeVonGruppeEntfernen(listeId, gid) {
    const liste = eigeneListeFinden(listeId);
    if (!liste) return { ok: false, fehler: 'Liste nicht gefunden.' };
    const sperrgrund = eigeneListeSperrgrund(liste);
    if (sperrgrund) return { ok: false, fehler: sperrgrund };

    liste.geteiltInGruppen = (liste.geteiltInGruppen || []).filter(g => g !== gid);
    try {
        await eigeneListePersistieren(liste);
        if (typeof window.listePointerEntfernen === 'function' && typeof window.getEigeneUid === 'function') {
            await window.listePointerEntfernen(gid, window.getEigeneUid(), listeId);
        }
    } catch (err) {
        return { ok: false, fehler: 'Beenden des Teilens fehlgeschlagen: ' + (err.message || err) };
    }
    return { ok: true };
}

function teilenPanelUmschalten(listeId) {
    teilenPanelOffenFuer = teilenPanelOffenFuer === listeId ? null : listeId;
    renderContent();
}

function teilenFehlerAnzeigen(text) {
    const el = document.getElementById('teilen-fehler');
    if (el) { el.textContent = text; el.style.display = 'block'; }
}

async function teilenUmschalten(listeId, gid, aktiv) {
    const ergebnis = aktiv
        ? await listeMitGruppeTeilen(listeId, gid)
        : await listeVonGruppeEntfernen(listeId, gid);
    if (!ergebnis.ok) {
        teilenFehlerAnzeigen(ergebnis.fehler);
        return;
    }
    await ladeUndRendereAktiveListe();
}

// Panel mit einer Checkbox pro lokal gemerkter Gruppen-Mitgliedschaft -
// Mitgliedschaften kennt nur groups.js (lokal gemerkt, siehe dortige
// Begründung), deshalb über window.getMeineGruppenMitgliedschaften.
function renderTeilenPanel(eigeneListe) {
    const meineGruppen = typeof window.getMeineGruppenMitgliedschaften === 'function'
        ? window.getMeineGruppenMitgliedschaften()
        : [];

    if (meineGruppen.length === 0) {
        return `<div class="eigene-formular">
            <p class="eigene-hinweis">Du bist noch in keiner Gruppe. Lege zuerst eine Gruppe an oder tritt einer bei.</p>
        </div>`;
    }

    const geteiltIn = new Set(eigeneListe.geteiltInGruppen || []);
    const zeilen = meineGruppen.map(g => `
        <label class="gruppen-check">
            <input type="checkbox" ${geteiltIn.has(g.groupId) ? 'checked' : ''}
                   onchange="teilenUmschalten('${eigeneListe.id}', '${g.groupId}', this.checked)">
            ${escapeHtml(g.groupName)}
        </label>`).join('');

    return `<div class="eigene-formular">
        <div class="eigene-hinweis" style="margin-bottom:8px;">Mit welchen Gruppen soll "${escapeHtml(eigeneListe.kurzname)}" geteilt werden?</div>
        ${zeilen}
        <div id="teilen-fehler" class="eigene-fehler" style="display:none;"></div>
    </div>`;
}

// Zentrale Speicherstelle für eine geänderte eigene Liste - lokal oder
// am Konto, je nach Herkunft. Die Änderungsfunktionen (Filme
// hinzufügen/entfernen/umsortieren, umbenennen) müssen dadurch selbst
// nicht wissen, WO die Liste landet.
async function eigeneListePersistieren(liste) {
    // "herkunft" ist ein von eigeneListeFinden() angehängtes Merkmal, kein
    // Teil der eigentlichen Listendaten - nicht mit abspeichern.
    const { herkunft, ...daten } = liste;
    if (herkunft === 'konto') {
        if (typeof window.kontoListeSpeichern !== 'function') {
            throw new Error('Kontoanbindung nicht verfügbar.');
        }
        await window.kontoListeSpeichern(daten);
    } else {
        const alle = eigeneListenLesen();
        const index = alle.findIndex(l => l.id === daten.id);
        if (index === -1) alle.push(daten); else alle[index] = daten;
        eigeneListenSchreiben(alle);
    }
    listenKatalogNeuAufbauen();
}

// Baut VERFUEGBARE_LISTEN aus dem festen Katalog + den eigenen Listen
// (lokal, Konto, geteilt) neu auf. Nach jeder Änderung aufrufen, damit
// findeListeNachId() & Co. den aktuellen Stand sehen.
function listenKatalogNeuAufbauen() {
    const lokaleEintraege = eigeneListenLesen().map(l => eigeneListeAlsKatalogEintrag(l, 'lokal'));
    const kontoEintraege = kontoListenCacheLesen().map(l => eigeneListeAlsKatalogEintrag(l, 'konto'));
    const geteilteEintraege = GETEILTE_LISTEN.map(l => eigeneListeAlsKatalogEintrag(l, 'geteilt'));
    VERFUEGBARE_LISTEN = KATALOG_LISTEN.concat(lokaleEintraege, kontoEintraege, geteilteEintraege);
}

// Erzeugt aus Titel + Jahr dieselbe Art von ID wie posters/neuer-film.py
// (id_slug_erzeugen) - bewusst identischer Algorithmus, damit ein Film,
// der bereits in einer kuratierten Liste existiert, beim Hinzufügen zu
// einer eigenen Liste dieselbe ID bekommt und seine Bewertung dadurch
// automatisch übernommen wird (Bewertungen sind rein über die Film-ID
// verknüpft, siehe getRating/setRating).
function eigeneFilmIdErzeugen(titel, jahr) {
    // \p{Diacritic}: Unicode-Eigenschaft für Akzentzeichen - fasst nach
    // NFKD-Zerlegung (z. B. "é" -> "e" + Akzent) alle Akzente, nicht nur
    // die im lateinischen Bereich üblichen.
    const ohneAkzente = titel.normalize('NFKD').replace(/\p{Diacritic}/gu, '');
    const slug = ohneAkzente.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${slug}-${jahr}`;
}

async function eigeneListeTmdbAbfragen(tmdbId, sprache) {
    const url = sprache
        ? `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=${sprache}`
        : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const antwort = await fetch(url);
    if (!antwort.ok) throw new Error('HTTP ' + antwort.status);
    return antwort.json();
}

// Analog zu neuer-film.py: erst Deutsch abfragen, fehlende Titel/Poster
// (nicht jede TMDB-Sprache hat beides hinterlegt) auf Englisch nachfragen.
async function eigeneListeTmdbDetailsHolen(tmdbId) {
    const daten = await eigeneListeTmdbAbfragen(tmdbId, 'de-DE');
    if (!daten.title || !daten.poster_path) {
        const datenEn = await eigeneListeTmdbAbfragen(tmdbId, null);
        if (!daten.title) daten.title = datenEn.title || datenEn.original_title;
        if (!daten.poster_path) daten.poster_path = datenEn.poster_path;
    }
    return daten;
}

// Live-Suche über den TMDB Search-Movie-Endpunkt (Issue #49). Liefert die
// ersten Treffer mit Titel, Erscheinungsjahr und Poster-Pfad - genug für
// eine Vorschau, ohne für jeden Treffer einzeln die vollen Filmdetails
// abzufragen (das passiert erst beim tatsächlichen Hinzufügen).
const EIGENE_SUCHE_TREFFER_MAX = 8;

async function eigeneListeTmdbSuchen(suchtext) {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=de-DE&query=${encodeURIComponent(suchtext)}`;
    const antwort = await fetch(url);
    if (!antwort.ok) throw new Error('HTTP ' + antwort.status);
    const daten = await antwort.json();
    return (daten.results || [])
        .slice(0, EIGENE_SUCHE_TREFFER_MAX)
        .map(r => ({
            tmdbId: r.id,
            titel: r.title || r.original_title || 'Ohne Titel',
            jahr: (r.release_date || '').slice(0, 4),
            posterPfad: r.poster_path || null
        }));
}

// Sammelt Kurz- und Langnamen aller Listen (klein geschrieben, getrimmt),
// optional eine Liste per ID ausgenommen (beim Umbenennen die Liste
// selbst). Dient der Prüfung auf doppelte Namen.
function alleListenNamenGenutzt(ausgenommenId) {
    const kurznamen = new Set();
    const namen = new Set();
    VERFUEGBARE_LISTEN.forEach(l => {
        if (l.id === ausgenommenId) return;
        kurznamen.add(l.kurzname.trim().toLowerCase());
        namen.add(l.name.trim().toLowerCase());
    });
    return { kurznamen, namen };
}

function eigeneListeNamenPruefen(kurzname, name, ausgenommenId) {
    if (!kurzname || !name) {
        return 'Bitte Kurz- und Langname angeben.';
    }
    if (kurzname.length > EIGENER_KURZNAME_MAX) {
        return `Kurzname darf höchstens ${EIGENER_KURZNAME_MAX} Zeichen lang sein.`;
    }
    if (name.length > EIGENER_NAME_MAX) {
        return `Langname darf höchstens ${EIGENER_NAME_MAX} Zeichen lang sein.`;
    }
    const { kurznamen, namen } = alleListenNamenGenutzt(ausgenommenId);
    if (kurznamen.has(kurzname.toLowerCase()) || namen.has(name.toLowerCase())) {
        return 'Diesen Namen gibt es schon - bitte einen anderen wählen.';
    }
    return null;
}

function eigeneListeZufallsId() {
    return 'eigene-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Echt angemeldet + online -> neue Listen gehen direkt ans Konto (bis zu
// KONTO_LISTEN_MAX), sonst rein lokal (bis zu EIGENE_LISTEN_MAX). Der
// Nutzer wählt das nicht separat aus - die Herkunft ergibt sich aus dem
// aktuellen Anmeldestatus, genau wie bei Bewertungen, die automatisch
// geteilt werden, sobald eine Gruppe aktiv ist.
async function eigeneListeAnlegen(kurznameRoh, nameRoh) {
    const kurzname = (kurznameRoh || '').trim();
    const name = (nameRoh || '').trim();

    const fehler = eigeneListeNamenPruefen(kurzname, name, null);
    if (fehler) return { ok: false, fehler };

    const kontoBereit = typeof window.istEchtAngemeldet === 'function' && window.istEchtAngemeldet();

    if (kontoBereit) {
        if (!navigator.onLine) {
            return { ok: false, fehler: 'Zum Anlegen einer Konto-Liste wird eine Internetverbindung benötigt.' };
        }
        if (kontoListenCacheLesen().length >= KONTO_LISTEN_MAX) {
            return { ok: false, fehler: `Du hast bereits ${KONTO_LISTEN_MAX} Listen in deinem Konto gespeichert - bitte erst eine löschen, um Platz zu schaffen.` };
        }
        const neueListe = { id: eigeneListeZufallsId(), kurzname, name, filme: [] };
        try {
            await window.kontoListeAnlegen(neueListe);
        } catch (err) {
            return { ok: false, fehler: 'Liste konnte nicht im Konto gespeichert werden: ' + (err.message || err) };
        }
        listenKatalogNeuAufbauen();
        return { ok: true, listeId: neueListe.id };
    }

    const eigeneListen = eigeneListenLesen();
    if (eigeneListen.length >= EIGENE_LISTEN_MAX) {
        return { ok: false, fehler: `Du hast bereits ${EIGENE_LISTEN_MAX} eigene Listen angelegt - mehr geht mit einer Anmeldung (bis zu ${KONTO_LISTEN_MAX}).` };
    }

    const neueListe = { id: eigeneListeZufallsId(), kurzname, name, filme: [] };
    eigeneListen.push(neueListe);
    eigeneListenSchreiben(eigeneListen);
    listenKatalogNeuAufbauen();
    return { ok: true, listeId: neueListe.id };
}

async function eigeneListeUmbenennen(listeId, kurznameRoh, nameRoh) {
    const kurzname = (kurznameRoh || '').trim();
    const name = (nameRoh || '').trim();

    const liste = eigeneListeFinden(listeId);
    if (!liste) return { ok: false, fehler: 'Liste nicht gefunden.' };
    const sperrgrund = eigeneListeSperrgrund(liste);
    if (sperrgrund) return { ok: false, fehler: sperrgrund };

    const fehler = eigeneListeNamenPruefen(kurzname, name, listeId);
    if (fehler) return { ok: false, fehler };

    liste.kurzname = kurzname;
    liste.name = name;
    try {
        await eigeneListePersistieren(liste);
    } catch (err) {
        return { ok: false, fehler: 'Änderung konnte nicht gespeichert werden: ' + (err.message || err) };
    }
    return { ok: true };
}

// Löscht eine eigene Liste (lokal oder am Konto). War sie gerade aktiv,
// wird automatisch auf die erste verfügbare Liste gewechselt, damit die
// Seite nicht auf einer nicht mehr existierenden Liste hängen bleibt.
async function eigeneListeLoeschen(listeId) {
    const liste = eigeneListeFinden(listeId);
    if (!liste) return { ok: false, fehler: 'Liste nicht gefunden.' };
    const sperrgrund = eigeneListeSperrgrund(liste);
    if (sperrgrund) return { ok: false, fehler: sperrgrund };

    if (liste.herkunft === 'konto') {
        try {
            await window.kontoListeLoeschen(listeId);
        } catch (err) {
            return { ok: false, fehler: 'Liste konnte nicht gelöscht werden: ' + (err.message || err) };
        }
    } else {
        eigeneListenSchreiben(eigeneListenLesen().filter(l => l.id !== listeId));
    }

    const warAktiv = aktiveListeId === listeId;
    listenKatalogNeuAufbauen();
    if (warAktiv && VERFUEGBARE_LISTEN.length > 0) {
        await listeWechseln(VERFUEGBARE_LISTEN[0].id);
    }
    return { ok: true };
}

// --- Login-Abgleich lokaler Listen mit dem Konto (Issue #37) ---
// Wird von groups.js nach jedem erfolgreichen Laden der Konto-Listen
// aufgerufen. Prüft, ob rein lokale Listen unkompliziert automatisch
// hochgeladen werden können (kein Namenskonflikt, genug freie Plätze)
// oder ob der Nutzer entscheiden muss (siehe Antworten zu Issue #37:
// "Nutzer entscheiden lassen").
function listenAbgleichVorschlag() {
    const lokaleListen = eigeneListenLesen();
    const kontoListen = kontoListenCacheLesen();
    const kontoKurznamen = new Set(kontoListen.map(l => l.kurzname.trim().toLowerCase()));
    const kontoNamen = new Set(kontoListen.map(l => l.name.trim().toLowerCase()));

    const kandidaten = lokaleListen.map(l => ({
        id: l.id,
        kurzname: l.kurzname,
        name: l.name,
        anzahlFilme: l.filme.length,
        kollision: kontoKurznamen.has(l.kurzname.trim().toLowerCase())
                   || kontoNamen.has(l.name.trim().toLowerCase())
    }));

    const platzFrei = Math.max(0, KONTO_LISTEN_MAX - kontoListen.length);
    const automatischMoeglich = kandidaten.length > 0
        && kandidaten.every(k => !k.kollision)
        && kandidaten.length <= platzFrei;

    return { kandidaten, platzFrei, automatischMoeglich };
}
window.listenAbgleichVorschlag = listenAbgleichVorschlag;

// Lädt eine (vom Nutzer bestätigte) Auswahl lokaler Listen ins Konto
// hoch und entfernt sie danach aus dem rein lokalen Speicher. uploads:
// [{ id, kurzname, name }] - kurzname/name ggf. angepasst, um eine
// Namenskollision aufzulösen. Gibt die Anzahl tatsächlich hochgeladener
// Listen zurück.
async function listenAbgleichUebernehmen(uploads) {
    let hochgeladen = 0;
    for (const upload of uploads) {
        const original = eigeneListenLesen().find(l => l.id === upload.id);
        if (!original) continue;

        const neueListe = {
            id: original.id,
            kurzname: upload.kurzname.trim(),
            name: upload.name.trim(),
            filme: original.filme
        };
        try {
            await window.kontoListeAnlegen(neueListe);
        } catch (err) {
            console.warn('Liste konnte beim Abgleich nicht hochgeladen werden:', original.id, err);
            continue;
        }
        eigeneListenSchreiben(eigeneListenLesen().filter(l => l.id !== original.id));
        hochgeladen++;
    }
    listenKatalogNeuAufbauen();
    return hochgeladen;
}
window.listenAbgleichUebernehmen = listenAbgleichUebernehmen;

// Fügt einen Film per TMDB-Link zu einer eigenen Liste hinzu. Holt Titel/
// Jahr/Poster/Beschreibung live von TMDB - dieselben Daten, die auch
// posters/neuer-film.py für kuratierte Listen abfragt, hier aber ohne
// lokalen Poster-Download (das Poster bleibt ein TMDB-CDN-Link, siehe
// Technische Anforderungen aus Issue #35).
async function eigenerListeFilmHinzufuegen(listeId, tmdbLink, beschreibungModus, eigeneBeschreibung) {
    const tmdbId = extractTmdbId(tmdbLink);
    if (!tmdbId) {
        return { ok: false, fehler: 'Ungültiger TMDB-Link - bitte einen Link zu einem Film auf themoviedb.org einfügen.' };
    }

    const liste = eigeneListeFinden(listeId);
    if (!liste) return { ok: false, fehler: 'Liste nicht gefunden.' };
    const sperrgrund = eigeneListeSperrgrund(liste);
    if (sperrgrund) return { ok: false, fehler: sperrgrund };

    if (liste.filme.length >= EIGENE_LISTE_FILME_MAX) {
        return { ok: false, fehler: 'Niemand kann so viele Filme sehen 😉 Bitte eine neue Liste anlegen.' };
    }

    let daten;
    try {
        daten = await eigeneListeTmdbDetailsHolen(tmdbId);
    } catch (err) {
        return { ok: false, fehler: 'Film wurde bei TMDB nicht gefunden - bitte den Link prüfen.' };
    }

    const jahr = (daten.release_date || '').slice(0, 4) || '????';
    const titel = daten.title || daten.original_title || 'Unbekannter Titel';
    const filmId = eigeneFilmIdErzeugen(titel, jahr);

    if (liste.filme.some(f => f.id === filmId)) {
        return { ok: false, fehler: 'Dieser Film ist bereits in der Liste.' };
    }

    const poster = daten.poster_path ? `https://image.tmdb.org/t/p/w500${daten.poster_path}` : '';
    const desc = beschreibungModus === 'eigen'
        ? (eigeneBeschreibung || '').trim()
        : (daten.overview || '');

    liste.filme.push({ id: filmId, tmdb: tmdbLink, poster, desc });
    try {
        await eigeneListePersistieren(liste);
    } catch (err) {
        return { ok: false, fehler: 'Film konnte nicht gespeichert werden: ' + (err.message || err) };
    }
    return { ok: true };
}

async function eigenerFilmEntfernen(listeId, filmId) {
    const liste = eigeneListeFinden(listeId);
    if (!liste) return;
    if (eigeneListeSperrgrund(liste)) return; // Steuerelemente sind dafür ohnehin ausgeblendet
    liste.filme = liste.filme.filter(f => f.id !== filmId);
    try {
        await eigeneListePersistieren(liste);
    } catch (err) {
        console.warn('Film konnte nicht entfernt werden:', err);
        return;
    }
    ladeUndRendereAktiveListe();
}

// Für die Pfeiltasten auf Mobile: verschiebt einen Film um eine Position
// (richtung -1 = nach oben, +1 = nach unten).
async function eigenerFilmVerschieben(listeId, filmId, richtung) {
    const liste = eigeneListeFinden(listeId);
    if (!liste) return;
    if (eigeneListeSperrgrund(liste)) return;
    const index = liste.filme.findIndex(f => f.id === filmId);
    const zielIndex = index + richtung;
    if (index === -1 || zielIndex < 0 || zielIndex >= liste.filme.length) return;
    const [film] = liste.filme.splice(index, 1);
    liste.filme.splice(zielIndex, 0, film);
    try {
        await eigeneListePersistieren(liste);
    } catch (err) {
        console.warn('Reihenfolge konnte nicht gespeichert werden:', err);
        return;
    }
    ladeUndRendereAktiveListe();
}

function eigenerFilmHoch(listeId, filmId) { eigenerFilmVerschieben(listeId, filmId, -1); }
function eigenerFilmRunter(listeId, filmId) { eigenerFilmVerschieben(listeId, filmId, 1); }

// Für Drag & Drop auf Desktop: übernimmt eine komplett neue Reihenfolge
// (Liste von Film-IDs).
async function eigeneListeFilmeUmordnen(listeId, neueReihenfolgeIds) {
    const liste = eigeneListeFinden(listeId);
    if (!liste) return;
    if (eigeneListeSperrgrund(liste)) return;
    const nachId = Object.fromEntries(liste.filme.map(f => [f.id, f]));
    const neu = neueReihenfolgeIds.map(id => nachId[id]).filter(Boolean);
    if (neu.length !== liste.filme.length) return; // Sicherheitsnetz bei Inkonsistenz
    liste.filme = neu;
    try {
        await eigeneListePersistieren(liste);
    } catch (err) {
        console.warn('Reihenfolge konnte nicht gespeichert werden:', err);
    }
}

function eigeneKarteDragStart(event, filmId) {
    ziehenderFilmId = filmId;
    event.dataTransfer.effectAllowed = 'move';
}

function eigeneKarteDragOver(event) {
    event.preventDefault(); // notwendig, damit "drop" überhaupt feuert
}

async function eigeneKarteDrop(event, zielFilmId, listeId) {
    event.preventDefault();
    if (!ziehenderFilmId || ziehenderFilmId === zielFilmId) return;

    const karten = document.querySelectorAll('.container.content-wrapper .movie-card[data-movie-id]');
    const ids = Array.from(karten, k => k.dataset.movieId);
    const vonIndex = ids.indexOf(ziehenderFilmId);
    const zielIndex = ids.indexOf(zielFilmId);
    if (vonIndex === -1 || zielIndex === -1) return;

    ids.splice(zielIndex, 0, ids.splice(vonIndex, 1)[0]);
    ziehenderFilmId = null;
    // Bei Konto-Listen ist das Umordnen ein echter Firestore-Schreibzugriff -
    // erst nach dessen Abschluss neu rendern, sonst würde die Karte kurz auf
    // die alte Reihenfolge zurückspringen (Cache noch nicht aktualisiert).
    await eigeneListeFilmeUmordnen(listeId, ids);
    ladeUndRendereAktiveListe();
}

function sortierModusUmschalten() {
    sortierModusAktiv = !sortierModusAktiv;
    renderContent();
}

function eigenerFormularOeffnen() {
    eigenerFormularOffen = true;
    eigenerBeschreibungModus = 'tmdb';
    eigenerAusgewaehlterFilm = null;
    eigenerSucheErgebnisse = [];
    renderContent();
}

function eigenerFormularSchliessen() {
    eigenerFormularOffen = false;
    eigenerAusgewaehlterFilm = null;
    eigenerSucheErgebnisse = [];
    renderContent();
}

function eigeneBeschreibungModusSetzen(modus) {
    eigenerBeschreibungModus = modus;
    renderContent();
}

function eigenerFilmFehlerAnzeigen(text) {
    const el = document.getElementById('eigener-film-fehler');
    if (el) { el.textContent = text; el.style.display = 'block'; }
}

// Läuft bei jeder Eingabe im Suchfeld, aktualisiert aber gezielt nur den
// Ergebnis-Container per innerHTML statt renderContent() aufzurufen - ein
// voller Neuaufbau würde das Suchfeld ersetzen und damit bei jedem
// Tastendruck den Cursor/Fokus verlieren.
function eigenerFilmSucheEingabe(wert, listeId) {
    clearTimeout(eigenerSucheDebounceTimer);
    const suchtext = wert.trim();
    const container = document.getElementById('eigener-film-ergebnisse');
    if (!container) return;

    if (suchtext.length < 2) {
        eigenerSucheErgebnisse = [];
        container.innerHTML = '';
        return;
    }

    eigenerSucheDebounceTimer = setTimeout(async () => {
        container.innerHTML = '<p class="eigene-hinweis">Suche läuft...</p>';
        try {
            eigenerSucheErgebnisse = await eigeneListeTmdbSuchen(suchtext);
            container.innerHTML = renderEigenerSucheErgebnisse();
        } catch (e) {
            console.warn('TMDB-Suche fehlgeschlagen:', e);
            eigenerSucheErgebnisse = [];
            container.innerHTML = '<p class="eigene-fehler">Suche fehlgeschlagen - bitte später erneut versuchen.</p>';
        }
    }, 400);
}

function renderEigenerSucheErgebnisse() {
    if (eigenerSucheErgebnisse.length === 0) {
        return '<p class="eigene-hinweis">Keine Treffer gefunden.</p>';
    }
    return eigenerSucheErgebnisse.map((treffer, index) => `
        <div class="eigene-suche-treffer" onclick="eigenerFilmAuswaehlen(${index})">
            ${treffer.posterPfad
                ? `<img src="https://image.tmdb.org/t/p/w92${treffer.posterPfad}" alt="" class="eigene-suche-poster">`
                : '<div class="eigene-suche-poster eigene-suche-poster-leer"></div>'}
            <span>${escapeHtml(treffer.titel)}${treffer.jahr ? ` (${treffer.jahr})` : ''}</span>
        </div>
    `).join('');
}

function eigenerFilmAuswaehlen(index) {
    const treffer = eigenerSucheErgebnisse[index];
    if (!treffer) return;
    eigenerAusgewaehlterFilm = treffer;
    eigenerSucheErgebnisse = [];
    renderContent();
}

function eigenerFilmAuswahlZuruecksetzen() {
    eigenerAusgewaehlterFilm = null;
    eigenerSucheErgebnisse = [];
    renderContent();
}

async function eigenerFilmAbsenden(listeId) {
    const eigeneBeschreibung = document.getElementById('eigener-film-beschreibung')?.value || '';

    if (!eigenerAusgewaehlterFilm) {
        eigenerFilmFehlerAnzeigen('Bitte zuerst einen Film aus der Suche auswählen.');
        return;
    }

    const tmdbLink = `https://www.themoviedb.org/movie/${eigenerAusgewaehlterFilm.tmdbId}`;
    const ergebnis = await eigenerListeFilmHinzufuegen(listeId, tmdbLink, eigenerBeschreibungModus, eigeneBeschreibung);
    if (!ergebnis.ok) {
        eigenerFilmFehlerAnzeigen(ergebnis.fehler);
        return;
    }

    eigenerFormularOffen = false;
    eigenerAusgewaehlterFilm = null;
    eigenerSucheErgebnisse = [];
    await ladeUndRendereAktiveListe();
}

// Werkzeugleiste oberhalb der Filmkarten einer aktiven eigenen Liste:
// Film hinzufügen (mit Wahl der Beschreibungsquelle) und Sortier-Modus.
// Konto-Listen ohne Anmeldung/Internetverbindung sind nur lesbar - siehe
// eigeneListeSperrgrund (Issue #37).
function renderEigeneListeWerkzeuge(eigeneListe) {
    if (!eigeneListe.bearbeitbar) {
        return `<p class="eigene-hinweis eigene-gesperrt">🔒 ${escapeHtml(eigeneListe.sperrgrund)}</p>`;
    }

    const limitErreicht = eigeneListe.filme.length >= EIGENE_LISTE_FILME_MAX;

    const sucheBlock = eigenerAusgewaehlterFilm ? `
        <div class="eigene-suche-auswahl">
            ${eigenerAusgewaehlterFilm.posterPfad
                ? `<img src="https://image.tmdb.org/t/p/w92${eigenerAusgewaehlterFilm.posterPfad}" alt="" class="eigene-suche-poster">`
                : '<div class="eigene-suche-poster eigene-suche-poster-leer"></div>'}
            <span>${escapeHtml(eigenerAusgewaehlterFilm.titel)}${eigenerAusgewaehlterFilm.jahr ? ` (${eigenerAusgewaehlterFilm.jahr})` : ''}</span>
            <button class="gruppen-btn schmal grau" onclick="eigenerFilmAuswahlZuruecksetzen()">Ändern</button>
        </div>` : `
        <div class="gruppen-zeile">
            <input type="text" id="eigener-film-suche" placeholder="Filmtitel suchen..." oninput="eigenerFilmSucheEingabe(this.value, '${eigeneListe.id}')">
        </div>
        <div id="eigener-film-ergebnisse" class="eigene-suche-ergebnisse"></div>`;

    const formular = eigenerFormularOffen ? `
        <div class="eigene-formular">
            ${sucheBlock}
            <label class="gruppen-check">
                <input type="radio" name="eigene-beschreibung" value="tmdb" ${eigenerBeschreibungModus === 'tmdb' ? 'checked' : ''} onchange="eigeneBeschreibungModusSetzen('tmdb')">
                TMDB-Beschreibung übernehmen
            </label>
            <label class="gruppen-check">
                <input type="radio" name="eigene-beschreibung" value="eigen" ${eigenerBeschreibungModus === 'eigen' ? 'checked' : ''} onchange="eigeneBeschreibungModusSetzen('eigen')">
                Eigene Beschreibung schreiben
            </label>
            ${eigenerBeschreibungModus === 'eigen' ? `
            <div class="gruppen-zeile">
                <textarea id="eigener-film-beschreibung" placeholder="Kurze Beschreibung der Handlung..." rows="2" style="flex:1; resize:vertical;"></textarea>
            </div>` : ''}
            <div id="eigener-film-fehler" class="eigene-fehler" style="display:none;"></div>
            <button class="gruppen-btn schmal" onclick="eigenerFilmAbsenden('${eigeneListe.id}')">Hinzufügen</button>
            <button class="gruppen-btn schmal grau" onclick="eigenerFormularSchliessen()">Abbrechen</button>
        </div>` : '';

    const hinzufuegenButton = limitErreicht
        ? '<p class="eigene-hinweis">Niemand kann so viele Filme sehen 😉 Bitte eine neue Liste anlegen.</p>'
        : (eigenerFormularOffen ? '' : `<button class="gruppen-btn schmal" onclick="eigenerFormularOeffnen()">+ Film hinzufügen</button>`);

    const sortierButton = eigeneListe.filme.length > 1
        ? `<button class="gruppen-btn schmal grau" onclick="sortierModusUmschalten()">${sortierModusAktiv ? 'Fertig' : '↕ Reihenfolge ändern'}</button>`
        : '';

    // Teilen nur für Konto-Listen (Issue #39 setzt Stufe 3 voraus) - eine
    // rein lokale Liste ohne Anmeldung ist für andere technisch nicht
    // erreichbar.
    const anzahlGeteilt = (eigeneListe.geteiltInGruppen || []).length;
    const teilenButton = eigeneListe.herkunft === 'konto'
        ? `<button class="gruppen-btn schmal grau" onclick="teilenPanelUmschalten('${eigeneListe.id}')">👥 Teilen${anzahlGeteilt > 0 ? ` (${anzahlGeteilt})` : ''}</button>`
        : '';
    const teilenPanel = teilenPanelOffenFuer === eigeneListe.id ? renderTeilenPanel(eigeneListe) : '';

    return `<div class="eigene-werkzeuge">${hinzufuegenButton}${sortierButton}${teilenButton}${formular}${teilenPanel}</div>`;
}

// Baut eine Filmkarte für eine eigene Liste: dieselbe Karte wie bei
// kuratierten Listen (renderMovieCard), ergänzt um Entfernen-Button und,
// im Sortier-Modus, Drag&Drop (Desktop) bzw. Pfeiltasten (Mobile) -
// Umschaltpunkt ist dieselbe 768px-Grenze wie im responsiven CSS. Ist die
// Liste nicht bearbeitbar (Konto-Liste ohne Anmeldung/Internet), gibt es
// gar keine Steuerelemente - ganz normale Karte wie bei kuratierten Listen.
function renderEigenerFilmCard(movie, listeId, index, gesamt, bearbeitbar) {
    if (!bearbeitbar) return renderMovieCard(movie);

    const mobile = window.matchMedia('(max-width: 768px)').matches;
    const ziehbar = sortierModusAktiv && !mobile;

    // escapeAttr() schützt hier nur den HTML-Attribut-Rand (z. B. ein "
    // in movie.id), NICHT den eingebetteten JS-String innerhalb des
    // onclick-Handlers selbst - ein ' in movie.id würde nach dem
    // Entity-Decoding durch den Browser trotzdem als JS-String-Ende
    // interpretiert. Das ist hier bewusst hingenommen: diese Karten
    // gehören ausschließlich der eigenen, bearbeitbaren Liste (siehe
    // renderEigenerFilmCard: bearbeitbar=false rendert ohne diese
    // Werkzeuge), Angriffsfläche wäre also nur gegen den eigenen
    // Account via direktem Firestore-Schreibzugriff unter Umgehung der
    // App - kein Angriff auf andere Nutzer. Für einen vollständigen
    // Schutz auch dieses Randfalls müssten die onclick-Attribute auf
    // addEventListener + dataset umgestellt werden (siehe Issue #62).
    const attribute = ziehbar
        ? ` draggable="true" ondragstart="eigeneKarteDragStart(event, '${escapeAttr(movie.id)}')" ondragover="eigeneKarteDragOver(event)" ondrop="eigeneKarteDrop(event, '${escapeAttr(movie.id)}', '${escapeAttr(listeId)}')"`
        : '';

    const pfeile = (sortierModusAktiv && mobile) ? `
        <div class="eigene-pfeile" onclick="event.stopPropagation()">
            <button ${index === 0 ? 'disabled' : ''} onclick="eigenerFilmHoch('${escapeAttr(listeId)}', '${escapeAttr(movie.id)}')" aria-label="Nach oben verschieben">▲</button>
            <button ${index === gesamt - 1 ? 'disabled' : ''} onclick="eigenerFilmRunter('${escapeAttr(listeId)}', '${escapeAttr(movie.id)}')" aria-label="Nach unten verschieben">▼</button>
        </div>` : '';

    const werkzeugeHtml = `
        <button class="eigener-film-entfernen" onclick="event.stopPropagation(); eigenerFilmEntfernen('${escapeAttr(listeId)}', '${escapeAttr(movie.id)}')" aria-label="Film aus Liste entfernen">✕</button>
        ${pfeile}`;

    return renderMovieCard(movie, { attribute, werkzeugeHtml });
}

async function ladeUndRendereAktiveListe() {
    const container = document.querySelector('.container.content-wrapper');
    const eintrag = findeListeNachId(aktiveListeId);
    if (!eintrag) {
        container.innerHTML = buildErrorMessage(new Error('NO_VALID_DATA'));
        return;
    }

    try {
        let raw;
        if (eintrag.herkunft === 'geteilt') {
            // Geteilte Liste: immer frisch von Firestore laden statt den
            // möglicherweise veralteten Entdeckungs-Stand aus
            // geteilteListenLaden() zu übernehmen (Issue #39: "beim
            // Wechseln frisch nachgeladen").
            if (typeof window.geteilteListeEinzelnLaden !== 'function') {
                throw new Error('NO_VALID_DATA');
            }
            const frisch = await window.geteilteListeEinzelnLaden(eintrag.ownerUid, eintrag.id);
            if (!frisch) {
                throw new Error('NICHT_MEHR_GETEILT');
            }
            raw = [{ id: 'inhalt', title: frisch.name, navLabel: frisch.kurzname, movies: frisch.filme }];
        } else if (eintrag.eigene) {
            // Eigene Liste: Filme liegen bereits vollständig in localStorage
            // vor, kein Netzwerkzugriff nötig. Titel der Sektion entspricht
            // dem Listennamen (siehe validateMovieData: "title" ist
            // Pflicht) - renderContent/renderNav blenden die dadurch
            // eigentlich doppelte Überschrift für die Sektions-ID "inhalt"
            // gezielt aus.
            raw = [{ id: 'inhalt', title: eintrag.name, navLabel: eintrag.kurzname, movies: eintrag.filme }];
        } else {
            const response = await fetch(eintrag.datei);
            if (!response.ok) {
                const fehler = new Error('HTTP ' + response.status);
                fehler.datei = eintrag.datei;
                throw fehler;
            }
            try {
                raw = await response.json();
            } catch (parseErr) {
                const fehler = new Error('INVALID_JSON');
                fehler.datei = eintrag.datei;
                throw fehler;
            }
        }

        const { sections, skippedSections, skippedMovies } = validateMovieData(raw);

        if (sections.length === 0) {
            const fehler = new Error('NO_VALID_DATA');
            fehler.datei = eintrag.datei;
            throw fehler;
        }

        MOVIE_DATA = sections;
        renderNav();
        renderContent();

        if (skippedSections > 0 || skippedMovies > 0) {
            console.warn(
                `Hinweis: ${skippedSections} Sektion(en) und ${skippedMovies} Film(e) ` +
                'wurden wegen fehlerhafter Daten übersprungen. Details siehe Meldungen oben.'
            );
        }
    } catch (err) {
        console.error('Konnte Liste nicht laden:', eintrag.id, err);
        container.innerHTML = buildErrorMessage(err);
    }
}

async function fetchAndRender() {
    const container = document.querySelector('.container.content-wrapper');
    try {
        const response = await fetch('lists/manifest.json');
        if (!response.ok) {
            const fehler = new Error('HTTP ' + response.status);
            fehler.datei = 'lists/manifest.json';
            throw fehler;
        }
        const katalog = await response.json();

        if (!Array.isArray(katalog) || katalog.length === 0) {
            const fehler = new Error('NO_VALID_DATA');
            fehler.datei = 'lists/manifest.json';
            throw fehler;
        }

        KATALOG_LISTEN = katalog;
        listenKatalogNeuAufbauen();

        const gespeichert = aktiveListeIdLesen();
        aktiveListeId = (gespeichert && findeListeNachId(gespeichert))
            ? gespeichert
            : katalog[0].id;

        await ladeUndRendereAktiveListe();
    } catch (err) {
        console.error('Konnte Listen-Katalog nicht laden:', err);
        container.innerHTML = buildErrorMessage(err);
    }
}

function buildErrorMessage(err) {
    const wrap = (text) =>
        '<p style="text-align:center; padding: 40px 16px; line-height: 1.7;">' + text + '</p>';
    const datei = (err && err.datei) || 'lists/manifest.json';

    if (!navigator.onLine) {
        return wrap(
            'Keine Internetverbindung. Die Filmdaten konnten nicht geladen werden - ' +
            'bitte Verbindung prüfen und die Seite neu laden.'
        );
    }
    if (err && err.message === 'INVALID_JSON') {
        return wrap(
            `<code>${datei}</code> konnte nicht gelesen werden - die Datei ist ` +
            'vermutlich fehlerhaft (z.&nbsp;B. ein fehlendes oder überzähliges Komma). ' +
            'Details stehen in der Browser-Konsole.'
        );
    }
    if (err && err.message === 'NO_VALID_DATA') {
        return wrap(
            `<code>${datei}</code> enthält keine gültigen Einträge. ` +
            'Details stehen in der Browser-Konsole.'
        );
    }
    if (err && err.message === 'NICHT_MEHR_GETEILT') {
        return wrap(
            'Diese Liste ist nicht mehr mit dir geteilt oder wurde gelöscht - ' +
            'wähle über "Filmreihe wählen" eine andere Liste.'
        );
    }
    return wrap(
        'Filmdaten konnten nicht geladen werden. Läuft die Seite über ' +
        'http(s) (z.&nbsp;B. GitHub Pages oder einen lokalen Webserver) und ' +
        `liegt <code>${datei}</code> im selben Ordner wie diese Datei?`
    );
}

fetchAndRender();