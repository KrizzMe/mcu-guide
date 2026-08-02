/* =====================================================================
   groups.js - Gruppen, Anmeldung und geteilte Bewertungen
   ---------------------------------------------------------------------
   Wird als ES-Modul geladen (type="module"), da das Firebase-SDK nur so
   verfügbar ist. Alles, was von außen aufgerufen werden muss (Klicks in
   der Navigation), wird am Ende bewusst an window gehängt.

   Grundsatz: Die App funktioniert ohne Anmeldung und ohne Gruppe genau
   wie bisher. Bewertungen liegen weiterhin lokal (siehe app.js) - eine
   Gruppe dient ausschließlich dem Teilen.
   ===================================================================== */

import { initializeApp }
    from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
    getAuth, onAuthStateChanged, signOut,
    signInWithPopup, GoogleAuthProvider,
    sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
    getFirestore, doc, collection, setDoc, getDoc, getDocs,
    updateDoc, query, where, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyACH3RMgi1kiuWL2su67UXulWKZx509Kvc",
    authDomain: "mcuguide.firebaseapp.com",
    projectId: "mcuguide",
    storageBucket: "mcuguide.firebasestorage.app",
    messagingSenderId: "534939116065",
    appId: "1:534939116065:web:ed796f10335e307e5f7960"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ---------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------

let aktuellerNutzer = null;   // Firebase-Nutzer oder null
let meineGruppen    = [];     // Gruppen, in denen ich Admin bin
let ladeVorgang     = false;

const SPEICHER_EMAIL = 'mcu-anmelde-email';

// ---------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------

function zufallsId(laenge) {
    const zeichen = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const werte = crypto.getRandomValues(new Uint8Array(laenge));
    return Array.from(werte, v => zeichen[v % zeichen.length]).join('');
}

// Eine anonyme Anmeldung zählt nicht als "echte" Anmeldung - Gruppen
// anlegen darf nur, wer sich per Google oder E-Mail-Link angemeldet hat.
function istEchtAngemeldet() {
    return !!aktuellerNutzer && !aktuellerNutzer.isAnonymous;
}

function sicher(text) {
    // escapeHtml stammt aus app.js (klassisches Script, daher global)
    return typeof escapeHtml === 'function' ? escapeHtml(String(text)) : String(text);
}

function einladungsLink(groupId, inviteCode) {
    const basis = window.location.origin + window.location.pathname;
    return `${basis}?g=${encodeURIComponent(groupId)}&c=${encodeURIComponent(inviteCode)}`;
}

// ---------------------------------------------------------------------
// Anmeldung
// ---------------------------------------------------------------------

async function anmeldenMitGoogle() {
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
        if (err.code === 'auth/popup-closed-by-user') return;
        meldung('Anmeldung fehlgeschlagen: ' + (err.code || err.message), true);
    }
}

async function anmeldeLinkSenden(email) {
    if (!email || !email.includes('@')) {
        meldung('Bitte eine gültige E-Mail-Adresse eingeben.', true);
        return;
    }
    try {
        await sendSignInLinkToEmail(auth, email, {
            url: window.location.origin + window.location.pathname,
            handleCodeInApp: true
        });
        // Adresse merken, damit der Rückweg ohne erneute Eingabe klappt
        localStorage.setItem(SPEICHER_EMAIL, email);
        meldung('Anmeldelink verschickt. Bitte im Postfach nachsehen ' +
                '(ggf. auch im Spam-Ordner) und den Link auf DIESEM Gerät öffnen.');
    } catch (err) {
        meldung('Link konnte nicht verschickt werden: ' + (err.code || err.message), true);
    }
}

// Kehrt der Nutzer über den E-Mail-Link zurück, wird die Anmeldung hier
// abgeschlossen. Läuft einmalig beim Laden der Seite.
async function anmeldungAusLinkAbschliessen() {
    if (!isSignInWithEmailLink(auth, window.location.href)) return;

    let email = localStorage.getItem(SPEICHER_EMAIL);
    if (!email) {
        // Link wurde auf einem anderen Gerät geöffnet als angefordert
        email = window.prompt('Bitte die E-Mail-Adresse bestätigen, an die der Link ging:');
    }
    if (!email) return;

    try {
        await signInWithEmailLink(auth, email, window.location.href);
        localStorage.removeItem(SPEICHER_EMAIL);
        // Anmeldedaten aus der Adresszeile entfernen
        const sauber = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, sauber);
        oeffneGruppenFenster();
    } catch (err) {
        meldung('Anmeldung über den Link fehlgeschlagen: ' + (err.code || err.message), true);
    }
}

async function abmelden() {
    await signOut(auth);
    meineGruppen = [];
}

// ---------------------------------------------------------------------
// Gruppen
// ---------------------------------------------------------------------

async function eigeneGruppenLaden() {
    if (!istEchtAngemeldet()) { meineGruppen = []; return; }
    try {
        const q = query(collection(db, 'groups'), where('adminUid', '==', aktuellerNutzer.uid));
        const snap = await getDocs(q);
        meineGruppen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.warn('Gruppen konnten nicht geladen werden:', err);
        meineGruppen = [];
    }
}

async function gruppeAnlegen(gruppenName, eigenerName) {
    if (!istEchtAngemeldet()) {
        meldung('Zum Anlegen einer Gruppe ist eine Anmeldung nötig.', true);
        return;
    }
    if (!gruppenName.trim() || !eigenerName.trim()) {
        meldung('Bitte Gruppenname und deinen Namen ausfüllen.', true);
        return;
    }

    const groupId    = zufallsId(20);
    const inviteCode = zufallsId(24);

    try {
        // Reihenfolge ist wichtig: Die Regeln für das private Dokument und
        // für den Mitglieds-Eintrag prüfen jeweils das Gruppen-Dokument.
        await setDoc(doc(db, 'groups', groupId), {
            name: gruppenName.trim(),
            adminUid: aktuellerNutzer.uid,
            locked: false,
            createdAt: serverTimestamp()
        });

        await setDoc(doc(db, 'groups', groupId, 'private', 'config'), { inviteCode });

        // Der Admin ist selbst Teil der Gruppe - sonst würden seine
        // eigenen Bewertungen nicht mitgeteilt werden.
        await setDoc(doc(db, 'groups', groupId, 'members', aktuellerNutzer.uid), {
            name: eigenerName.trim(),
            inviteCode,
            joinedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ratings: {}
        });

        // Zähler für die 20-Gruppen-Grenze
        await setDoc(doc(db, 'users', aktuellerNutzer.uid),
                     { groupCount: increment(1) }, { merge: true });

        await eigeneGruppenLaden();
        meldung('Gruppe "' + gruppenName.trim() + '" wurde angelegt.');
        zeichneFenster();
    } catch (err) {
        console.error('Gruppe anlegen fehlgeschlagen:', err);
        meldung('Gruppe konnte nicht angelegt werden: ' + (err.code || err.message), true);
    }
}

async function einladungsCodeHolen(groupId) {
    const snap = await getDoc(doc(db, 'groups', groupId, 'private', 'config'));
    return snap.exists() ? snap.data().inviteCode : null;
}

async function linkKopieren(groupId) {
    try {
        const code = await einladungsCodeHolen(groupId);
        if (!code) { meldung('Einladungscode nicht gefunden.', true); return; }
        const link = einladungsLink(groupId, code);
        await navigator.clipboard.writeText(link);
        meldung('Einladungslink kopiert - jetzt z. B. per Nachricht verschicken.');
    } catch (err) {
        meldung('Kopieren nicht möglich. Link steht im Feld unter der Gruppe.', true);
    }
}

async function linkAnzeigen(groupId) {
    const feld = document.getElementById('link-' + groupId);
    if (!feld) return;
    if (feld.value) { feld.style.display = 'block'; feld.select(); return; }
    const code = await einladungsCodeHolen(groupId);
    if (!code) { meldung('Einladungscode nicht gefunden.', true); return; }
    feld.value = einladungsLink(groupId, code);
    feld.style.display = 'block';
    feld.select();
}

async function sperreUmschalten(groupId, gesperrt) {
    try {
        await updateDoc(doc(db, 'groups', groupId), { locked: gesperrt });
        await eigeneGruppenLaden();
        meldung(gesperrt ? 'Gruppe gesperrt - kein Beitritt mehr möglich.'
                         : 'Gruppe entsperrt - Beitritt wieder möglich.');
        zeichneFenster();
    } catch (err) {
        meldung('Änderung fehlgeschlagen: ' + (err.code || err.message), true);
    }
}

// ---------------------------------------------------------------------
// Oberfläche
// ---------------------------------------------------------------------

function meldung(text, istFehler) {
    const el = document.getElementById('gruppen-meldung');
    if (!el) return;
    el.textContent = text;
    el.className = 'gruppen-meldung' + (istFehler ? ' fehler' : ' erfolg');
    el.style.display = 'block';
}

function meldungLeeren() {
    const el = document.getElementById('gruppen-meldung');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function zeichneFenster() {
    const inhalt = document.getElementById('gruppen-inhalt');
    if (!inhalt) return;

    if (ladeVorgang) {
        inhalt.innerHTML = '<p class="gruppen-hinweis">Einen Moment...</p>';
        return;
    }

    if (!istEchtAngemeldet()) {
        inhalt.innerHTML = `
            <p class="gruppen-hinweis">
                Mit einer Gruppe siehst du, wie deine Familie dieselben Filme bewertet hat.
                Du bewertest weiterhin ganz normal auf den Filmkarten - die Gruppe zeigt
                zusätzlich die Bewertungen der anderen.
            </p>
            <p class="gruppen-hinweis">
                Zum <strong>Erstellen</strong> einer Gruppe ist eine Anmeldung nötig.
                Wer nur <strong>beitreten</strong> möchte, braucht keine Anmeldung -
                dafür genügt der Einladungslink.
            </p>
            <button class="gruppen-btn" data-aktion="google">Mit Google anmelden</button>
            <div class="gruppen-trenner">oder per E-Mail-Link ohne Passwort</div>
            <div class="gruppen-zeile">
                <input type="email" id="anmelde-email" placeholder="deine@email.de" autocomplete="email">
                <button class="gruppen-btn schmal" data-aktion="maillink">Link senden</button>
            </div>`;
        return;
    }

    const kopf = `
        <div class="gruppen-konto">
            Angemeldet als <strong>${sicher(aktuellerNutzer.email || 'unbekannt')}</strong>
            <button class="gruppen-link-btn" data-aktion="abmelden">abmelden</button>
        </div>`;

    const liste = meineGruppen.length === 0
        ? '<p class="gruppen-hinweis">Du hast noch keine Gruppe angelegt.</p>'
        : meineGruppen.map(g => `
            <div class="gruppen-eintrag">
                <div class="gruppen-eintrag-kopf">
                    <span class="gruppen-name">${sicher(g.name)}</span>
                    ${g.locked ? '<span class="gruppen-status">gesperrt</span>' : ''}
                </div>
                <div class="gruppen-aktionen">
                    <button class="gruppen-btn schmal" data-aktion="kopieren" data-gid="${g.id}">Einladungslink kopieren</button>
                    <button class="gruppen-btn schmal grau" data-aktion="zeigen" data-gid="${g.id}">Link anzeigen</button>
                    <button class="gruppen-btn schmal grau" data-aktion="sperre" data-gid="${g.id}" data-wert="${g.locked ? 'auf' : 'zu'}">
                        ${g.locked ? 'Entsperren' : 'Sperren'}
                    </button>
                </div>
                <input type="text" class="gruppen-linkfeld" id="link-${g.id}" readonly style="display:none">
            </div>`).join('');

    const anlegen = `
        <div class="gruppen-anlegen">
            <div class="gruppen-untertitel">Neue Gruppe anlegen</div>
            <div class="gruppen-zeile">
                <input type="text" id="neue-gruppe-name" placeholder="Name der Gruppe, z. B. Familie" maxlength="60">
            </div>
            <div class="gruppen-zeile">
                <input type="text" id="neue-gruppe-person" placeholder="Dein Anzeigename" maxlength="40">
            </div>
            <button class="gruppen-btn" data-aktion="anlegen">Gruppe erstellen</button>
        </div>`;

    inhalt.innerHTML = kopf + liste + anlegen;
}

function oeffneGruppenFenster() {
    const fenster = document.getElementById('gruppen-fenster');
    if (!fenster) return;
    meldungLeeren();
    fenster.classList.add('offen');
    zeichneFenster();
    if (istEchtAngemeldet() && meineGruppen.length === 0) {
        eigeneGruppenLaden().then(zeichneFenster);
    }
}

function schliesseGruppenFenster() {
    const fenster = document.getElementById('gruppen-fenster');
    if (fenster) fenster.classList.remove('offen');
}

// Ein einziger Klick-Handler für das ganze Fenster - robuster als viele
// einzelne Listener, da der Inhalt immer wieder neu aufgebaut wird.
function fensterKlicks(event) {
    const ziel = event.target.closest('[data-aktion]');
    if (!ziel) return;
    const aktion = ziel.dataset.aktion;
    const gid    = ziel.dataset.gid;

    if (aktion === 'schliessen') schliesseGruppenFenster();
    if (aktion === 'google')   anmeldenMitGoogle();
    if (aktion === 'maillink') anmeldeLinkSenden(document.getElementById('anmelde-email')?.value || '');
    if (aktion === 'abmelden') abmelden();
    if (aktion === 'kopieren') linkKopieren(gid);
    if (aktion === 'zeigen')   linkAnzeigen(gid);
    if (aktion === 'sperre')   sperreUmschalten(gid, ziel.dataset.wert === 'zu');
    if (aktion === 'anlegen') {
        gruppeAnlegen(
            document.getElementById('neue-gruppe-name')?.value || '',
            document.getElementById('neue-gruppe-person')?.value || ''
        );
    }
}

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------

document.addEventListener('click', event => {
    if (event.target.id === 'gruppen-fenster') schliesseGruppenFenster();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') schliesseGruppenFenster();
});
document.getElementById('gruppen-fenster')?.addEventListener('click', fensterKlicks);

onAuthStateChanged(auth, async nutzer => {
    aktuellerNutzer = nutzer;
    if (istEchtAngemeldet()) {
        ladeVorgang = true;
        zeichneFenster();
        await eigeneGruppenLaden();
        ladeVorgang = false;
    }
    zeichneFenster();
});

anmeldungAusLinkAbschliessen();

// Für die Navigation aus app.js erreichbar machen
window.openGroupPanel  = oeffneGruppenFenster;
window.closeGroupPanel = schliesseGruppenFenster;
