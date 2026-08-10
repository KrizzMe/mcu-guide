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
    signInWithPopup, GoogleAuthProvider, reauthenticateWithPopup, deleteUser,
    sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
    getFirestore, doc, collection, setDoc, getDoc, getDocs,
    deleteDoc, updateDoc, query, where, serverTimestamp, increment
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

// Welche Ansicht das Fenster gerade zeigt:
// 'gruppen' | 'konto' | 'datenschutz' | 'infos' | 'listen'
// | 'loeschen-hinweis' | 'loeschen-admin' | 'loeschen-final'
let ansicht = 'gruppen';

// Ansicht, aus der die Datenschutzhinweise geöffnet wurden - damit
// "Zurück" wieder dort landet (Login, Profil oder Fußzeile).
let vorherigeAnsicht = 'konto';

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

// Hält den lokal gemerkten Gruppennamen (Grundlage für "Meine Gruppen"
// und die Beschriftung in der Navigation) mit einer Umbenennung durch
// den Admin synchron, ohne auf den nächsten Server-Abgleich zu warten.
function mitgliedschaftGruppennameAktualisieren(groupId, neuerName) {
    const liste = mitgliedschaftenLesen();
    const eintrag = liste.find(g => g.groupId === groupId);
    if (!eintrag) return;
    eintrag.groupName = neuerName;
    mitgliedschaftenSpeichern(liste);
    navBeschriftungAktualisieren();
}

function aktiveGruppeId() {
    return localStorage.getItem(SPEICHER_AKTIV) || null;
}

function aktiveGruppeSetzen(groupId) {
    if (groupId) localStorage.setItem(SPEICHER_AKTIV, groupId);
    else localStorage.removeItem(SPEICHER_AKTIV);
    navBeschriftungAktualisieren();
}

// Name der aktiven Gruppe, für die Beschriftung in der Navigation.
function aktiveGruppeName() {
    const id = aktiveGruppeId();
    if (!id) return null;
    const eintrag = mitgliedschaftenLesen().find(g => g.groupId === id);
    return eintrag ? eintrag.groupName : null;
}

// app.js baut die Navigation auf, bevor dieses Modul geladen ist -
// deshalb Beschriftungen nachträglich melden.
function navBeschriftungAktualisieren() {
    if (typeof window.onAktiveGruppeGeaendert === 'function') {
        window.onAktiveGruppeGeaendert();
    }
    if (typeof window.onKontoStatusGeaendert === 'function') {
        window.onKontoStatusGeaendert();
    }
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

// Firebase stellt eine gespeicherte Anmeldung erst nach kurzer Zeit
// wieder her. Ohne dieses Warten würde beim Laden der Seite sofort eine
// NEUE anonyme Kennung erzeugt - die wäre kein Mitglied der Gruppe und
// bekäme keinen Zugriff.
let ersteAuthPruefung = null;

function authBereit() {
    if (!ersteAuthPruefung) {
        ersteAuthPruefung = new Promise(resolve => {
            const stop = onAuthStateChanged(auth, nutzer => {
                stop();
                resolve(nutzer);
            });
        });
    }
    return ersteAuthPruefung;
}

// Stellt sicher, dass überhaupt jemand angemeldet ist. Für den Beitritt
// genügt eine anonyme Anmeldung - davon merkt der Nutzer nichts.
async function sicherstellenAngemeldet() {
    const wiederhergestellt = await authBereit();
    if (aktuellerNutzer) return aktuellerNutzer;
    if (wiederhergestellt) {
        aktuellerNutzer = wiederhergestellt;
        return aktuellerNutzer;
    }
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
        await mitgliedschaftenErgaenzen();
    } catch (err) {
        console.warn('Gruppen konnten nicht geladen werden:', err);
        meineGruppen = [];
    }
}

// Selbst verwaltete Gruppen, die lokal noch nicht als Mitgliedschaft
// vermerkt sind, werden ergänzt. Das greift in zwei Fällen: bei Gruppen
// aus einer früheren Fassung der App und - praktischer - wenn sich der
// Admin auf einem neuen Gerät anmeldet.
async function mitgliedschaftenErgaenzen() {
    const bekannt = new Set(mitgliedschaftenLesen().map(g => g.groupId));
    let ergaenzt = 0;

    for (const gruppe of meineGruppen) {
        if (bekannt.has(gruppe.id)) continue;
        try {
            const eigenerEintrag = await getDoc(
                doc(db, 'groups', gruppe.id, 'members', aktuellerNutzer.uid));
            if (!eigenerEintrag.exists()) continue;

            const liste = mitgliedschaftenLesen();
            liste.push({
                groupId: gruppe.id,
                groupName: gruppe.name,
                memberName: eigenerEintrag.data().name || 'Ich'
            });
            mitgliedschaftenSpeichern(liste);
            if (!aktiveGruppeId()) aktiveGruppeSetzen(gruppe.id);
            ergaenzt++;
        } catch (err) {
            console.warn('Mitgliedschaft für ' + gruppe.id + ' nicht ermittelbar:', err);
        }
    }

    if (ergaenzt > 0) {
        console.info(ergaenzt + ' eigene Gruppe(n) in die Übersicht übernommen.');
        gruppeAbgleichen().then(zeichneFenster);
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

// Erzeugt einen neuen Einladungscode. Bestehende Mitglieder bleiben
// unberührt und können weiter bewerten - die Zugriffsregeln vergleichen
// beim Aktualisieren nur gegen den im eigenen Eintrag gespeicherten
// Code, nicht gegen den aktuellen Gruppencode. Ungültig wird also
// ausschließlich der alte Einladungslink für NEUE Beitritte.
async function linkErneuern(groupId) {
    const bestaetigt = window.confirm(
        'Neuen Einladungslink erzeugen?\n\n' +
        'Der bisherige Link funktioniert danach nicht mehr. ' +
        'Wer bereits in der Gruppe ist, bleibt drin und kann weiter bewerten.'
    );
    if (!bestaetigt) return;

    try {
        const neuerCode = zufallsId(24);
        await setDoc(doc(db, 'groups', groupId, 'private', 'config'),
                     { inviteCode: neuerCode });

        // Ein eventuell angezeigtes Linkfeld enthält jetzt den alten Wert
        const feld = document.getElementById('link-' + groupId);
        if (feld) { feld.value = ''; feld.style.display = 'none'; }

        meldung('Neuer Einladungslink erzeugt. Der alte Link ist ab sofort ungültig.');
        zeichneFenster();
    } catch (err) {
        meldung('Link konnte nicht erneuert werden: ' + (err.code || err.message), true);
    }
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

// Nur der Admin sieht die Schaltfläche dafür (Issue #43). Die Zugriffs-
// regeln erlauben ausschließlich ihm das Ändern von groups/{groupId}.name.
async function gruppeUmbenennen(groupId, alterName) {
    const neu = window.prompt('Neuer Gruppenname:', alterName);
    if (neu === null) return;
    if (!neu.trim() || neu.trim().length > 60) {
        meldung('Der Gruppenname muss zwischen 1 und 60 Zeichen lang sein.', true);
        return;
    }

    const gruppenName = neu.trim();
    try {
        await updateDoc(doc(db, 'groups', groupId), { name: gruppenName });
        mitgliedschaftGruppennameAktualisieren(groupId, gruppenName);
        meldung('Gruppenname geändert.');
        await eigeneGruppenLaden();
        zeichneFenster();
    } catch (err) {
        meldung('Umbenennen fehlgeschlagen: ' + (err.code || err.message), true);
    }
}

// ---------------------------------------------------------------------
// Mitgliederverwaltung (nur Admin, Issue #17)
// ---------------------------------------------------------------------

let verwalteteMitglieder = {};   // { groupId: [{uid, name, anzahlBewertungen}] }
let offeneVerwaltung     = null; // groupId, deren Mitgliederliste aufgeklappt ist

async function mitgliederVerwaltenUmschalten(groupId) {
    if (offeneVerwaltung === groupId) {
        offeneVerwaltung = null;
        zeichneFenster();
        return;
    }
    offeneVerwaltung = groupId;
    zeichneFenster();

    try {
        const snap = await getDocs(collection(db, 'groups', groupId, 'members'));
        verwalteteMitglieder[groupId] = snap.docs.map(d => ({
            uid: d.id,
            name: d.data().name || 'Unbekannt',
            anzahlBewertungen: Object.values(d.data().ratings || {})
                .filter(r => r && r.value > 0).length
        }));
        zeichneFenster();
    } catch (err) {
        meldung('Mitglieder konnten nicht geladen werden: ' + (err.code || err.message), true);
    }
}

async function mitgliedUmbenennen(groupId, uid, alterName) {
    const neu = window.prompt('Neuer Anzeigename:', alterName);
    if (neu === null) return;
    if (!neu.trim() || neu.trim().length > 40) {
        meldung('Der Name muss zwischen 1 und 40 Zeichen lang sein.', true);
        return;
    }
    try {
        await updateDoc(doc(db, 'groups', groupId, 'members', uid), { name: neu.trim() });
        meldung('Name geändert.');
        await mitgliederNeuLaden(groupId);
    } catch (err) {
        meldung('Umbenennen fehlgeschlagen: ' + (err.code || err.message), true);
    }
}

async function mitgliedEntfernen(groupId, uid, name) {
    const sicherheitsfrage = window.confirm(
        '"' + name + '" wirklich aus der Gruppe entfernen?\n\n' +
        'Die Bewertungen dieser Person werden dabei gelöscht und lassen sich ' +
        'nicht wiederherstellen. Für einen Gerätewechsel bitte stattdessen ' +
        'einen Wiedereinstiegs-Link erzeugen.'
    );
    if (!sicherheitsfrage) return;

    try {
        await deleteDoc(doc(db, 'groups', groupId, 'members', uid));
        meldung('"' + name + '" wurde entfernt.');
        await mitgliederNeuLaden(groupId);
        gruppeAbgleichen().then(zeichneFenster);
    } catch (err) {
        meldung('Entfernen fehlgeschlagen: ' + (err.code || err.message), true);
    }
}

// Verschiebt den Platz eines Mitglieds in ein Übergabe-Dokument und
// erzeugt daraus einen persönlichen Wiedereinstiegs-Link. Bewertungen
// gehen dabei nicht verloren - sie wandern mit und kommen beim Einlösen
// im neuen Eintrag wieder an.
async function wiedereinstiegErzeugen(groupId, uid, name) {
    const bestaetigt = window.confirm(
        'Wiedereinstiegs-Link für "' + name + '" erzeugen?\n\n' +
        'Der bisherige Platz wird dabei freigegeben. Auf dem ALTEN Gerät ist ' +
        'die Gruppe danach nicht mehr verfügbar. Bewertungen bleiben erhalten ' +
        'und sind nach dem Öffnen des Links auf dem neuen Gerät wieder da.'
    );
    if (!bestaetigt) return;

    try {
        const alterEintrag = await getDoc(doc(db, 'groups', groupId, 'members', uid));
        if (!alterEintrag.exists()) { meldung('Mitglied nicht gefunden.', true); return; }
        const daten = alterEintrag.data();

        const claimCode = zufallsId(24);
        await setDoc(doc(db, 'groups', groupId, 'claims', claimCode), {
            name: daten.name || name,
            inviteCode: daten.inviteCode || '',
            ratings: daten.ratings || {},
            createdAt: serverTimestamp()
        });

        // Erst nach erfolgreicher Sicherung den alten Platz freigeben
        await deleteDoc(doc(db, 'groups', groupId, 'members', uid));

        const link = window.location.origin + window.location.pathname +
                     '?g=' + encodeURIComponent(groupId) +
                     '&claim=' + encodeURIComponent(claimCode);

        const feld = document.getElementById('link-' + groupId);
        if (feld) { feld.value = link; feld.style.display = 'block'; feld.select(); }

        try {
            await navigator.clipboard.writeText(link);
            meldung('Wiedereinstiegs-Link für "' + name + '" kopiert. ' +
                    'Nur an diese Person weitergeben!');
        } catch (e) {
            meldung('Wiedereinstiegs-Link erzeugt - siehe Feld unten. ' +
                    'Nur an diese Person weitergeben!');
        }

        await mitgliederNeuLaden(groupId);
    } catch (err) {
        meldung('Link konnte nicht erzeugt werden: ' + (err.code || err.message), true);
    }
}

async function adminUebertragen(groupId, uid, name) {
    const bestaetigt = window.confirm(
        'Verwaltung der Gruppe an "' + name + '" übergeben?\n\n' +
        'Du verlierst damit alle Verwaltungsrechte für diese Gruppe und ' +
        'kannst sie NICHT selbst zurückholen. Bleibst aber normales Mitglied.'
    );
    if (!bestaetigt) return;

    try {
        await updateDoc(doc(db, 'groups', groupId), { adminUid: uid });
        offeneVerwaltung = null;
        meldung('Verwaltung an "' + name + '" übergeben.');
        await eigeneGruppenLaden();
        zeichneFenster();
    } catch (err) {
        meldung('Übergabe fehlgeschlagen: ' + (err.code || err.message), true);
    }
}

async function gruppeLoeschen(groupId, gruppenName) {
    const bestaetigt = window.confirm(
        'Gruppe "' + gruppenName + '" endgültig löschen?\n\n' +
        'Alle Mitglieder und deren geteilte Bewertungen werden gelöscht. ' +
        'Das lässt sich nicht rückgängig machen.\n\n' +
        'Die Bewertungen auf den einzelnen Geräten bleiben erhalten.'
    );
    if (!bestaetigt) return;

    const nachfrage = window.prompt(
        'Zur Sicherheit: Bitte den Gruppennamen eingeben, um das Löschen zu bestätigen.');
    if (nachfrage === null) return;
    if (nachfrage.trim() !== gruppenName) {
        meldung('Name stimmt nicht überein - es wurde nichts gelöscht.', true);
        return;
    }

    try {
        // Unterdokumente werden von Firestore NICHT automatisch mitgelöscht,
        // deshalb hier einzeln entfernen.
        const mitglieder = await getDocs(collection(db, 'groups', groupId, 'members'));
        for (const m of mitglieder.docs) {
            await deleteDoc(doc(db, 'groups', groupId, 'members', m.id));
        }
        try {
            const anspruch = await getDocs(collection(db, 'groups', groupId, 'claims'));
            for (const c of anspruch.docs) {
                await deleteDoc(doc(db, 'groups', groupId, 'claims', c.id));
            }
        } catch (e) { /* keine offenen Übergaben vorhanden */ }

        await deleteDoc(doc(db, 'groups', groupId, 'private', 'config'));
        await deleteDoc(doc(db, 'groups', groupId));

        if (aktuellerNutzer) {
            await setDoc(doc(db, 'users', aktuellerNutzer.uid),
                         { groupCount: increment(-1) }, { merge: true });
        }

        // Auch lokal aufräumen
        const rest = mitgliedschaftenLesen().filter(g => g.groupId !== groupId);
        mitgliedschaftenSpeichern(rest);
        if (aktiveGruppeId() === groupId) {
            aktiveGruppeSetzen(rest.length ? rest[0].groupId : null);
        }
        gruppenBewertungen = [];
        offeneVerwaltung = null;
        delete verwalteteMitglieder[groupId];

        await eigeneGruppenLaden();
        meldung('Gruppe "' + gruppenName + '" wurde gelöscht.');
        zeichneFenster();
        if (typeof window.onGruppeAktualisiert === 'function') window.onGruppeAktualisiert();
    } catch (err) {
        meldung('Löschen fehlgeschlagen: ' + (err.code || err.message), true);
    }
}

async function mitgliederNeuLaden(groupId) {
    try {
        const snap = await getDocs(collection(db, 'groups', groupId, 'members'));
        verwalteteMitglieder[groupId] = snap.docs.map(d => ({
            uid: d.id,
            name: d.data().name || 'Unbekannt',
            anzahlBewertungen: Object.values(d.data().ratings || {})
                .filter(r => r && r.value > 0).length
        }));
    } catch (err) {
        console.warn('Mitglieder konnten nicht neu geladen werden:', err);
    }
    zeichneFenster();
}

// ---------------------------------------------------------------------
// Kontoverwaltung (Issue #21)
// ---------------------------------------------------------------------

// Alle Gruppen, die mich betreffen: verwaltete (serverseitig ermittelt)
// und solche, in denen ich nur Mitglied bin (lokal gemerkt).
function meineGruppenUebersicht() {
    const adminIds = new Set(meineGruppen.map(g => g.id));
    const liste = meineGruppen.map(g => ({
        groupId: g.id, name: g.name, rolle: 'admin', gesperrt: !!g.locked
    }));
    mitgliedschaftenLesen().forEach(m => {
        if (adminIds.has(m.groupId)) return;
        liste.push({
            groupId: m.groupId, name: m.groupName, rolle: 'mitglied',
            eigenerName: m.memberName
        });
    });
    return liste;
}

function zurGruppenverwaltung(groupId) {
    ansicht = 'gruppen';
    const istAdminGruppe = meineGruppen.some(g => g.id === groupId);
    if (istAdminGruppe) {
        mitgliederVerwaltenUmschalten(groupId);
    } else {
        aktiveGruppeSetzen(groupId);
        zeichneFenster();
    }
}

// Prüft, ob dem Löschen noch Admin-Rollen im Weg stehen.
async function loeschenFortsetzen() {
    meldung('Prüfe deine Gruppen...');
    await eigeneGruppenLaden();
    meldungLeeren();
    ansicht = meineGruppen.length > 0 ? 'loeschen-admin' : 'loeschen-final';
    zeichneFenster();
}

function lokaleDatenLoeschen(auchBewertungen) {
    const zuLoeschen = [SPEICHER_GRUPPEN, SPEICHER_AKTIV,
                        SPEICHER_WARTESCHLANGE, SPEICHER_EMAIL];
    zuLoeschen.forEach(k => {
        try { localStorage.removeItem(k); } catch (e) { /* egal */ }
    });

    if (!auchBewertungen) return;

    // Bewertungs-Schlüssel erst sammeln, dann löschen - während des
    // Entfernens verschieben sich sonst die Indizes.
    const schluessel = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith(RATING_PRAEFIX) || k === 'mcu-rating-times')) {
            schluessel.push(k);
        }
    }
    schluessel.forEach(k => {
        try { localStorage.removeItem(k); } catch (e) { /* egal */ }
    });
}

async function accountLoeschen(auchBewertungen) {
    if (!istEchtAngemeldet()) return;
    const nutzer = aktuellerNutzer;

    try {
        meldung('Entferne dich aus deinen Gruppen...');

        // 1. Aus allen bekannten Gruppen austreten. Fehler einzelner
        //    Gruppen dürfen den Vorgang nicht abbrechen - z. B. wenn eine
        //    Gruppe zwischenzeitlich gelöscht wurde.
        for (const m of mitgliedschaftenLesen()) {
            try {
                await deleteDoc(doc(db, 'groups', m.groupId, 'members', nutzer.uid));
            } catch (err) {
                console.warn('Austritt aus ' + m.groupId + ' fehlgeschlagen:', err);
            }
        }

        // 2. Eigene, kontogebundene Listen (Relaunch Stufe 3/4). Firestore
        //    löscht Unterkollektionen NICHT automatisch mit dem
        //    übergeordneten Dokument mit (dieselbe bekannte Einschränkung
        //    wie beim Löschen einer Gruppe, siehe DATENMODELL.md) - ohne
        //    diesen Schritt blieben mit Gruppen geteilte Listen für deren
        //    Mitglieder als Geister sichtbar, obwohl der Account weg ist
        //    (Issue #39).
        try {
            const eigeneListen = await getDocs(collection(db, 'users', nutzer.uid, 'listen'));
            for (const listeDoc of eigeneListen.docs) {
                await deleteDoc(listeDoc.ref);
            }
        } catch (err) {
            console.warn('Eigene Listen konnten nicht gelöscht werden:', err);
        }

        // 3. Nutzer-Dokument (Gruppen-/Listen-Zähler)
        try {
            await deleteDoc(doc(db, 'users', nutzer.uid));
        } catch (err) {
            console.warn('Nutzer-Dokument konnte nicht gelöscht werden:', err);
        }

        // 4. Firebase-Konto selbst. Reihenfolge ist zwingend: vorher
        //    brauchen wir die Anmeldung noch für die Schritte oben.
        meldung('Lösche dein Konto...');
        await deleteUser(nutzer);

        // 5. Lokale Daten
        lokaleDatenLoeschen(auchBewertungen);

        meldung('Dein Account wurde gelöscht.');
        setTimeout(() => window.location.reload(), 1200);

    } catch (err) {
        if (err.code === 'auth/requires-recent-login') {
            await erneutAnmeldenUndLoeschen(auchBewertungen);
        } else {
            console.error('Löschen fehlgeschlagen:', err);
            meldung('Löschen fehlgeschlagen: ' + (err.code || err.message), true);
        }
    }
}

// Firebase verlangt für das Löschen eine kürzlich erfolgte Anmeldung.
// Bei Google lässt sich das direkt nachholen; beim E-Mail-Link geht das
// nicht ohne neuen Link - dort bleibt nur der Hinweis.
async function erneutAnmeldenUndLoeschen(auchBewertungen) {
    const anbieter = (aktuellerNutzer.providerData[0] || {}).providerId;

    if (anbieter === 'google.com') {
        try {
            meldung('Zur Sicherheit ist eine erneute Anmeldung nötig...');
            await reauthenticateWithPopup(aktuellerNutzer, new GoogleAuthProvider());
            await accountLoeschen(auchBewertungen);
        } catch (err) {
            if (err.code === 'auth/popup-closed-by-user') {
                meldung('Erneute Anmeldung abgebrochen - der Account wurde nicht gelöscht.', true);
            } else {
                meldung('Erneute Anmeldung fehlgeschlagen: ' + (err.code || err.message), true);
            }
        }
        return;
    }

    meldung('Aus Sicherheitsgründen ist eine frische Anmeldung nötig. ' +
            'Bitte melde dich ab, fordere einen neuen Anmeldelink an und ' +
            'versuche das Löschen danach erneut.', true);
}

// ---------------------------------------------------------------------
// Beitreten über den Einladungslink
// ---------------------------------------------------------------------

function einladungAusAdresse() {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('g');
    const c = params.get('c');
    const claim = params.get('claim');
    if (g && claim) return { groupId: g, claimCode: claim, istWiedereinstieg: true };
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

            // Beim Wiedereinstieg zusätzlich das Übergabe-Dokument holen -
            // daraus kommen Name und die bisherigen Bewertungen.
            if (daten.istWiedereinstieg) {
                const anspruch = await getDoc(
                    doc(db, 'groups', daten.groupId, 'claims', daten.claimCode));
                if (!anspruch.exists()) {
                    einladung.fehler = 'Dieser Wiedereinstiegs-Link wurde bereits ' +
                                       'verwendet oder ist nicht mehr gültig.';
                } else {
                    einladung.anspruch = anspruch.data();
                }
            }
        }
    } catch (err) {
        console.warn('Einladung konnte nicht geprüft werden:', err);
        einladung = { ...daten, fehler: 'Die Einladung konnte nicht geprüft werden.' };
    }

    adresszeileSaeubern();
    oeffneGruppenFenster();
}

// Löst einen Wiedereinstiegs-Link ein: neuer Eintrag mit den gesicherten
// Bewertungen, danach wird das Übergabe-Dokument entfernt.
async function wiedereinstiegEinloesen(anzeigeName) {
    if (!einladung || !einladung.anspruch) return;
    if (!anzeigeName.trim()) {
        meldung('Bitte einen Anzeigenamen eingeben.', true);
        return;
    }

    try {
        const nutzer = await sicherstellenAngemeldet();
        const a = einladung.anspruch;

        await setDoc(doc(db, 'groups', einladung.groupId, 'members', nutzer.uid), {
            name: anzeigeName.trim(),
            inviteCode: a.inviteCode || '',
            claimCode: einladung.claimCode,
            ratings: a.ratings || {},
            joinedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // Übergabe-Dokument aufräumen, damit der Link nicht erneut
        // eingelöst werden kann.
        try {
            await deleteDoc(doc(db, 'groups', einladung.groupId, 'claims', einladung.claimCode));
        } catch (e) {
            console.warn('Übergabe-Dokument konnte nicht entfernt werden:', e);
        }

        mitgliedschaftMerken(einladung.groupId, einladung.name || 'Gruppe', anzeigeName.trim());

        // Die zurückgeholten Bewertungen in den lokalen Bestand übernehmen
        const anzahl = Object.keys(a.ratings || {}).length;
        einladung = null;
        meldung('Wiedereinstieg erfolgreich. ' + anzahl + ' Bewertung(en) zurückgeholt.');
        await gruppeAbgleichen();
        zeichneFenster();
    } catch (err) {
        console.error('Wiedereinstieg fehlgeschlagen:', err);
        meldung('Wiedereinstieg fehlgeschlagen: ' + (err.code || err.message), true);
    }
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
// Bewertungen abgleichen
// ---------------------------------------------------------------------

const SPEICHER_WARTESCHLANGE = 'mcu-sync-warteschlange';

let gruppenBewertungen = [];   // [{uid, name, ratings}] der aktiven Gruppe
let letzterAbgleich    = null;
let abgleichLaeuft     = false;
let abgleichFehler     = null;

function warteschlangeLesen() {
    try {
        return JSON.parse(localStorage.getItem(SPEICHER_WARTESCHLANGE) || '{}');
    } catch (e) {
        return {};
    }
}

function warteschlangeSpeichern(daten) {
    try {
        localStorage.setItem(SPEICHER_WARTESCHLANGE, JSON.stringify(daten));
    } catch (e) {
        console.warn('Warteschlange konnte nicht gespeichert werden:', e);
    }
}

// Änderungen, die ohne Verbindung entstanden sind, werden gesammelt und
// beim nächsten erfolgreichen Zugriff nachgereicht.
function fuerSpaeterMerken(groupId, movieId, wert, zeitstempel) {
    const alle = warteschlangeLesen();
    if (!alle[groupId]) alle[groupId] = {};
    alle[groupId][movieId] = { value: wert, updatedAt: zeitstempel };
    warteschlangeSpeichern(alle);
}

async function warteschlangeAbarbeiten() {
    const alle = warteschlangeLesen();
    const gruppenIds = Object.keys(alle);
    if (gruppenIds.length === 0) return;

    for (const groupId of gruppenIds) {
        const eintraege = alle[groupId];
        try {
            const nutzer = await sicherstellenAngemeldet();
            const aenderungen = { updatedAt: serverTimestamp() };
            Object.entries(eintraege).forEach(([movieId, wert]) => {
                aenderungen['ratings.' + movieId] = wert;
            });
            await updateDoc(doc(db, 'groups', groupId, 'members', nutzer.uid), aenderungen);
            delete alle[groupId];
        } catch (err) {
            console.warn('Nachreichen für Gruppe ' + groupId + ' fehlgeschlagen:', err);
        }
    }
    warteschlangeSpeichern(alle);
}

// Wird von app.js aufgerufen, sobald eine Bewertung geändert wurde.
async function bewertungHochladen(movieId, wert, zeitstempel) {
    const groupId = aktiveGruppeId();
    if (!groupId) return;   // ohne aktive Gruppe bleibt alles rein lokal

    try {
        const nutzer = await sicherstellenAngemeldet();
        await updateDoc(doc(db, 'groups', groupId, 'members', nutzer.uid), {
            ['ratings.' + movieId]: { value: wert, updatedAt: zeitstempel },
            updatedAt: serverTimestamp()
        });
    } catch (err) {
        console.warn('Bewertung konnte nicht geteilt werden, wird nachgereicht:', err);
        fuerSpaeterMerken(groupId, movieId, wert, zeitstempel);
    }
}

// Gleicht den eigenen Stand mit der Gruppe ab und lädt die Bewertungen
// der anderen. Bei Abweichungen gewinnt die jüngere Änderung.
async function gruppeAbgleichen() {
    const groupId = aktiveGruppeId();
    if (!groupId) { gruppenBewertungen = []; return; }

    abgleichLaeuft = true;
    abgleichFehler = null;

    try {
        const nutzer = await sicherstellenAngemeldet();
        await warteschlangeAbarbeiten();

        const snap = await getDocs(collection(db, 'groups', groupId, 'members'));
        gruppenBewertungen = snap.docs.map(d => ({
            uid: d.id,
            name: d.data().name || 'Unbekannt',
            ratings: d.data().ratings || {}
        }));

        const eigene = gruppenBewertungen.find(m => m.uid === nutzer.uid);
        if (eigene) {
            await eigenenStandAbgleichen(groupId, nutzer.uid, eigene.ratings);
        } else {
            abgleichFehler = 'Du bist auf diesem Gerät kein Mitglied dieser Gruppe. ' +
                             'Bitte den Einladungslink erneut öffnen.';
        }

        letzterAbgleich = new Date();
        window.GRUPPEN_BEWERTUNGEN = gruppenBewertungen;
        if (typeof window.onGruppeAktualisiert === 'function') {
            window.onGruppeAktualisiert(gruppenBewertungen);
        }
    } catch (err) {
        console.warn('Abgleich mit der Gruppe fehlgeschlagen:', err);
        abgleichFehler = err.code === 'permission-denied'
            ? 'Kein Zugriff auf diese Gruppe (kein Mitglied auf diesem Gerät).'
            : (err.code || err.message);
    } finally {
        abgleichLaeuft = false;
    }
}

// Vergleicht Film für Film den lokalen mit dem gespeicherten Stand.
async function eigenenStandAbgleichen(groupId, uid, entfernteBewertungen) {
    const lokale = lokaleBewertungenMitZeit();
    const nachOben = {};
    let vonUntenUebernommen = 0;

    // Alle Filme betrachten, die auf einer der beiden Seiten vorkommen
    const alleIds = new Set([...Object.keys(lokale), ...Object.keys(entfernteBewertungen)]);

    alleIds.forEach(movieId => {
        const l = lokale[movieId];
        const e = entfernteBewertungen[movieId];

        if (l && !e) {
            nachOben['ratings.' + movieId] = l;
        } else if (!l && e) {
            if (typeof window.applyRemoteRating === 'function') {
                window.applyRemoteRating(movieId, e.value, e.updatedAt || 0);
                vonUntenUebernommen++;
            }
        } else if (l && e) {
            if ((l.updatedAt || 0) > (e.updatedAt || 0)) {
                nachOben['ratings.' + movieId] = l;
            } else if ((e.updatedAt || 0) > (l.updatedAt || 0) && e.value !== l.value) {
                if (typeof window.applyRemoteRating === 'function') {
                    window.applyRemoteRating(movieId, e.value, e.updatedAt);
                    vonUntenUebernommen++;
                }
            }
        }
    });

    if (Object.keys(nachOben).length > 0) {
        try {
            nachOben.updatedAt = serverTimestamp();
            await updateDoc(doc(db, 'groups', groupId, 'members', uid), nachOben);
        } catch (err) {
            console.warn('Eigener Stand konnte nicht hochgeladen werden:', err);
        }
    }

    if (vonUntenUebernommen > 0) {
        console.info(vonUntenUebernommen + ' Bewertung(en) von einem anderen Gerät übernommen.');
    }
}

// Wie lokaleBewertungen(), aber mit den Zeitstempeln aus app.js - und
// bewusst INKLUSIVE zurückgenommener Bewertungen (Wert 0 mit Zeitstempel).
// Ohne die wüsste der Abgleich nicht, dass eine Bewertung absichtlich
// entfernt wurde, und würde den alten Stand aus der Gruppe zurückholen.
function lokaleBewertungenMitZeit() {
    let zeiten = {};
    try {
        zeiten = JSON.parse(localStorage.getItem('mcu-rating-times') || '{}');
    } catch (e) { /* ohne Zeitstempel weiterarbeiten */ }

    const ergebnis = {};

    Object.entries(lokaleBewertungen()).forEach(([movieId, eintrag]) => {
        ergebnis[movieId] = { value: eintrag.value, updatedAt: zeiten[movieId] || 0 };
    });

    Object.keys(zeiten).forEach(movieId => {
        if (ergebnis[movieId]) return;
        const wert = parseInt(localStorage.getItem(RATING_PRAEFIX + movieId) || '0', 10);
        ergebnis[movieId] = { value: wert, updatedAt: zeiten[movieId] };
    });

    return ergebnis;
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

    if (einladung.locked && !einladung.istWiedereinstieg) {
        return `<div class="gruppen-einladung">
                    <div class="gruppen-untertitel">Einladung zu "${sicher(einladung.name)}"</div>
                    <p class="gruppen-hinweis">
                        Diese Gruppe ist gesperrt, ein Beitritt ist derzeit nicht möglich.
                        Bitte wende dich an die Person, die dich eingeladen hat.
                    </p>
                    <button class="gruppen-btn grau" data-aktion="einladung-weg">Schließen</button>
                </div>`;
    }

    // Wiedereinstieg nach einem Gerätewechsel
    if (einladung.istWiedereinstieg) {
        const a = einladung.anspruch || {};
        const anzahl = Object.values(a.ratings || {}).filter(r => r && r.value > 0).length;
        return `<div class="gruppen-einladung">
                    <div class="gruppen-untertitel">Wiedereinstieg in "${sicher(einladung.name)}"</div>
                    <p class="gruppen-hinweis">
                        Dein bisheriger Platz wurde für dieses Gerät freigegeben.
                        ${anzahl > 0
                            ? '<strong>' + anzahl + ' gespeicherte Bewertung(en)</strong> werden dabei zurückgeholt.'
                            : 'Es sind keine gespeicherten Bewertungen hinterlegt.'}
                    </p>
                    <div class="gruppen-zeile">
                        <input type="text" id="beitritt-name" placeholder="Dein Anzeigename"
                               maxlength="40" value="${sicher(a.name || '')}">
                    </div>
                    <button class="gruppen-btn" data-aktion="wiedereinstieg">Platz übernehmen</button>
                    <button class="gruppen-btn grau" data-aktion="einladung-weg">Abbrechen</button>
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

    const status = gruppenBewertungen.length > 0
        ? `<div class="gruppen-status-box">
               <div><strong>${gruppenBewertungen.length}</strong> Mitglied(er) in dieser Gruppe:</div>
               <ul class="gruppen-mitglieder">
                   ${gruppenBewertungen.map(m => {
                       const anzahl = Object.values(m.ratings)
                           .filter(r => r && r.value > 0).length;
                       return `<li>${sicher(m.name)} - ${anzahl} Bewertung(en)</li>`;
                   }).join('')}
               </ul>
               ${letzterAbgleich ? `<div class="gruppen-zeitstempel">Zuletzt abgeglichen: ${letzterAbgleich.toLocaleTimeString('de-DE')}</div>` : ''}
           </div>`
        : `<div class="gruppen-status-box">
               <div>${abgleichLaeuft ? 'Wird abgeglichen...' : 'Noch keine Daten geladen.'}</div>
               ${abgleichFehler ? `<div class="gruppen-zeitstempel">Letzter Fehler: ${sicher(abgleichFehler)}</div>` : ''}
           </div>`;

    return `<div class="gruppen-block">
                <div class="gruppen-untertitel">Meine Gruppen</div>
                <p class="gruppen-hinweis">
                    Auf den Filmkarten werden die Bewertungen der hier ausgewählten Gruppe angezeigt.
                </p>
                <div class="gruppen-zeile">
                    <select id="gruppen-auswahl">${optionen}</select>
                </div>
                ${status}
                <div class="gruppen-aktionen">
                    <button class="gruppen-btn schmal" data-aktion="abgleichen">Jetzt abgleichen</button>
                    <button class="gruppen-btn schmal grau" data-aktion="verlassen" data-gid="${sicher(aktuelle.groupId)}">
                        Gruppe verlassen
                    </button>
                </div>
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
                    <button class="gruppen-btn schmal grau" data-aktion="gruppe-umbenennen" data-gid="${g.id}" data-name="${sicher(g.name)}">Umbenennen</button>
                    <button class="gruppen-btn schmal" data-aktion="kopieren" data-gid="${g.id}">Einladungslink kopieren</button>
                    <button class="gruppen-btn schmal grau" data-aktion="zeigen" data-gid="${g.id}">Link anzeigen</button>
                    <button class="gruppen-btn schmal grau" data-aktion="sperre" data-gid="${g.id}" data-wert="${g.locked ? 'auf' : 'zu'}">
                        ${g.locked ? 'Entsperren' : 'Sperren'}
                    </button>
                    <button class="gruppen-btn schmal grau" data-aktion="erneuern" data-gid="${g.id}">Neuer Link</button>
                    <button class="gruppen-btn schmal grau" data-aktion="verwalten" data-gid="${g.id}">
                        ${offeneVerwaltung === g.id ? 'Mitglieder ausblenden' : 'Mitglieder verwalten'}
                    </button>
                </div>
                <input type="text" class="gruppen-linkfeld" id="link-${g.id}" readonly style="display:none">
                ${offeneVerwaltung === g.id ? abschnittMitgliederverwaltung(g) : ''}
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

function abschnittMitgliederverwaltung(gruppe) {
    const mitglieder = verwalteteMitglieder[gruppe.id];
    if (!mitglieder) {
        return '<div class="gruppen-verwaltung"><p class="gruppen-hinweis">Lade Mitglieder...</p></div>';
    }

    const zeilen = mitglieder.map(m => {
        const istIchSelbst = aktuellerNutzer && m.uid === aktuellerNutzer.uid;
        return `<div class="mitglied-zeile">
                    <div class="mitglied-kopf">
                        <span class="mitglied-name">${sicher(m.name)}</span>
                        ${istIchSelbst ? '<span class="gruppen-status">du</span>' : ''}
                        <span class="mitglied-anzahl">${m.anzahlBewertungen} Bewertung(en)</span>
                    </div>
                    <div class="gruppen-aktionen">
                        <button class="gruppen-btn schmal grau" data-aktion="umbenennen"
                                data-gid="${gruppe.id}" data-uid="${m.uid}" data-name="${sicher(m.name)}">Umbenennen</button>
                        ${istIchSelbst ? '' : `
                        <button class="gruppen-btn schmal grau" data-aktion="wiedereinstieg-link"
                                data-gid="${gruppe.id}" data-uid="${m.uid}" data-name="${sicher(m.name)}">Neues Gerät</button>
                        <button class="gruppen-btn schmal grau" data-aktion="uebertragen"
                                data-gid="${gruppe.id}" data-uid="${m.uid}" data-name="${sicher(m.name)}">Verwaltung übergeben</button>
                        <button class="gruppen-btn schmal grau" data-aktion="entfernen"
                                data-gid="${gruppe.id}" data-uid="${m.uid}" data-name="${sicher(m.name)}">Entfernen</button>`}
                    </div>
                </div>`;
    }).join('');

    return `<div class="gruppen-verwaltung">
                <div class="gruppen-untertitel">Mitglieder</div>
                <p class="gruppen-hinweis">
                    "Neues Gerät" erzeugt einen persönlichen Link, mit dem jemand seinen
                    Platz samt Bewertungen auf ein anderes Gerät mitnimmt.
                </p>
                ${zeilen || '<p class="gruppen-hinweis">Keine Mitglieder.</p>'}
                <button class="gruppen-btn schmal gefahr" data-aktion="gruppe-loeschen"
                        data-gid="${gruppe.id}" data-name="${sicher(gruppe.name)}">Gruppe löschen</button>
            </div>`;
}

// --- Konto-Ansichten (Issue #21) ---

function abschnittLogin() {
    return `
        <p class="gruppen-hinweis">
            Ein Login ist <strong>nur</strong> nötig, um Gruppen zu erstellen und zu
            verwalten. Zum Bewerten der Filme brauchst du keinen Account - die App
            funktioniert vollständig ohne Anmeldung.
        </p>
        <p class="gruppen-hinweis">
            Zum Erstellen einer Gruppe ist eine Anmeldung nötig. Wer nur beitreten
            möchte, braucht keine Anmeldung - dafür genügt der Einladungslink.
        </p>
        <p class="gruppen-hinweis">
            Mit einer Gruppe siehst du, wie deine Familie dieselben Filme bewertet hat.
            Du bewertest weiterhin ganz normal auf den Filmkarten - die Gruppe zeigt
            zusätzlich die Bewertungen der anderen.
        </p>
        <button class="gruppen-btn" data-aktion="google">Mit Google anmelden</button>
        <div class="gruppen-trenner">oder per E-Mail-Link ohne Passwort</div>
        <div class="gruppen-zeile">
            <input type="email" id="anmelde-email" placeholder="deine@email.de" autocomplete="email">
            <button class="gruppen-btn schmal" data-aktion="maillink">Link senden</button>
        </div>
        <p class="gruppen-hinweis ds-verweis">
            Bevor du dich anmeldest:
            <button class="gruppen-link-btn" data-aktion="datenschutz">Welche Daten werden gespeichert?</button>
        </p>`;
}

function abschnittProfil() {
    const uebersicht = meineGruppenUebersicht();

    const gruppenListe = uebersicht.length === 0
        ? '<p class="gruppen-hinweis">Du bist derzeit in keiner Gruppe.</p>'
        : uebersicht.map(g => `
            <div class="mitglied-zeile">
                <div class="mitglied-kopf">
                    <span class="mitglied-name">${sicher(g.name)}</span>
                    <span class="gruppen-status">${g.rolle === 'admin' ? 'Admin' : 'Mitglied'}</span>
                    ${g.gesperrt ? '<span class="gruppen-status">gesperrt</span>' : ''}
                </div>
                <button class="gruppen-btn schmal grau" data-aktion="zur-gruppe" data-gid="${sicher(g.groupId)}">
                    Zur Gruppenverwaltung
                </button>
            </div>`).join('');

    return `
        <div class="gruppen-block">
            <div class="gruppen-konto">
                Angemeldet als <strong>${sicher(aktuellerNutzer.email || 'unbekannt')}</strong>
            </div>
            <button class="gruppen-btn grau" data-aktion="abmelden">Abmelden</button>
        </div>

        <div class="gruppen-block">
            <div class="gruppen-untertitel">Meine Gruppen</div>
            ${gruppenListe}
        </div>

        <div class="gruppen-block">
            <div class="gruppen-untertitel">Account löschen</div>
            <p class="gruppen-hinweis">
                Entfernt dein Konto und deine Gruppenmitgliedschaften dauerhaft.
            </p>
            <button class="gruppen-btn gefahr" data-aktion="loeschen-start">Account löschen</button>
        </div>`;
}

function abschnittLoeschenHinweis() {
    return `
        <p class="gruppen-hinweis">
            Eine Löschung des Accounts ist möglich, wenn du deine Adminrechte deiner
            Gruppen weitergegeben hast oder die Gruppe(n), in der du Admin bist,
            gelöscht hast. Bei Gruppen, in denen du nur Mitglied bist, wirst du
            automatisch aus den Gruppen entfernt.
        </p>
        <p class="gruppen-hinweis"><strong>Möchtest du deinen Account löschen?</strong></p>
        <button class="gruppen-btn gefahr" data-aktion="loeschen-weiter">Bitte Account löschen.</button>
        <button class="gruppen-btn grau" data-aktion="loeschen-abbrechen">Nein</button>`;
}

function abschnittLoeschenAdmin() {
    const namen = meineGruppen.map(g => sicher(g.name)).join(', ');
    return `
        <div class="gruppen-warnung">
            Eine Löschung des Accounts ist nur möglich, wenn du deine Adminrechte
            deiner Gruppen weitergegeben hast oder die Gruppe(n), in der du Admin
            bist, gelöscht hast.
        </div>
        <p class="gruppen-hinweis">Du verwaltest derzeit: <strong>${namen}</strong></p>
        <button class="gruppen-btn" data-aktion="zur-verwaltung">Zur Gruppenverwaltung</button>
        <button class="gruppen-btn grau" data-aktion="loeschen-abbrechen">Account nicht löschen</button>`;
}

function abschnittLoeschenFinal() {
    const anzahl = Object.keys(lokaleBewertungen()).length;
    return `
        <div class="gruppen-warnung">
            Möchtest du deinen Account wirklich löschen? Alle Bewertungen und
            Gruppenmitgliedschaften werden gelöscht und können nicht reaktiviert
            werden.
        </div>
        ${anzahl > 0 ? `
        <label class="gruppen-check">
            <input type="checkbox" id="loeschen-bewertungen" checked>
            Auch meine ${anzahl} Bewertung(en) auf diesem Gerät löschen
        </label>
        <p class="gruppen-hinweis">
            Ohne Haken bleiben deine Bewertungen lokal erhalten - du kannst die App
            danach ohne Account weiternutzen.
        </p>` : ''}
        <button class="gruppen-btn gefahr" data-aktion="loeschen-endgueltig">Ja! Account löschen.</button>
        <button class="gruppen-btn grau" data-aktion="loeschen-abbrechen">Abbrechen</button>`;
}

// --- Eigene Listen kontogebunden (Relaunch Stufe 3, Issue #37) ---
// Bewusste Abweichung vom sonstigen Grundsatz "lokal ist führend"
// (siehe Bewertungen): Für kontogebundene Listen ist Firestore die
// führende Quelle, localStorage dient nur noch als Anzeige-Cache
// (mcu-konto-listen-cache in app.js). Deshalb auch KEINE Warteschlange
// wie bei Bewertungen - Bearbeiten setzt eine Internetverbindung voraus,
// offline bleibt eine Konto-Liste bewusst nur lesbar (siehe
// eigeneListeSperrgrund in app.js).

async function kontoListenLaden() {
    if (!istEchtAngemeldet()) return;
    try {
        const schnappschuss = await getDocs(collection(db, 'users', aktuellerNutzer.uid, 'listen'));
        const listen = schnappschuss.docs.map(d => ({
            id: d.id,
            kurzname: d.data().kurzname,
            name: d.data().name,
            filme: d.data().filme || []
        }));
        if (typeof window.kontoListenCacheSetzen === 'function') {
            window.kontoListenCacheSetzen(listen);
        }
    } catch (err) {
        console.warn('Konto-Listen konnten nicht geladen werden:', err);
    }
}

// Legt eine neue kontogebundene Liste an (Formular ODER automatischer
// Login-Abgleich) - inklusive des weichen Zähler-Limits, siehe
// unterListenLimit() in firestore.rules.
async function kontoListeAnlegen(liste) {
    if (!istEchtAngemeldet()) throw new Error('Dazu ist eine Anmeldung nötig.');
    await setDoc(doc(db, 'users', aktuellerNutzer.uid, 'listen', liste.id), {
        kurzname: liste.kurzname,
        name: liste.name,
        filme: liste.filme,
        geteiltInGruppen: liste.geteiltInGruppen || []
    });
    await setDoc(doc(db, 'users', aktuellerNutzer.uid),
                 { listenCount: increment(1) }, { merge: true });
    if (typeof window.kontoListenCacheAktualisieren === 'function') {
        window.kontoListenCacheAktualisieren(liste);
    }
}

// Speichert Änderungen an einer bereits bestehenden kontogebundenen
// Liste (umbenennen, Filme hinzufügen/entfernen/umsortieren, Teilen mit
// einer Gruppe starten/beenden - siehe eigeneListePersistieren in
// app.js, das diese Funktion aufruft).
async function kontoListeSpeichern(liste) {
    if (!istEchtAngemeldet()) throw new Error('Dazu ist eine Anmeldung nötig.');
    await setDoc(doc(db, 'users', aktuellerNutzer.uid, 'listen', liste.id), {
        kurzname: liste.kurzname,
        name: liste.name,
        filme: liste.filme,
        geteiltInGruppen: liste.geteiltInGruppen || []
    });
    if (typeof window.kontoListenCacheAktualisieren === 'function') {
        window.kontoListenCacheAktualisieren(liste);
    }
}

async function kontoListeLoeschen(listeId) {
    if (!istEchtAngemeldet()) throw new Error('Dazu ist eine Anmeldung nötig.');
    await deleteDoc(doc(db, 'users', aktuellerNutzer.uid, 'listen', listeId));
    await setDoc(doc(db, 'users', aktuellerNutzer.uid),
                 { listenCount: increment(-1) }, { merge: true });
    if (typeof window.kontoListenCacheEntfernen === 'function') {
        window.kontoListenCacheEntfernen(listeId);
    }
}

// --- Eigene Listen mit Gruppen teilen (Relaunch Stufe 4, Issue #39) ---
// Der eigentliche Lesezugriff auf eine geteilte Liste läuft weiterhin
// direkt über users/{uid}/listen/{listeId} (geprüft via
// istMitgliedEinerDieserGruppen in firestore.rules - das funktioniert
// nachweislich, siehe unten). Für das AUFFINDEN geteilter Listen wurde
// ursprünglich eine Collection-Group-Abfrage über alle users/*/listen-
// Unterkollektionen verwendet - das schlug in der Praxis mit
// "permission-denied" fehl: Firestore-Regeln unterstützen exists()-
// Prüfungen für Collection-Group-Abfragen über Sammlungsgrenzen hinweg
// offenbar nicht zuverlässig (ein einzelner getDoc() auf denselben Pfad
// mit derselben Regel funktionierte dagegen einwandfrei - siehe
// Fehlersuche zu Issue #39). Stattdessen jetzt eine Zeiger-
// Unterkollektion direkt bei der Gruppe (groups/{gid}/geteilteListen),
// abgesichert genau wie die bestehende Mitgliederliste über istMitglied()
// - dieselbe, bereits bewährte Art von Abfrage (eine bekannte, einzelne
// Gruppe statt sammlungsübergreifend).
//
// Bewusst KEIN dauerhafter Echtzeit-Draht (onSnapshot), sondern
// einmaliges Laden bei Login und beim Öffnen des "Filmreihe wählen"-
// Fensters (siehe fensterOeffnen), plus ein gezieltes Neuladen der
// jeweils aktiven Liste beim Wechseln zu ihr (siehe app.js:
// ladeUndRendereAktiveListe).

function zeigerId(ownerUid, listeId) {
    return ownerUid + '_' + listeId;
}

// Legt bzw. entfernt den Zeiger, wenn eine Liste geteilt/nicht mehr
// geteilt wird - aufgerufen von listeMitGruppeTeilen/
// listeVonGruppeEntfernen in app.js, direkt neben der eigentlichen
// Änderung an geteiltInGruppen.
async function listePointerHinzufuegen(gid, ownerUid, listeId) {
    if (!istEchtAngemeldet()) throw new Error('Dazu ist eine Anmeldung nötig.');
    await setDoc(doc(db, 'groups', gid, 'geteilteListen', zeigerId(ownerUid, listeId)), { ownerUid, listeId });
}
window.listePointerHinzufuegen = listePointerHinzufuegen;

async function listePointerEntfernen(gid, ownerUid, listeId) {
    if (!istEchtAngemeldet()) throw new Error('Dazu ist eine Anmeldung nötig.');
    await deleteDoc(doc(db, 'groups', gid, 'geteilteListen', zeigerId(ownerUid, listeId)));
}
window.listePointerEntfernen = listePointerEntfernen;

// Sucht über alle lokal gemerkten Mitgliedschaften hinweg nach Listen,
// die MIT MIR geteilt wurden. Eine Liste, die mit mehreren meiner
// Gruppen geteilt ist, taucht dabei nur einmal auf.
async function geteilteListenLaden() {
    const mitgliedschaften = mitgliedschaftenLesen();
    if (mitgliedschaften.length === 0) {
        if (typeof window.geteilteListenSetzen === 'function') window.geteilteListenSetzen([]);
        return;
    }

    const gefunden = new Map(); // Schlüssel: ownerUid/listeId, gegen Duplikate bei Mehrfach-Teilung

    for (const mitgliedschaft of mitgliedschaften) {
        try {
            const zeiger = await getDocs(collection(db, 'groups', mitgliedschaft.groupId, 'geteilteListen'));
            for (const zeigerDoc of zeiger.docs) {
                const { ownerUid, listeId } = zeigerDoc.data();
                const schluessel = ownerUid + '/' + listeId;
                if (gefunden.has(schluessel)) continue;

                let listeSnap;
                try {
                    listeSnap = await getDoc(doc(db, 'users', ownerUid, 'listen', listeId));
                } catch (e) {
                    continue; // z. B. zwischenzeitlich gelöscht oder nicht mehr geteilt
                }
                if (!listeSnap.exists()) continue;

                let erstellerName = 'Unbekannt';
                try {
                    const mitgliedDoc = await getDoc(doc(db, 'groups', mitgliedschaft.groupId, 'members', ownerUid));
                    if (mitgliedDoc.exists() && mitgliedDoc.data().name) erstellerName = mitgliedDoc.data().name;
                } catch (e) { /* Name bleibt "Unbekannt" - kein Grund, deswegen abzubrechen */ }

                gefunden.set(schluessel, {
                    id: listeId,
                    ownerUid,
                    kurzname: listeSnap.data().kurzname,
                    name: listeSnap.data().name,
                    filme: listeSnap.data().filme || [],
                    erstellerName
                });
            }
        } catch (err) {
            console.warn('Geteilte Listen aus Gruppe ' + mitgliedschaft.groupId + ' konnten nicht geladen werden:', err);
        }
    }

    if (typeof window.geteilteListenSetzen === 'function') {
        window.geteilteListenSetzen(Array.from(gefunden.values()));
    }
}

// Lädt EINE geteilte Liste gezielt und frisch nach (siehe Issue #39:
// "beim Wechseln frisch nachgeladen") - unabhängig vom zuletzt über
// geteilteListenLaden() gefundenen Stand.
async function geteilteListeEinzelnLaden(ownerUid, listeId) {
    const schnappschuss = await getDoc(doc(db, 'users', ownerUid, 'listen', listeId));
    if (!schnappschuss.exists()) return null;
    return {
        id: listeId,
        ownerUid,
        kurzname: schnappschuss.data().kurzname,
        name: schnappschuss.data().name,
        filme: schnappschuss.data().filme || []
    };
}
window.geteilteListeEinzelnLaden = geteilteListeEinzelnLaden;

// Kandidaten für den Login-Abgleich (siehe listenAbgleichVorschlag in
// app.js) - null, solange keine Entscheidung ansteht.
let abgleichKandidaten = null;
let abgleichPlatzFrei = 0;

// Wird nach jedem Laden der Konto-Listen aufgerufen (Login UND jeder
// spätere Seitenaufruf als angemeldeter Nutzer). Lädt konfliktfreie
// lokale Listen automatisch hoch; bei Namenskollision oder wenn das
// 10er-Limit überschritten würde, entscheidet der Nutzer im
// "listen-abgleich"-Fenster (Antworten zu Issue #37).
async function kontoListenSynchronisieren() {
    await kontoListenLaden();
    if (typeof window.listenAbgleichVorschlag !== 'function') return;

    const vorschlag = window.listenAbgleichVorschlag();
    if (vorschlag.kandidaten.length === 0) return;

    if (vorschlag.automatischMoeglich) {
        const uploads = vorschlag.kandidaten.map(k => ({ id: k.id, kurzname: k.kurzname, name: k.name }));
        const anzahl = await window.listenAbgleichUebernehmen(uploads);
        if (anzahl > 0) {
            meldung(anzahl + ' eigene Liste(n) wurden mit deinem Konto synchronisiert.');
            if (typeof window.onAktiveListeGeaendert === 'function') window.onAktiveListeGeaendert();
        }
        zeichneFenster();
    } else {
        abgleichKandidaten = vorschlag.kandidaten;
        abgleichPlatzFrei = vorschlag.platzFrei;
        fensterOeffnen('listen-abgleich');
    }
}

// Baut das Abgleich-Fenster: pro lokaler Liste eine Checkbox, bei
// Namenskollision zusätzlich Eingabefelder zum Anpassen des Namens -
// erst nach Auflösung der Kollision lässt sich die Liste übernehmen.
function abschnittListenAbgleich() {
    if (!abgleichKandidaten || abgleichKandidaten.length === 0) {
        return '<p class="gruppen-hinweis">Keine lokalen Listen zum Abgleichen.</p>';
    }

    const zeilen = abgleichKandidaten.map(k => `
        <div class="mitglied-zeile">
            <label class="gruppen-check">
                <input type="checkbox" class="abgleich-checkbox" data-liste-id="${k.id}" ${k.kollision ? '' : 'checked'}>
                <strong>${sicher(k.kurzname)}</strong> - ${sicher(k.name)} (${k.anzahlFilme} Film(e))
            </label>
            ${k.kollision ? `
            <p class="eigene-hinweis">⚠️ Diesen Namen gibt es in deinem Konto schon - bitte anpassen, um diese Liste zu übernehmen:</p>
            <div class="gruppen-zeile">
                <input type="text" id="abgleich-kurzname-${k.id}" value="${sicher(k.kurzname)}" placeholder="Neuer Kurzname" maxlength="15">
            </div>
            <div class="gruppen-zeile">
                <input type="text" id="abgleich-name-${k.id}" value="${sicher(k.name)}" placeholder="Neuer Langname" maxlength="40">
            </div>` : ''}
        </div>`).join('');

    return `
        <p class="gruppen-hinweis">
            Du hast lokale Listen auf diesem Gerät, die noch nicht mit deinem
            Konto synchronisiert sind. Dein Konto hat noch Platz für
            ${abgleichPlatzFrei} weitere Liste(n) (maximal 10 insgesamt).
            Wähle aus, welche du übernehmen möchtest.
        </p>
        ${zeilen}
        <div id="abgleich-fehler" class="eigene-fehler" style="display:none;"></div>
        <button class="gruppen-btn" data-aktion="abgleich-uebernehmen">Ausgewählte Listen übernehmen</button>
        <button class="gruppen-btn grau" data-aktion="abgleich-verwerfen">Später (Listen bleiben vorerst lokal)</button>`;
}

// --- Filmreihen wechseln (Relaunch Stufe 1) ---
// Die eigentliche Lade-/Wechsel-Logik lebt in app.js (listeWechseln,
// VERFUEGBARE_LISTEN) - hier nur die Anzeige im gewohnten Fenster.

// --- Eigene Listen anlegen/umbenennen/löschen (Relaunch Stufe 2) ---
// Datenhaltung (localStorage, Namensprüfung, Limits) lebt komplett in
// app.js - hier nur Formulare und Bestätigungen. ID der Liste, die
// gerade umbenannt wird (Inline-Formular), oder null.
let eigeneListeBearbeitungId = null;

function abschnittListen() {
    const listen = typeof window.getVerfuegbareListen === 'function'
        ? window.getVerfuegbareListen()
        : [];
    const aktiveId = typeof window.getAktiveListeId === 'function'
        ? window.getAktiveListeId()
        : null;

    if (listen.length === 0) {
        return '<p class="gruppen-hinweis">Keine Filmreihen verfügbar.</p>';
    }

    const eintraege = listen.map(l => {
        if (eigeneListeBearbeitungId === l.id) {
            return `
        <div class="mitglied-zeile">
            <div class="gruppen-zeile">
                <input type="text" id="eigene-liste-kurzname-${l.id}" value="${sicher(l.kurzname)}" placeholder="Kurzname (max. 15 Zeichen)" maxlength="15">
            </div>
            <div class="gruppen-zeile">
                <input type="text" id="eigene-liste-name-${l.id}" value="${sicher(l.name)}" placeholder="Langname (max. 40 Zeichen)" maxlength="40">
            </div>
            <div class="gruppen-aktionen">
                <button class="gruppen-btn schmal" data-aktion="eigene-liste-umbenennen-speichern" data-liste-id="${l.id}">Speichern</button>
                <button class="gruppen-btn schmal grau" data-aktion="eigene-liste-umbenennen-abbrechen">Abbrechen</button>
            </div>
        </div>`;
        }

        // Umbenennen/Löschen nur, solange die Liste bearbeitbar ist - eine
        // Konto-Liste ohne Anmeldung/Internet zeigt stattdessen den Grund
        // (siehe eigeneListeSperrgrund in app.js).
        const eigeneAktionen = l.eigene
            ? (l.bearbeitbar
                ? `<button class="gruppen-btn schmal grau" data-aktion="eigene-liste-umbenennen-start" data-liste-id="${l.id}">Umbenennen</button>
                   <button class="gruppen-btn schmal grau" data-aktion="eigene-liste-loeschen" data-liste-id="${l.id}" data-name="${sicher(l.name)}">Löschen</button>`
                : `<p class="eigene-hinweis">🔒 ${sicher(l.sperrgrund)}</p>`)
            : '';

        return `
        <div class="mitglied-zeile">
            <div class="mitglied-kopf">
                <span class="mitglied-name">${sicher(l.name)}</span>
                ${l.id === aktiveId ? '<span class="gruppen-status">aktiv</span>' : ''}
                ${l.herkunft === 'konto' ? '<span class="gruppen-status">Konto</span>' : ''}
                ${l.herkunft === 'geteilt' ? `<span class="gruppen-status">Geteilt von ${sicher(l.erstellerName || '?')}</span>` : ''}
                ${l.eigene ? `<span class="mitglied-anzahl">${l.anzahlFilme} Film(e)</span>` : ''}
            </div>
            <div class="gruppen-aktionen">
                ${l.id === aktiveId
                    ? ''
                    : `<button class="gruppen-btn schmal" data-aktion="liste-wechseln" data-liste-id="${sicher(l.id)}">Auswählen</button>`}
                ${eigeneAktionen}
            </div>
        </div>`;
    }).join('');

    // Neue Listen landen automatisch im Konto, sobald man echt angemeldet
    // und online ist (bis zu 10) - sonst rein lokal (bis zu 3), siehe
    // eigeneListeAnlegen in app.js.
    const kontoBereit = typeof window.istEchtAngemeldet === 'function' && window.istEchtAngemeldet();
    const maxKonto = typeof window.getKontoListenMax === 'function' ? window.getKontoListenMax() : 10;
    const anzahlKonto = typeof window.getKontoListenAnzahl === 'function' ? window.getKontoListenAnzahl() : 0;
    const anzahlEigene = typeof window.getEigeneListenAnzahl === 'function' ? window.getEigeneListenAnzahl() : 0;
    const maxEigene = typeof window.getEigeneListenMax === 'function' ? window.getEigeneListenMax() : 3;

    const anlegenFormular = (untertitel) => `
        <div class="gruppen-anlegen">
            <div class="gruppen-untertitel">${untertitel}</div>
            <div class="gruppen-zeile">
                <input type="text" id="neue-liste-kurzname" placeholder="Kurzname für die Navigation, z. B. Favoriten" maxlength="15">
            </div>
            <div class="gruppen-zeile">
                <input type="text" id="neue-liste-name" placeholder="Langname, z. B. Meine Lieblingsfilme" maxlength="40">
            </div>
            <button class="gruppen-btn" data-aktion="eigene-liste-anlegen">Liste anlegen</button>
        </div>`;

    let anlegenBereich;
    if (kontoBereit) {
        anlegenBereich = anzahlKonto >= maxKonto
            ? `<p class="gruppen-hinweis">Du hast bereits ${maxKonto} Listen in deinem Konto gespeichert - bitte erst eine löschen, um Platz für eine neue zu schaffen.</p>`
            : anlegenFormular('Eigene Liste anlegen (wird mit deinem Konto gespeichert)');
    } else {
        anlegenBereich = anzahlEigene >= maxEigene
            ? `<p class="gruppen-hinweis">Du hast bereits ${maxEigene} eigene Listen angelegt - mehr geht mit einer Anmeldung (bis zu ${maxKonto}).</p>`
            : anlegenFormular('Eigene Liste anlegen');
    }

    return `
        <p class="gruppen-hinweis">
            Wähle, welche Filmreihe angezeigt werden soll. Bewertungen bleiben
            beim Wechseln erhalten - sie sind pro Film gespeichert, unabhängig
            davon, welche Liste gerade aktiv ist.
        </p>
        ${eintraege}
        ${anlegenBereich}`;
}

// --- Streaming-Anbieter (Issue #33) ---
// Rein lokale Auswahl (max. 4), Logik/Speicherung liegt in app.js
// (window.getStreamingAnbieterListe/-getAusgewaehlteAnbieter/-anbieterAuswahlUmschalten),
// hier nur die Darstellung im bestehenden Fenster-Muster.

function abschnittStreaming() {
    const anbieterListe = typeof window.getStreamingAnbieterListe === 'function'
        ? window.getStreamingAnbieterListe() : [];
    const ausgewaehlt = typeof window.getAusgewaehlteAnbieter === 'function'
        ? window.getAusgewaehlteAnbieter() : [];
    const max = typeof window.getAnbieterMax === 'function' ? window.getAnbieterMax() : 4;

    const eintraege = anbieterListe.map(a => {
        const istAktiv = ausgewaehlt.includes(a.id);
        const deaktiviert = !istAktiv && ausgewaehlt.length >= max;
        return `
        <label class="gruppen-check anbieter-check${deaktiviert ? ' deaktiviert' : ''}">
            <input type="checkbox" class="anbieter-checkbox" data-anbieter-id="${a.id}"
                   ${istAktiv ? 'checked' : ''} ${deaktiviert ? 'disabled' : ''}>
            <img class="anbieter-check-logo" src="https://image.tmdb.org/t/p/w45${a.logo}" alt="" loading="lazy">
            ${sicher(a.name)}
        </label>`;
    }).join('');

    return `
        <p class="gruppen-hinweis">
            Wähle bis zu ${max} Streaming-Anbieter aus. Ist ein Film dort verfügbar, erscheint
            sein Logo auf der Filmkarte - kräftig, wenn er im Abo enthalten ist, blass, wenn er
            nur leihbar oder käuflich ist. Die Auswahl bleibt rein lokal auf diesem Gerät.
        </p>
        <div class="anbieter-liste">${eintraege}</div>
        <p class="gruppen-hinweis anbieter-zaehler">${ausgewaehlt.length}/${max} ausgewählt</p>
        <p class="tmdb-erklaerung">Streaming-Verfügbarkeit bereitgestellt von JustWatch via TMDB.</p>`;
}

// --- Infos zum Fan Guide (Issue #24) ---
// Enthält die von TMDB vorgeschriebene Attribution. Die Vorgabe verlangt
// einen Bereich vom Typ "About"/"Credits", den wörtlichen englischen
// Hinweis sowie das unveränderte Logo, weniger prominent als das eigene.

function abschnittInfos() {
    return `
        <div class="ds-block">
            <div class="ds-titel">Was ist das hier?</div>
            <p>Eine private Übersicht mehrerer Filmreihen - aktuell das Marvel
               Cinematic Universe und Star Wars, weitere folgen - jeweils sortiert
               in einer selbst zusammengestellten Reihenfolge, die sich für
               gemeinsame Filmabende bewährt hat.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Was kannst du damit machen?</div>
            <ul>
                <li>Filme mit Popcorn-Tüten bewerten (0 bis 5)</li>
                <li>Den eigenen Fortschritt verfolgen - bewertete Filme gelten als gesehen</li>
                <li>Optional eine Gruppe anlegen und sehen, wie andere dieselben Filme
                    bewertet haben</li>
                <li>Deine Streaming-Anbieter auswählen und anzeigen lassen, wo ein Film
                    verfügbar ist</li>
            </ul>
            <p>Zum Bewerten ist keine Anmeldung nötig. Die Bewertungen bleiben dann
               ausschließlich auf deinem Gerät.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Wer steckt dahinter?</div>
            <p>Ein privates, nicht-kommerzielles Projekt von KrizzMe. Der Quellcode ist
               öffentlich einsehbar unter
               <a href="https://github.com/KrizzMe/mcu-guide" target="_blank" rel="noopener noreferrer">github.com/KrizzMe/mcu-guide</a>.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Filmdaten und Poster</div>
            <p>Filmdaten und Poster stammen von The Movie Database (TMDB). Die Rechte an
               den Postern liegen bei den jeweiligen Filmstudios. Diese Seite steht in
               keiner Verbindung zu Marvel, Disney oder anderen Rechteinhabern.</p>

            <div class="tmdb-attribution">
                <div class="tmdb-untertitel">Hinweis zur Datenquelle</div>
                <img src="tmdb-logo.svg" alt="The Movie Database (TMDB)" class="tmdb-logo"
                     onerror="this.style.display='none'">
                <p class="tmdb-notice">
                    This product uses the TMDB API but is not endorsed or certified by TMDB.
                </p>
                <p class="tmdb-erklaerung">
                    (Dieser englische Hinweis ist von TMDB vorgegeben und muss so
                    ausgewiesen sein.)
                </p>
                <p class="tmdb-erklaerung">
                    <strong>Übersetzung:</strong> Diese Anwendung nutzt die
                    TMDB-Schnittstelle, wird von TMDB aber weder unterstützt noch
                    zertifiziert.
                </p>
            </div>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Streaming-Verfügbarkeit</div>
            <p>Wo ein Film per Stream verfügbar ist, stammt ebenfalls von TMDB - die
               zugrunde liegenden Daten liefert JustWatch. Die Anzeige der ausgewählten
               Anbieter-Logos ist rein informativ, es gibt keine Kauf- oder
               Buchungsfunktion. Ein Klick auf das JustWatch-Symbol bei den Anbieter-Logos
               führt zur Übersichtsseite des Films bei TMDB, auf der auch weitere, dort
               verfügbare Streaming-Anbieter aufgeführt sind.</p>

            <div class="tmdb-attribution">
                <div class="tmdb-untertitel">Hinweis zur Datenquelle</div>
                <div class="justwatch-attribution-zeile">
                    <img src="justwatch-icon.svg" alt="" class="justwatch-attribution-logo"
                         onerror="this.style.display='none'">
                    <strong>JustWatch</strong>
                </div>
                <p class="tmdb-notice">
                    Streaming-Daten werden bereitgestellt von JustWatch via TMDB.
                </p>
            </div>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Datenschutz</div>
            <p>Welche Daten gespeichert werden und wofür, steht in den
               <button class="gruppen-link-btn" data-aktion="datenschutz">Datenschutzhinweisen</button>.</p>
        </div>

        <button class="gruppen-btn grau" data-aktion="infos-zurueck">Zurück</button>`;
}

// --- Datenschutzhinweise (Issue #22) ---

function abschnittDatenschutz() {
    return `
        <p class="gruppen-hinweis">
            Diese Seite ist ein privates, nicht-kommerzielles Projekt. Die folgenden
            Hinweise sollen offenlegen, was technisch passiert - nicht nur formale
            Pflichten erfüllen.
        </p>

        <div class="ds-block">
            <div class="ds-titel">Wer ist verantwortlich?</div>
            <p>Betrieben wird die Seite privat von KrizzMe.</p>
            <p>Kontakt: <a href="mailto:krizzme.projects@gmail.com">krizzme.projects@gmail.com</a></p>
            <p>Der Quellcode ist öffentlich einsehbar unter
               <a href="https://github.com/KrizzMe/mcu-guide" target="_blank" rel="noopener noreferrer">github.com/KrizzMe/mcu-guide</a>.
               Dort lässt sich nachvollziehen, was die App tatsächlich tut.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Ohne Anmeldung: nichts verlässt dein Gerät</div>
            <p>Wer nur Filme bewerten oder seine bevorzugten Streaming-Anbieter
               auswählen möchte, braucht keinen Account. Beides bleibt dann
               ausschließlich lokal auf deinem Gerät (Details siehe unten unter
               „Was wird auf deinem Gerät gespeichert?").</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Welche Daten fallen bei der Anmeldung an?</div>
            <ul>
                <li>Deine E-Mail-Adresse</li>
                <li>Eine technische Kennung deines Kontos</li>
            </ul>
            <p>Diese Daten stammen von Google beziehungsweise aus dem Versand des
               Anmeldelinks.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Welche Daten werden in einer Gruppe geteilt?</div>
            <ul>
                <li>Dein selbst gewählter Anzeigename</li>
                <li>Deine Filmbewertungen</li>
                <li>Der Zeitpunkt der letzten Änderung</li>
            </ul>
            <p>Sichtbar sind diese Angaben ausschließlich für die anderen Mitglieder
               derselben Gruppe.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Wofür wird die Anmeldung überhaupt gebraucht?</div>
            <p>Ausschließlich für die Gruppenfunktion. Sie sorgt dafür, dass du nach
               einem Gerätewechsel wieder Zugriff auf deine Gruppen bekommst - ohne
               eine dauerhafte Kennung wäre das technisch nicht möglich.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Was wird auf deinem Gerät gespeichert?</div>
            <ul>
                <li>Bewertungen, Gruppenmitgliedschaften, die zuletzt gewählte Gruppe
                    und deine ausgewählten Streaming-Anbieter im lokalen Speicher
                    deines Geräts</li>
                <li>Technische Angaben zum Angemeldet-Bleiben (durch Firebase)</li>
            </ul>
            <p>Das gilt gleichermaßen, ob du die Seite im Browser öffnest oder über
               das Symbol auf dem Startbildschirm - technisch ist es derselbe
               Speicher. Es werden keine eigenen Cookies gesetzt und es findet keine
               Wiedererkennung über Websites hinweg statt. Alles Gespeicherte ist für
               die Funktionen erforderlich, die du selbst nutzt - deshalb gibt es hier
               auch kein Einwilligungsbanner. Beim Anmelden über Google öffnet sich ein
               Fenster von Google; was dort gespeichert wird, unterliegt Googles
               eigener Datenschutzerklärung.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Wo liegen die Daten?</div>
            <ul>
                <li>Firebase (Google), Datenbankstandort Frankfurt am Main</li>
                <li>Hosting über GitHub Pages, dort fallen serverseitig Zugriffsdaten an</li>
                <li>Die technischen Bausteine der Anmeldung werden bei jedem
                    Seitenaufruf von einem Google-Server geladen; dabei wird deine
                    IP-Adresse an Google übertragen</li>
                <li>Beim Antippen von "Trailer ansehen" fragt dein Browser direkt bei
                    TMDB die aktuellen Trailer-Daten ab und bindet anschließend den
                    YouTube-Player ein (datenschutzfreundliche Adresse
                    youtube-nocookie.com). Beides passiert erst nach deinem Klick,
                    nicht beim bloßen Betrachten der Filmliste</li>
            </ul>
            <p>Alle genannten Anbieter verarbeiten die Daten ausschließlich als
               technische Dienstleister im Auftrag.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Was ausdrücklich nicht passiert</div>
            <ul>
                <li>Keine Weitergabe an Dritte zu deren eigenen Zwecken</li>
                <li>Kein Verkauf von Daten</li>
                <li>Keine Werbung, keine Profilbildung</li>
                <li>Keine Analyse- oder Trackingdienste - Google Analytics wurde im
                    Firebase-Projekt bewusst deaktiviert</li>
            </ul>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Wie wirst du deine Daten wieder los?</div>
            <p>Jederzeit selbst über <strong>Mein Profil → Account löschen</strong>.
               Dabei werden Konto, Gruppenmitgliedschaften und geteilte Bewertungen
               entfernt; die lokalen Bewertungen auf Wunsch ebenfalls. Alternativ
               lassen sich die lokalen Daten über die Browser-Einstellungen löschen.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Links zu externen Seiten</div>
            <p>Auf den Filmkarten findest du Verweise zu TMDB. Der JustWatch-Link bei
               den Streaming-Anbieter-Logos führt ebenfalls zu einer TMDB-Seite, von der
               aus sich - je nach Verfügbarkeit - weiter zu JustWatch klicken lässt; wir
               verlinken also nicht direkt zu JustWatch, sondern nur über diesen Umweg
               über TMDB. Beim Anklicken verlässt du diese Seite; ab dann gelten die
               Datenschutzbestimmungen des jeweiligen Anbieters.</p>
            <p>Für die Inhalte externer Seiten übernehme ich keine Haftung. Zum
               Zeitpunkt der Verlinkung waren keine rechtswidrigen Inhalte erkennbar.
               Sollte mir eine Rechtsverletzung bekannt werden, entferne ich den
               entsprechenden Verweis umgehend.</p>
        </div>

        <div class="ds-block">
            <div class="ds-titel">Deine Rechte</div>
            <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung und Widerspruch
               sowie das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu
               beschweren.</p>
        </div>

        <button class="gruppen-btn grau" data-aktion="datenschutz-zurueck">Zurück</button>`;
}

function zeichneFenster() {
    const inhalt = document.getElementById('gruppen-inhalt');
    const titelEl = document.getElementById('gruppen-titel');
    if (!inhalt) return;

    if (ladeVorgang) {
        inhalt.innerHTML = '<p class="gruppen-hinweis">Einen Moment...</p>';
        return;
    }

    if (ansicht === 'listen') {
        if (titelEl) titelEl.textContent = 'Filmreihe wählen';
        inhalt.innerHTML = abschnittListen();
        return;
    }

    if (ansicht === 'listen-abgleich') {
        if (titelEl) titelEl.textContent = 'Eigene Listen mit Konto abgleichen';
        inhalt.innerHTML = abschnittListenAbgleich();
        return;
    }

    if (ansicht === 'infos') {
        if (titelEl) titelEl.textContent = 'Infos zum Fan Guide';
        inhalt.innerHTML = abschnittInfos();
        return;
    }

    if (ansicht === 'datenschutz') {
        if (titelEl) titelEl.textContent = 'Datenschutzhinweise';
        inhalt.innerHTML = abschnittDatenschutz();
        return;
    }

    // Streaming-Anbieterauswahl (Issue #33) - eigener Nav-Punkt, bewusst
    // unabhängig vom Login-Status, da die Auswahl rein lokal ist.
    if (ansicht === 'streaming') {
        if (titelEl) titelEl.textContent = 'Streaming-Anbieter';
        inhalt.innerHTML = abschnittStreaming();
        return;
    }

    // Wer sich abmeldet, während eine Konto-Ansicht offen ist, landet
    // wieder auf der Anmeldung statt in einer leeren Maske.
    if (ansicht !== 'gruppen' && !istEchtAngemeldet()) {
        ansicht = 'konto';
    }

    if (ansicht === 'konto') {
        if (titelEl) titelEl.textContent = istEchtAngemeldet() ? 'Mein Profil' : 'Login';
        inhalt.innerHTML = istEchtAngemeldet() ? abschnittProfil() : abschnittLogin();
        return;
    }

    if (ansicht.startsWith('loeschen')) {
        if (titelEl) titelEl.textContent = 'Account löschen';
        if (ansicht === 'loeschen-admin')  inhalt.innerHTML = abschnittLoeschenAdmin();
        else if (ansicht === 'loeschen-final') inhalt.innerHTML = abschnittLoeschenFinal();
        else inhalt.innerHTML = abschnittLoeschenHinweis();
        return;
    }

    if (titelEl) titelEl.textContent = 'Gruppen';

    const einleitung = (mitgliedschaftenLesen().length === 0 && !einladung)
        ? `<p class="gruppen-hinweis">
               Mit einer Gruppe siehst du, wie deine Familie dieselben Filme bewertet hat.
               Du bewertest weiterhin ganz normal auf den Filmkarten - die Gruppe zeigt
               zusätzlich die Bewertungen der anderen.
           </p>` : '';

    inhalt.innerHTML = einleitung + abschnittEinladung() + abschnittMeineGruppen() + abschnittAdmin();
}

function fensterOeffnen(gewuenschteAnsicht) {
    const fenster = document.getElementById('gruppen-fenster');
    if (!fenster) return;
    ansicht = gewuenschteAnsicht;
    meldungLeeren();
    fenster.classList.add('offen');
    zeichneFenster();
    if (istEchtAngemeldet() && meineGruppen.length === 0) {
        eigeneGruppenLaden().then(zeichneFenster);
    }
    // "beim Öffnen frisch nachgeladen" (Issue #39) - der Listen-Bereich
    // zeigt geteilte Listen, die sich zwischenzeitlich geändert haben
    // könnten (neue Freigabe, beendete Freigabe, anderer Inhalt).
    if (gewuenschteAnsicht === 'listen') {
        geteilteListenLaden().then(zeichneFenster);
    }
}

function oeffneGruppenFenster() {
    fensterOeffnen('gruppen');
}

function oeffneKontoFenster() {
    fensterOeffnen('konto');
}

function oeffneStreamingFenster() {
    fensterOeffnen('streaming');
}

function schliesseGruppenFenster() {
    const fenster = document.getElementById('gruppen-fenster');
    if (fenster) fenster.classList.remove('offen');
    // Ein erneutes Öffnen soll nicht mitten im Löschablauf landen.
    if (ansicht.startsWith('loeschen')) ansicht = 'konto';
}

// Ein einziger Klick-Handler für das ganze Fenster - robuster als viele
// einzelne Listener, da der Inhalt immer wieder neu aufgebaut wird.
function fensterKlicks(event) {
    const ziel = event.target.closest('[data-aktion]');
    if (!ziel) return;
    const aktion = ziel.dataset.aktion;
    const gid    = ziel.dataset.gid;
    const uid    = ziel.dataset.uid;
    const name   = ziel.dataset.name;

    if (aktion === 'schliessen')     schliesseGruppenFenster();
    if (aktion === 'google')         anmeldenMitGoogle();
    if (aktion === 'maillink')       anmeldeLinkSenden(document.getElementById('anmelde-email')?.value || '');
    if (aktion === 'abmelden')       abmelden();
    if (aktion === 'kopieren')       linkKopieren(gid);
    if (aktion === 'zeigen')         linkAnzeigen(gid);
    if (aktion === 'sperre')         sperreUmschalten(gid, ziel.dataset.wert === 'zu');
    if (aktion === 'gruppe-umbenennen') gruppeUmbenennen(gid, name);
    if (aktion === 'erneuern')       linkErneuern(gid);
    if (aktion === 'einladung-weg')  einladungVerwerfen();
    if (aktion === 'verlassen')      gruppeVerlassenLokal(gid);

    // Mitgliederverwaltung (Issue #17)
    if (aktion === 'verwalten')           mitgliederVerwaltenUmschalten(gid);
    if (aktion === 'umbenennen')          mitgliedUmbenennen(gid, uid, name);
    if (aktion === 'entfernen')           mitgliedEntfernen(gid, uid, name);
    if (aktion === 'wiedereinstieg-link') wiedereinstiegErzeugen(gid, uid, name);
    if (aktion === 'uebertragen')         adminUebertragen(gid, uid, name);
    if (aktion === 'gruppe-loeschen')     gruppeLoeschen(gid, name);
    if (aktion === 'wiedereinstieg') {
        wiedereinstiegEinloesen(document.getElementById('beitritt-name')?.value || '');
    }

    // Kontoverwaltung (Issue #21)
    if (aktion === 'zur-gruppe')          zurGruppenverwaltung(gid);
    if (aktion === 'zur-verwaltung')      { ansicht = 'gruppen'; zeichneFenster(); }
    if (aktion === 'loeschen-start')      { ansicht = 'loeschen-hinweis'; meldungLeeren(); zeichneFenster(); }
    if (aktion === 'loeschen-weiter')     loeschenFortsetzen();
    if (aktion === 'loeschen-abbrechen')  { ansicht = 'konto'; meldungLeeren(); zeichneFenster(); }
    if (aktion === 'loeschen-endgueltig') {
        accountLoeschen(document.getElementById('loeschen-bewertungen')?.checked !== false);
    }

    if (aktion === 'infos-zurueck') {
        ansicht = vorherigeAnsicht || 'konto';
        zeichneFenster();
    }
    if (aktion === 'liste-wechseln') {
        const listeId = ziel.dataset.listeId;
        if (typeof window.listeWechseln === 'function' && listeId) {
            window.listeWechseln(listeId).then(() => zeichneFenster());
        }
    }

    // Eigene Listen (Relaunch Stufe 2 + 3) - anlegen/umbenennen/löschen
    // sind seit der Kontoanbindung (Issue #37) asynchron, da sie bei
    // angemeldeten, online Nutzern über Firestore laufen können.
    if (aktion === 'eigene-liste-anlegen') {
        const kurzname = document.getElementById('neue-liste-kurzname')?.value || '';
        const name = document.getElementById('neue-liste-name')?.value || '';
        window.eigeneListeAnlegen(kurzname, name).then(ergebnis => {
            if (!ergebnis.ok) {
                meldung(ergebnis.fehler, true);
            } else {
                meldungLeeren();
                zeichneFenster();
            }
        });
    }
    if (aktion === 'eigene-liste-umbenennen-start') {
        eigeneListeBearbeitungId = ziel.dataset.listeId;
        meldungLeeren();
        zeichneFenster();
    }
    if (aktion === 'eigene-liste-umbenennen-abbrechen') {
        eigeneListeBearbeitungId = null;
        zeichneFenster();
    }
    if (aktion === 'eigene-liste-umbenennen-speichern') {
        const bearbeiteteId = ziel.dataset.listeId;
        const kurzname = document.getElementById('eigene-liste-kurzname-' + bearbeiteteId)?.value || '';
        const name = document.getElementById('eigene-liste-name-' + bearbeiteteId)?.value || '';
        window.eigeneListeUmbenennen(bearbeiteteId, kurzname, name).then(ergebnis => {
            if (!ergebnis.ok) {
                meldung(ergebnis.fehler, true);
            } else {
                eigeneListeBearbeitungId = null;
                meldungLeeren();
                zeichneFenster();
            }
        });
    }
    if (aktion === 'eigene-liste-loeschen') {
        const listeId = ziel.dataset.listeId;
        const listenName = ziel.dataset.name;
        const bestaetigt = window.confirm(
            'Liste "' + listenName + '" wirklich löschen?\n\n' +
            'Die Filme werden aus dieser Liste entfernt. Bereits abgegebene ' +
            'Bewertungen bleiben erhalten, falls die Filme auch in anderen ' +
            'Listen vorkommen.'
        );
        if (!bestaetigt) return;
        window.eigeneListeLoeschen(listeId).then(ergebnis => {
            if (!ergebnis.ok) meldung(ergebnis.fehler, true);
            zeichneFenster();
        });
    }

    // Login-Abgleich lokaler Listen mit dem Konto (Relaunch Stufe 3)
    if (aktion === 'abgleich-uebernehmen') {
        const checkboxen = Array.from(document.querySelectorAll('.abgleich-checkbox:checked'));
        const uploads = [];
        let fehlertext = null;

        for (const box of checkboxen) {
            const listeId = box.dataset.listeId;
            const kandidat = abgleichKandidaten.find(k => k.id === listeId);
            if (!kandidat) continue;

            let kurzname = kandidat.kurzname;
            let name = kandidat.name;
            if (kandidat.kollision) {
                kurzname = (document.getElementById('abgleich-kurzname-' + listeId)?.value || '').trim();
                name = (document.getElementById('abgleich-name-' + listeId)?.value || '').trim();
                if (kurzname.toLowerCase() === kandidat.kurzname.toLowerCase()
                    || name.toLowerCase() === kandidat.name.toLowerCase()) {
                    fehlertext = `Für "${kandidat.kurzname}" bitte einen wirklich neuen Namen eintragen, um die Kollision aufzulösen.`;
                    break;
                }
            }
            uploads.push({ id: listeId, kurzname, name });
        }

        if (fehlertext) {
            const fehlerEl = document.getElementById('abgleich-fehler');
            if (fehlerEl) { fehlerEl.textContent = fehlertext; fehlerEl.style.display = 'block'; }
            return;
        }
        if (uploads.length > abgleichPlatzFrei) {
            const fehlerEl = document.getElementById('abgleich-fehler');
            if (fehlerEl) {
                fehlerEl.textContent = `Nur ${abgleichPlatzFrei} freie Plätze im Konto - bitte weniger Listen auswählen.`;
                fehlerEl.style.display = 'block';
            }
            return;
        }

        window.listenAbgleichUebernehmen(uploads).then(anzahl => {
            abgleichKandidaten = null;
            meldung(anzahl + ' Liste(n) wurden mit deinem Konto synchronisiert.');
            ansicht = 'listen';
            zeichneFenster();
            if (typeof window.onAktiveListeGeaendert === 'function') window.onAktiveListeGeaendert();
        });
    }
    if (aktion === 'abgleich-verwerfen') {
        abgleichKandidaten = null;
        ansicht = 'listen';
        zeichneFenster();
    }

    // Datenschutzhinweise (Issue #22)
    if (aktion === 'datenschutz') {
        vorherigeAnsicht = ansicht;
        ansicht = 'datenschutz';
        meldungLeeren();
        zeichneFenster();
    }
    if (aktion === 'datenschutz-zurueck') {
        ansicht = vorherigeAnsicht || 'konto';
        zeichneFenster();
    }

    if (aktion === 'abgleichen') {
        meldung('Gleiche ab...');
        gruppeAbgleichen().then(() => {
            meldung('Abgleich abgeschlossen.');
            zeichneFenster();
        });
    }
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
    if (event.target.classList.contains('anbieter-checkbox')) {
        const id = Number(event.target.dataset.anbieterId);
        const ergebnis = typeof window.anbieterAuswahlUmschalten === 'function'
            ? window.anbieterAuswahlUmschalten(id)
            : { ok: false };
        if (!ergebnis.ok) {
            const max = typeof window.getAnbieterMax === 'function' ? window.getAnbieterMax() : 4;
            meldung(`Maximal ${max} Anbieter auswählbar - zuerst einen abwählen.`, true);
        }
        zeichneFenster();
        return;
    }
    if (event.target.id === 'gruppen-auswahl') {
        aktiveGruppeSetzen(event.target.value);
        gruppenBewertungen = [];
        letzterAbgleich = null;
        meldung('Aktive Gruppe gewechselt, gleiche ab...');
        zeichneFenster();
        gruppeAbgleichen().then(() => {
            meldung('Aktive Gruppe gewechselt.');
            zeichneFenster();
        });
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
    navBeschriftungAktualisieren();
    // Geteilte Listen unabhängig vom Anmeldestatus laden - auch anonym
    // beigetretene Gruppenmitglieder müssen sie sehen können (Issue #39).
    await geteilteListenLaden();
    if (istEchtAngemeldet()) {
        ladeVorgang = true;
        zeichneFenster();
        await eigeneGruppenLaden();
        await kontoListenSynchronisieren();
        ladeVorgang = false;
    }
    zeichneFenster();
    // Konto-Listen können durch Login/Logout bearbeitbar geworden oder
    // gesperrt worden sein - Inhaltsseite (nicht nur das Fenster) neu
    // aufbauen, damit das sofort sichtbar ist.
    if (typeof window.ladeUndRendereAktiveListe === 'function') {
        window.ladeUndRendereAktiveListe();
    }
});

anmeldungAusLinkAbschliessen();
einladungPruefen();

// Beim Start einmal mit der aktiven Gruppe abgleichen. Läuft im
// Hintergrund - schlägt es fehl, funktioniert die App trotzdem
// vollständig weiter, nur eben ohne die Bewertungen der anderen.
if (aktiveGruppeId()) {
    gruppeAbgleichen().then(zeichneFenster);
}

// Kommt die Verbindung zurück, werden gemerkte Änderungen nachgereicht.
window.addEventListener('online', () => {
    warteschlangeAbarbeiten().then(() => gruppeAbgleichen()).then(zeichneFenster);
    // Konto-Listen sind offline nur lesbar (Issue #37) - Inhaltsseite neu
    // aufbauen, damit die Bearbeitung sofort wieder freigeschaltet wird,
    // ohne dass der Nutzer erst die Liste wechseln muss.
    if (typeof window.ladeUndRendereAktiveListe === 'function') window.ladeUndRendereAktiveListe();
});

// Umgekehrt beim Verbindungsverlust sofort sperren, statt erst beim
// nächsten Bearbeitungsversuch zu scheitern.
window.addEventListener('offline', () => {
    if (typeof window.ladeUndRendereAktiveListe === 'function') window.ladeUndRendereAktiveListe();
});

// Für andere Dateien erreichbar machen
window.openGroupPanel       = oeffneGruppenFenster;
window.openKontoPanel       = oeffneKontoFenster;
window.openStreamingPanel   = oeffneStreamingFenster;
window.openListenPanel      = () => fensterOeffnen('listen');
window.openDatenschutz      = () => {
    vorherigeAnsicht = 'konto';
    fensterOeffnen('datenschutz');
};
window.openInfos            = () => {
    vorherigeAnsicht = 'konto';
    fensterOeffnen('infos');
};
window.closeGroupPanel      = schliesseGruppenFenster;
window.getKontoLabel        = () => (istEchtAngemeldet() ? 'Mein Profil' : 'Login');
window.getAktiveGruppe      = aktiveGruppeId;
window.getAktiveGruppeName  = aktiveGruppeName;
// Eigene Listen, kontogebunden (Issue #37) - app.js prüft darüber, ob
// eine Konto-Liste bearbeitet werden darf (siehe eigeneListeSperrgrund).
window.istEchtAngemeldet    = istEchtAngemeldet;
window.kontoListeAnlegen    = kontoListeAnlegen;
window.kontoListeSpeichern  = kontoListeSpeichern;
window.kontoListeLoeschen   = kontoListeLoeschen;
// Mit Gruppen teilen (Issue #39) - für das Teilen-Panel auf der
// Inhaltsseite einer eigenen Liste (siehe renderTeilenPanel in app.js).
window.getMeineGruppenMitgliedschaften = () =>
    mitgliedschaftenLesen().map(m => ({ groupId: m.groupId, groupName: m.groupName }));
window.onRatingChanged      = bewertungHochladen;
window.getEigeneUid         = () => (aktuellerNutzer ? aktuellerNutzer.uid : null);

// Beim Start einmal melden - app.js hat die Navigation zu diesem
// Zeitpunkt bereits ohne Gruppennamen aufgebaut.
navBeschriftungAktualisieren();