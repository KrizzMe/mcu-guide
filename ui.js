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
    overlay.style.display = 'flex';
}

function closeOverlay() {
    const overlay = document.getElementById('poster-overlay');
    overlay.style.display = 'none';
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

