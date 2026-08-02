/* =====================================================================
   groups.js - Gruppen, Anmeldung und geteilte Bewertungen
   ---------------------------------------------------------------------
   Wird als ES-Modul geladen (type="module"), da das Firebase-SDK nur so
   verfügbar ist. Alles, was von außen aufgerufen werden muss (Klicks in
   der Navigation), wird am Ende bewusst an window gehängt.

   Grundsatz: Die App funktioniert ohne Anmeldung und ohne Gruppe genau
   wie bisher. Bewertungen liegen weiterhin lokal (siehe app.js) - eine
   Gruppe dient ausschließlich dem Teilen.

   Mitgliedschaften werden LOKAL gemerkt. Grund: Die Zugriffsregeln
   erlauben es bewusst nicht, alle Gruppen zu durchsuchen, in denen man
   Mitglied ist - sonst könnte jeder fremde Gruppen auflisten. Der
   Nebeneffekt (Gerätewechsel = Mitgliedschaft weg) ist bekannt und wird
   in Issue #17 gelöst.
   ===================================================================== */

import { initializeApp }
    from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
    getAuth, onAuthStateChanged, signOut, signInAnonymously,
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
// Zustand und lokale Speicherung
// ---------------------------------------------------------------------

let aktuellerNutzer = null;   // Firebase-Nutzer oder null
let meineGruppen    = [];     // Gruppen, in denen ich Admin bin
let ladeVorgang     = false;
let einladung       = null;   // { groupId, inviteCode, name, locked } bei offener Einladung

const SPEICHER_EMAIL    = 'mcu-anmelde-email';
const SPEICHER_GRUPPEN  = 'mcu-gruppen';
const SPEICHER_AKTIV    = 'mcu-aktive-gruppe';
const RATING_PRAEFIX    = 'mcu-rating-';

function mitgliedschaftenLesen() {
    try {
        return JSON.parse(localStorage.getItem(SPEICHER_GRUPPEN) || '[]');
    } catch (e) {
        return [];
    }
}

function mitgliedschaftenSpeichern(liste) {
    try {
        localStorage.setItem(SPEICHER_GRUPPEN, JSON.stringify(liste));
    } catch (e) {
        console.warn('Mitgliedschaften konnten nicht gespeichert werden:', e);
    }
}

function mitgliedschaftMerken(groupId, groupName, memberName) {
    const liste = mitgliedschaftenLesen().filter(g => g.groupId !== groupId);
    liste.push({ groupId, groupName, memberName });
    mitgliedschaftenSpeichern(liste);
    aktiveGruppeSetzen(groupId);
}

function aktiveGruppeId() {
    return localStorage.getItem(SPEICHER_AKTIV) || null;
}

function aktiveGruppeSetzen(groupId) {
    if (groupId) localStorage.setItem(SPEICHER_AKTIV, groupId);
    else localStorage.removeItem(SPEICHER_AKTIV);
}

// Sammelt die lokal gespeicherten Bewertungen. Bewusst über die
// Speicher-Schlüssel statt über MOVIE_DATA, damit es unabhängig davon
// funktioniert, ob die Filmdaten schon geladen sind.
function lokaleBewertungen() {
    const ergebnis = {};
    const jetzt = Date.now();
    for (let i = 0; i < localStorage.length; i++) {
        const schluessel = localStorage.key(i);
        if (!schluessel || !schluessel.startsWith(RATING_PRAEFIX)) continue;
        const wert = parseInt(localStorage.getItem(schluessel) || '0', 10);
        if (!wert) continue;
        ergebnis[schluessel.slice(RATING_PRAEFIX.length)] = { value: wert, updatedAt: jetzt };
    }
    return ergebnis;
}

// ---------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------

function zufallsId(laenge) {
    const zeichen = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const werte = crypto.getRandomValues(new Uint8Array(laenge));
    return Array.from(werte, v => zeichen[v % zeichen.length]).join('');
}

function istEchtAngemeldet() {
    return !!aktuellerNutzer && !aktuellerNutzer.isAnonymous;
}

function sicher(text) {
    return typeof escapeHtml === 'function' ? escapeHtml(String(text)) : String(text);
}

function einladungsLink(groupId, inviteCode) {
    const basis = window.location.origin + window.location.pathname;
    return `${basis}?g=${encodeURIComponent(groupId)}&c=${encodeURIComponent(inviteCode)}`;
}

function adresszeileSaeubern() {
    const sauber = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, sauber);
}

// Stellt sicher, dass überhaupt jemand angemeldet ist. Für den Beitritt
// genügt eine anonyme Anmeldung - davon merkt der Nutzer nichts.
async function sicherstellenAngemeldet() {
    if (aktuellerNutzer) return aktuellerNutzer;
    const cred = await signInAnonymously(auth);
    aktuellerNutzer = cred.user;
    return aktuellerNutzer;
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
        localStorage.setItem(SPEICHER_EMAIL, email);
        meldung('Anmeldelink verschickt. Bitte im Postfach nachsehen ' +
                '(ggf. auch im Spam-Ordner) und den Link auf DIESEM Gerät öffnen.');
    } catch (err) {
        meldung('Link konnte nicht verschickt werden: ' + (err.code || err.message), true);
    }
}

async function anmeldungAusLinkAbschliessen() {
    if (!isSignInWithEmailLink(auth, window.location.href)) return;

    let email = localStorage.getItem(SPEICHER_EMAIL);
    if (!email) {
        email = window.prompt('Bitte die E-Mail-Adresse bestätigen, an die der Link ging:');
    }
    if (!email) return;

    try {
        await signInWithEmailLink(auth, email, window.location.href);
        localStorage.removeItem(SPEICHER_EMAIL);
        adresszeileSaeubern();
        oeffneGruppenFenster();
    } catch (err) {
        meldung('Anmeldung über den Link fehlgeschlagen: ' + (err.code || err.message), true);
    }
}

async function abmelden() {
    await signOut(auth);
    meineGruppen = [];
    zeichneFenster();
}

// ---------------------------------------------------------------------
// Gruppen anlegen und verwalten (Admin)
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
            ratings: lokaleBewertungen()
        });

        await setDoc(doc(db, 'users', aktuellerNutzer.uid),
                     { groupCount: increment(1) }, { merge: true });

        mitgliedschaftMerken(groupId, gruppenName.trim(), eigenerName.trim());
        await eigeneGruppenLaden();
        meldung('Gruppe "' + gruppenName.trim() + '" wurde angelegt und ist jetzt aktiv.');
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
        await navigator.clipboard.writeText(einladungsLink(groupId, code));
        meldung('Einladungslink kopiert - jetzt z. B. per Nachricht verschicken.');
    } catch (err) {
        meldung('Kopieren nicht möglich. Bitte "Link anzeigen" verwenden.', true);
    }
}

async function linkAnzeigen(groupId) {
    const feld = document.getElementById('link-' + groupId);
    if (!feld) return;
    if (!feld.value) {
        const code = await einladungsCodeHolen(groupId);
        if (!code) { meldung('Einladungscode nicht gefunden.', true); return; }
        feld.value = einladungsLink(groupId, code);
    }
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
// Beitreten über den Einladungslink
// ---------------------------------------------------------------------

function einladungAusAdresse() {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('g');
    const c = params.get('c');
    return (g && c) ? { groupId: g, inviteCode: c } : null;
}

// Prüft die Einladung und öffnet das Fenster im Beitritts-Modus.
async function einladungPruefen() {
    const daten = einladungAusAdresse();
    if (!daten) return;

    try {
        await sicherstellenAngemeldet();
        const snap = await getDoc(doc(db, 'groups', daten.groupId));
        if (!snap.exists()) {
            einladung = { ...daten, fehler: 'Diese Gruppe existiert nicht (mehr).' };
        } else {
            const g = snap.data();
            einladung = { ...daten, name: g.name, locked: !!g.locked };
        }
    } catch (err) {
        console.warn('Einladung konnte nicht geprüft werden:', err);
        einladung = { ...daten, fehler: 'Die Einladung konnte nicht geprüft werden.' };
    }

    adresszeileSaeubern();
    oeffneGruppenFenster();
}

async function beitreten(anzeigeName, bewertungenUebernehmen) {
    if (!einladung) return;
    if (!anzeigeName.trim()) {
        meldung('Bitte einen Anzeigenamen eingeben.', true);
        return;
    }

    try {
        const nutzer = await sicherstellenAngemeldet();
        await setDoc(doc(db, 'groups', einladung.groupId, 'members', nutzer.uid), {
            name: anzeigeName.trim(),
            inviteCode: einladung.inviteCode,
            joinedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ratings: bewertungenUebernehmen ? lokaleBewertungen() : {}
        });

        mitgliedschaftMerken(einladung.groupId, einladung.name || 'Gruppe', anzeigeName.trim());
        const name = einladung.name || 'die Gruppe';
        einladung = null;
        meldung('Du bist "' + name + '" beigetreten.');
        zeichneFenster();
    } catch (err) {
        console.error('Beitritt fehlgeschlagen:', err);
        if (err.code === 'permission-denied') {
            meldung('Beitritt abgelehnt. Der Einladungslink ist ungültig oder die ' +
                    'Gruppe wurde gesperrt.', true);
        } else {
            meldung('Beitritt fehlgeschlagen: ' + (err.code || err.message), true);
        }
    }
}

function einladungVerwerfen() {
    einladung = null;
    meldungLeeren();
    zeichneFenster();
}

function gruppeVerlassenLokal(groupId) {
    const liste = mitgliedschaftenLesen().filter(g => g.groupId !== groupId);
    mitgliedschaftenSpeichern(liste);
    if (aktiveGruppeId() === groupId) {
        aktiveGruppeSetzen(liste.length ? liste[0].groupId : null);
    }
    meldung('Gruppe aus der Übersicht entfernt.');
    zeichneFenster();
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

function abschnittEinladung() {
    if (!einladung) return '';

    if (einladung.fehler) {
        return `<div class="gruppen-einladung">
                    <div class="gruppen-untertitel">Einladung</div>
                    <p class="gruppen-hinweis">${sicher(einladung.fehler)}</p>
                    <button class="gruppen-btn grau" data-aktion="einladung-weg">Schließen</button>
                </div>`;
    }

    if (einladung.locked) {
        return `<div class="gruppen-einladung">
                    <div class="gruppen-untertitel">Einladung zu "${sicher(einladung.name)}"</div>
                    <p class="gruppen-hinweis">
                        Diese Gruppe ist gesperrt, ein Beitritt ist derzeit nicht möglich.
                        Bitte wende dich an die Person, die dich eingeladen hat.
                    </p>
                    <button class="gruppen-btn grau" data-aktion="einladung-weg">Schließen</button>
                </div>`;
    }

    const bereitsDrin = mitgliedschaftenLesen().some(g => g.groupId === einladung.groupId);
    const anzahl = Object.keys(lokaleBewertungen()).length;

    return `<div class="gruppen-einladung">
                <div class="gruppen-untertitel">Einladung zu "${sicher(einladung.name)}"</div>
                ${bereitsDrin ? '<p class="gruppen-hinweis">Du bist dieser Gruppe bereits beigetreten. Ein erneuter Beitritt aktualisiert nur deinen Anzeigenamen.</p>' : ''}
                <div class="gruppen-zeile">
                    <input type="text" id="beitritt-name" placeholder="Dein Anzeigename" maxlength="40">
                </div>
                ${anzahl > 0 ? `
                <label class="gruppen-check">
                    <input type="checkbox" id="beitritt-uebernehmen" checked>
                    Meine ${anzahl} vorhandene(n) Bewertung(en) mitnehmen
                </label>` : ''}
                <button class="gruppen-btn" data-aktion="beitreten">Gruppe beitreten</button>
                <button class="gruppen-btn grau" data-aktion="einladung-weg">Abbrechen</button>
            </div>`;
}

function abschnittMeineGruppen() {
    const liste = mitgliedschaftenLesen();
    if (liste.length === 0) return '';

    const aktiv = aktiveGruppeId();
    const optionen = liste.map(g =>
        `<option value="${sicher(g.groupId)}" ${g.groupId === aktiv ? 'selected' : ''}>
            ${sicher(g.groupName)} (als ${sicher(g.memberName)})
         </option>`).join('');

    const aktuelle = liste.find(g => g.groupId === aktiv) || liste[0];

    return `<div class="gruppen-block">
                <div class="gruppen-untertitel">Meine Gruppen</div>
                <p class="gruppen-hinweis">
                    Auf den Filmkarten werden die Bewertungen der hier ausgewählten Gruppe angezeigt.
                </p>
                <div class="gruppen-zeile">
                    <select id="gruppen-auswahl">${optionen}</select>
                </div>
                <button class="gruppen-btn schmal grau" data-aktion="verlassen" data-gid="${sicher(aktuelle.groupId)}">
                    Ausgewählte Gruppe verlassen
                </button>
            </div>`;
}

function abschnittAdmin() {
    if (!istEchtAngemeldet()) {
        return `
            <div class="gruppen-block">
                <div class="gruppen-untertitel">Eigene Gruppe erstellen</div>
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
                </div>
            </div>`;
    }

    const kopf = `
        <div class="gruppen-konto">
            Angemeldet als <strong>${sicher(aktuellerNutzer.email || 'unbekannt')}</strong>
            <button class="gruppen-link-btn" data-aktion="abmelden">abmelden</button>
        </div>`;

    const liste = meineGruppen.length === 0
        ? '<p class="gruppen-hinweis">Du verwaltest noch keine Gruppe.</p>'
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

    return `<div class="gruppen-block"><div class="gruppen-untertitel">Von mir verwaltet</div>
            ${kopf}${liste}${anlegen}</div>`;
}

function zeichneFenster() {
    const inhalt = document.getElementById('gruppen-inhalt');
    if (!inhalt) return;

    if (ladeVorgang) {
        inhalt.innerHTML = '<p class="gruppen-hinweis">Einen Moment...</p>';
        return;
    }

    const einleitung = (mitgliedschaftenLesen().length === 0 && !einladung)
        ? `<p class="gruppen-hinweis">
               Mit einer Gruppe siehst du, wie deine Familie dieselben Filme bewertet hat.
               Du bewertest weiterhin ganz normal auf den Filmkarten - die Gruppe zeigt
               zusätzlich die Bewertungen der anderen.
           </p>` : '';

    inhalt.innerHTML = einleitung + abschnittEinladung() + abschnittMeineGruppen() + abschnittAdmin();
}

function oeffneGruppenFenster() {
    const fenster = document.getElementById('gruppen-fenster');
    if (!fenster) return;
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

    if (aktion === 'schliessen')     schliesseGruppenFenster();
    if (aktion === 'google')         anmeldenMitGoogle();
    if (aktion === 'maillink')       anmeldeLinkSenden(document.getElementById('anmelde-email')?.value || '');
    if (aktion === 'abmelden')       abmelden();
    if (aktion === 'kopieren')       linkKopieren(gid);
    if (aktion === 'zeigen')         linkAnzeigen(gid);
    if (aktion === 'sperre')         sperreUmschalten(gid, ziel.dataset.wert === 'zu');
    if (aktion === 'einladung-weg')  einladungVerwerfen();
    if (aktion === 'verlassen')      gruppeVerlassenLokal(gid);
    if (aktion === 'beitreten') {
        beitreten(
            document.getElementById('beitritt-name')?.value || '',
            document.getElementById('beitritt-uebernehmen')?.checked !== false
        );
    }
    if (aktion === 'anlegen') {
        gruppeAnlegen(
            document.getElementById('neue-gruppe-name')?.value || '',
            document.getElementById('neue-gruppe-person')?.value || ''
        );
    }
}

// Auswahlliste löst kein Klick-Ereignis aus, deshalb getrennt behandelt.
function fensterAenderungen(event) {
    if (event.target.id === 'gruppen-auswahl') {
        aktiveGruppeSetzen(event.target.value);
        meldung('Aktive Gruppe gewechselt.');
        zeichneFenster();
    }
}

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------

const fenster = document.getElementById('gruppen-fenster');
fenster?.addEventListener('click', fensterKlicks);
fenster?.addEventListener('change', fensterAenderungen);

document.addEventListener('click', event => {
    if (event.target.id === 'gruppen-fenster') schliesseGruppenFenster();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') schliesseGruppenFenster();
});

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
einladungPruefen();

// Für andere Dateien erreichbar machen
window.openGroupPanel   = oeffneGruppenFenster;
window.closeGroupPanel  = schliesseGruppenFenster;
window.getAktiveGruppe  = aktiveGruppeId;
