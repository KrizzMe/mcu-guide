/* =====================================================================
   ui.js - Bedienelemente der Oberfläche
   ---------------------------------------------------------------------
   Zuständig für: Poster-Overlay (Großansicht), Navigations-Drawer auf
   Mobilgeräten inkl. Wischgeste und Escape-Taste.

   Wird VOR app.js geladen, da dessen renderNav() beim Aufbau der
   Navigation direkt auf toggleSidebar/closeSidebar zugreift.
   ===================================================================== */

function openOverlay(cardElement) {
    const imgElement = cardElement.querySelector('.movie-poster img');
    if (!imgElement) return;

    const overlay = document.getElementById('poster-overlay');
    const overlayImg = document.getElementById('overlay-img');
    overlayImg.src = imgElement.src;
    overlayImg.style.display = ''; // Poster sichtbar - Standardfall beim Antippen der Karte
    overlay.style.display = 'flex';

    const trailerBereich = document.getElementById('trailer-bereich');
    if (trailerBereich) trailerBereich.innerHTML = '';
}

// Wird vom "🎬 Trailer"-Button auf der Filmkarte aufgerufen: zeigt NUR
// den Trailer, kein Poster daneben - dafür wird dasselbe Overlay
// genutzt (Hintergrund, Schließen-Button), nur das Poster-Bild bleibt
// versteckt.
function trailerVonKarteOeffnen(buttonElement, event) {
    event.stopPropagation(); // verhindert, dass die Karte zusätzlich ihr eigenes openOverlay auslöst

    const overlay = document.getElementById('poster-overlay');
    const overlayImg = document.getElementById('overlay-img');
    overlayImg.style.display = 'none';
    overlay.style.display = 'flex';

    const tmdbId = buttonElement.dataset.tmdbId;
    if (tmdbId) trailerAnzeigen(tmdbId, event);
}

// Lädt den Trailer nach und ersetzt den Inhalt des Trailer-Bereichs durch
// den YouTube-Player (datenschutzfreundliche Adresse youtube-nocookie.com).
async function trailerAnzeigen(tmdbId, event) {
    event.stopPropagation();
    const bereich = document.getElementById('trailer-bereich');
    bereich.innerHTML = '<p class="trailer-status">Lade Trailer...</p>';

    const trailer = await trailerLaden(tmdbId);

    if (!trailer) {
        bereich.innerHTML = '<p class="trailer-status">Kein Trailer gefunden.</p>';
        return;
    }

    bereich.innerHTML = `
        <div class="trailer-player">
            <iframe
                src="https://www.youtube-nocookie.com/embed/${trailer.key}?rel=0"
                title="Trailer"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen>
            </iframe>
        </div>`;
}

function closeOverlay() {
    const overlay = document.getElementById('poster-overlay');
    overlay.style.display = 'none';
    // Player aus dem DOM entfernen, statt nur zu verstecken - sonst
    // würde ein laufender Trailer im Hintergrund weiterspielen.
    const trailerBereich = document.getElementById('trailer-bereich');
    if (trailerBereich) trailerBereich.innerHTML = '';
    // Sichtbarkeit zurücksetzen, damit ein Klick auf die Karte beim
    // nächsten Mal garantiert wieder das Poster zeigt, unabhängig davon,
    // wie das Overlay zuletzt geöffnet wurde.
    const overlayImg = document.getElementById('overlay-img');
    if (overlayImg) overlayImg.style.display = '';
}

// ESC schließt Poster-Overlay bzw. Navigations-Drawer
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeOverlay();
        closeSidebar();
    }
});

// Funktion zum Ein- und Ausklappen des Navigations-Drawers auf Mobile
function toggleSidebar() {
    const sidebar = document.getElementById('mobileNav');
    const backdrop = document.getElementById('navBackdrop');
    const toggleBtn = document.getElementById('navToggle');
    const isOpen = sidebar.classList.toggle('open');
    backdrop.classList.toggle('open', isOpen);
    toggleBtn.classList.toggle('open', isOpen);
    toggleBtn.setAttribute('aria-label', isOpen ? 'Menü schließen' : 'Menü öffnen');
}

function closeSidebar() {
    const sidebar = document.getElementById('mobileNav');
    if (sidebar.classList.contains('open')) {
        toggleSidebar();
    }
}

// --- Automatisches Vollbild beim Drehen ins Querformat (Trailer) ---
// Nur wirksam, solange der Trailer-Player offen ist. Manche Browser
// (v. a. Chrome/Android) erlauben requestFullscreen() ausdrücklich bei
// einer Ausrichtungsänderung, auch ohne direkte Berührung in diesem
// Moment. iOS Safari zieht hier deutlich enger - dort klappt es
// möglicherweise nicht zuverlässig. Schlägt es fehl, bleibt der
// reguläre Vollbild-Knopf im YouTube-Player selbst als Rückfalloption
// erhalten, es passiert einfach nichts weiter.
function aktivenTrailerIframe() {
    const bereich = document.getElementById('trailer-bereich');
    return bereich ? bereich.querySelector('iframe') : null;
}

function orientierungGeaendert() {
    const iframe = aktivenTrailerIframe();
    if (!iframe) return; // kein Trailer offen - nichts zu tun

    const istQuer = window.matchMedia('(orientation: landscape)').matches;

    if (istQuer && !document.fullscreenElement) {
        iframe.requestFullscreen().catch(() => {
            // Wird u. a. auf iOS Safari abgelehnt - dann bleibt der
            // Vollbild-Knopf im Player selbst die Alternative.
        });
    } else if (!istQuer && document.fullscreenElement === iframe) {
        document.exitFullscreen().catch(() => {});
    }
}

if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', orientierungGeaendert);
} else {
    window.addEventListener('orientationchange', orientierungGeaendert);
}

// Touch-Gestenerkennung für Wischfunktion (Swipe)
let touchStartX = 0;
let touchEndX = 0;

document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
}, false);

document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
}, false);

function handleSwipe() {
    const sidebar = document.getElementById('mobileNav');
    const swipeDistance = touchEndX - touchStartX;

    // Wenn nach rechts gewischt wird (und Wischstrecke > 70px war) -> Menü öffnen
    if (swipeDistance > 70 && !sidebar.classList.contains('open')) {
        toggleSidebar();
    }
    // Wenn nach links gewischt wird (und Wischstrecke < -70px war) -> Menü schließen
    else if (swipeDistance < -70 && sidebar.classList.contains('open')) {
        toggleSidebar();
    }
}

