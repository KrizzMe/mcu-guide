/* =====================================================================
   app.js - Datenhaltung, Rendering und Bewertungen
   ---------------------------------------------------------------------
   Zuständig für: Laden und Validieren von moviedata.json, Aufbau der
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

function renderNav() {
    const nav = document.getElementById('mobileNav');
    const closeButton = `<button class="nav-close" aria-label="Menü schließen">✕</button>`;
    const homeLink = `<a href="#top" class="nav-home" data-fill-key="nav-home" aria-label="Zur Startseite"><span class="nav-home-icon">🏠</span> Home <span class="nav-progress" data-progress-key="nav-home"></span></a>`;
    // Konto und Gruppen bilden zusammen einen Block, abgesetzt von Home
    // und von den Sektionen (Logik jeweils in groups.js).
    const kontoLink = `<a href="#" class="nav-konto" data-nav-konto title="Konto verwalten"><span class="nav-konto-icon">👤</span> ${escapeHtml(kontoNavLabel())}</a>`;
    const groupLink = `<a href="#" class="nav-groups" data-nav-groups title="Gruppen verwalten"><span class="nav-groups-icon">👥</span> ${escapeHtml(groupNavLabel())}</a>`;
    // Auf Desktop senkrechter Strich, auf Mobil waagerechte Linie (siehe CSS)
    const trenner = `<span class="nav-trenner" aria-hidden="true"></span>`;
    const links = MOVIE_DATA.map((section, i) =>
        `<a href="#${section.id}" data-section-id="${section.id}" data-fill-key="${section.id}">${i + 1}. ${escapeHtml(section.navLabel)} <span class="nav-progress" data-progress-key="${section.id}"></span></a>`
    ).join('');
    nav.innerHTML = closeButton + homeLink + trenner + kontoLink + groupLink + trenner + links;

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
    nav.querySelector('[data-nav-konto]').addEventListener('click', event => {
        event.preventDefault();
        closeSidebar();
        if (typeof window.openKontoPanel === 'function') {
            window.openKontoPanel();
        } else {
            console.warn('Kontoverwaltung noch nicht geladen.');
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
    return movie.runtime
        ? `<span class="movie-runtime"><span class="runtime-icon" aria-hidden="true">🎞️</span>${escapeHtml(movie.runtime)}</span>`
        : '';
}

function renderMovieMeta(movie) {
    const imdbLink = movie.imdb
        ? `<a href="${escapeHtml(movie.imdb)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" aria-label="${escapeHtml(movie.title)} auf IMDb ansehen"><img class="meta-icon" src="imdb.png" alt="IMDb" loading="lazy"></a>`
        : '';
    const tmdbLink = movie.tmdb
        ? `<a href="${escapeHtml(movie.tmdb)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" aria-label="${escapeHtml(movie.title)} auf TMDb ansehen"><img class="meta-icon" src="tmdb.png" alt="TMDb" loading="lazy"></a>`
        : '';
    return `<div class="movie-meta-left">${imdbLink}${tmdbLink}</div>`;
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

    const fremdeBewertungen = andere
        .map(m => ({ name: m.name, wert: (m.ratings && m.ratings[movieId] && m.ratings[movieId].value) || 0 }))
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

function renderMovieCard(movie) {
    const watchedClass = getRating(movie.id) > 0 ? ' watched' : '';
    return `
<div class="movie-card${watchedClass}" data-movie-id="${movie.id}" onclick="openOverlay(this)">
    <div class="movie-poster">
        <img src="${movie.poster}" alt="${escapeHtml(movie.title)}" loading="lazy" onerror="handlePosterError(this)">
    </div>
    <div class="movie-content">
        <div class="movie-title-row">
            <div class="movie-title">${escapeHtml(movie.title)}</div>
            ${renderMovieRuntime(movie)}
        </div>
        <div class="movie-desc">${escapeHtml(movie.desc)}</div>
        <div class="movie-meta-row">
            ${renderMovieMeta(movie)}
            ${renderRatingWidget(movie.id)}
        </div>
        ${renderGroupSlot(movie.id)}
    </div>
</div>`;
}

function renderContent() {
    const container = document.querySelector('.container.content-wrapper');
    const sectionsHtml = MOVIE_DATA.map(section => `
<h2 id="${section.id}">${escapeHtml(section.title)} <span class="section-count" data-section-id="${section.id}"></span></h2>
${section.movies.map(renderMovieCard).join('')}
    `).join('');
    container.innerHTML = sectionsHtml;
    updateProgress();
    updateGroupDisplay();   // falls Gruppendaten bereits vorliegen
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
        console.error('moviedata.json enthält kein Array auf oberster Ebene.');
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
            if (!movie.id || !movie.title) {
                console.warn(`Film ${mIdx + 1} in "${section.title}" übersprungen: "id" oder "title" fehlt.`, movie);
                result.skippedMovies++;
                return;
            }
            // Fehlende optionale Felder sind kein Grund zum Überspringen -
            // lieber den Film mit Lücke zeigen als gar nicht.
            validMovies.push({
                ...movie,
                desc: movie.desc || '',
                poster: movie.poster || '',
                runtime: movie.runtime || ''
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

async function fetchAndRender() {
    const container = document.querySelector('.container.content-wrapper');
    try {
        const response = await fetch('moviedata.json');
        if (!response.ok) throw new Error('HTTP ' + response.status);

        let raw;
        try {
            raw = await response.json();
        } catch (parseErr) {
            // JSON-Syntaxfehler getrennt behandeln - andere Ursache,
            // andere Lösung als ein fehlgeschlagener Download.
            throw new Error('INVALID_JSON');
        }

        const { sections, skippedSections, skippedMovies } = validateMovieData(raw);

        if (sections.length === 0) {
            throw new Error('NO_VALID_DATA');
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
        console.error('Konnte Filmdaten nicht laden:', err);
        container.innerHTML = buildErrorMessage(err);
    }
}

function buildErrorMessage(err) {
    const wrap = (text) =>
        '<p style="text-align:center; padding: 40px 16px; line-height: 1.7;">' + text + '</p>';

    if (!navigator.onLine) {
        return wrap(
            'Keine Internetverbindung. Die Filmdaten konnten nicht geladen werden - ' +
            'bitte Verbindung prüfen und die Seite neu laden.'
        );
    }
    if (err && err.message === 'INVALID_JSON') {
        return wrap(
            '<code>moviedata.json</code> konnte nicht gelesen werden - die Datei ist ' +
            'vermutlich fehlerhaft (z.&nbsp;B. ein fehlendes oder überzähliges Komma). ' +
            'Details stehen in der Browser-Konsole.'
        );
    }
    if (err && err.message === 'NO_VALID_DATA') {
        return wrap(
            'Die Filmdaten enthalten keine gültigen Einträge. ' +
            'Details stehen in der Browser-Konsole.'
        );
    }
    return wrap(
        'Filmdaten konnten nicht geladen werden. Läuft die Seite über ' +
        'http(s) (z.&nbsp;B. GitHub Pages oder einen lokalen Webserver) und ' +
        'liegt <code>moviedata.json</code> im selben Ordner wie diese Datei?'
    );
}

fetchAndRender();