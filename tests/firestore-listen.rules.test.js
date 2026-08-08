/**
 * Sicherheitstests für die Firestore-Regel users/{uid}/listen/{listeId}
 * (kontogebundene eigene Listen, Relaunch Stufe 3, Issue #37).
 *
 * Prüft NUR diese neue Regel, nicht die bestehenden Gruppen-Regeln - für
 * die gab es bisher keine versionierten Tests (siehe firestore.rules,
 * das erstmals mit Issue #37 aus der Firebase Console ins Repo geholt
 * wurde). Läuft komplett gegen den lokalen Firestore-Emulator, es wird
 * NICHTS an eurem echten Firebase-Projekt "mcuguide" verändert.
 *
 * Einmalige Einrichtung in diesem Ordner:
 *     npm install --save-dev @firebase/rules-unit-testing firebase
 *     npm install -g firebase-tools   (falls noch nicht vorhanden)
 *
 * Ausführen (startet den Firestore-Emulator automatisch mit):
 *     firebase emulators:exec --only firestore "node tests/firestore-listen.rules.test.js"
 *
 * Nutzt Node's eingebauten Testrunner (ab Node 18) - kein zusätzliches
 * Test-Framework nötig.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails
} = require('@firebase/rules-unit-testing');
const {
    doc, setDoc, getDoc, updateDoc, deleteDoc
} = require('firebase/firestore');

const GUELTIGE_LISTE = { kurzname: 'Favoriten', name: 'Meine Lieblingsfilme', filme: [] };

let testEnv;

test.before(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'mcuguide-test',
        firestore: {
            rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
        }
    });
});

test.after(async () => {
    await testEnv.cleanup();
});

test.beforeEach(async () => {
    await testEnv.clearFirestore();
});

function echterNutzer(uid) {
    return testEnv
        .authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } })
        .firestore();
}

function anonymerNutzer(uid) {
    return testEnv
        .authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } })
        .firestore();
}

// Legt Dokumente unter Umgehung der Regeln an - für den Ausgangszustand
// eines Tests (z. B. "es gibt schon eine Liste"), nicht Teil des zu
// testenden Verhaltens selbst.
async function alsAdmin(aufgabe) {
    await testEnv.withSecurityRulesDisabled(async context => {
        await aufgabe(context.firestore());
    });
}

// ---------------------------------------------------------------------
// Anlegen (create)
// ---------------------------------------------------------------------

test('echter Nutzer darf eine eigene Liste anlegen', async () => {
    const db = echterNutzer('alice');
    await assertSucceeds(setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE));
});

test('anonymer Nutzer darf KEINE Liste anlegen', async () => {
    const db = anonymerNutzer('anon1');
    await assertFails(setDoc(doc(db, 'users/anon1/listen/liste1'), GUELTIGE_LISTE));
});

test('nicht angemeldeter Nutzer darf KEINE Liste anlegen', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'users/irgendwer/listen/liste1'), GUELTIGE_LISTE));
});

test('Nutzer darf KEINE Liste unter einer fremden uid anlegen', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'users/bob/listen/liste1'), GUELTIGE_LISTE));
});

test('Kurzname leer wird abgelehnt', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'users/alice/listen/liste1'),
        { ...GUELTIGE_LISTE, kurzname: '' }));
});

test('Kurzname über 15 Zeichen wird abgelehnt', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'users/alice/listen/liste1'),
        { ...GUELTIGE_LISTE, kurzname: 'x'.repeat(16) }));
});

test('Langname über 40 Zeichen wird abgelehnt', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'users/alice/listen/liste1'),
        { ...GUELTIGE_LISTE, name: 'x'.repeat(41) }));
});

test('Mehr als 50 Filme werden abgelehnt', async () => {
    const db = echterNutzer('alice');
    const zuVieleFilme = Array.from({ length: 51 }, (_, i) => ({ id: 'film-' + i }));
    await assertFails(setDoc(doc(db, 'users/alice/listen/liste1'),
        { ...GUELTIGE_LISTE, filme: zuVieleFilme }));
});

test('"filme" muss eine Liste sein, kein beliebiger Wert', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'users/alice/listen/liste1'),
        { ...GUELTIGE_LISTE, filme: 'kaputt' }));
});

test('Ohne users/{uid}-Dokument (kein Zähler) ist Anlegen erlaubt', async () => {
    const db = echterNutzer('alice');
    await assertSucceeds(setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE));
});

test('Am 10er-Limit wird das Anlegen abgelehnt (weiches, app-gepflegtes Limit)', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice'), { listenCount: 10 });
    });
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE));
});

test('Unter dem 10er-Limit ist Anlegen weiterhin erlaubt', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice'), { listenCount: 9 });
    });
    const db = echterNutzer('alice');
    await assertSucceeds(setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE));
});

// ---------------------------------------------------------------------
// Lesen (read)
// ---------------------------------------------------------------------

test('Nutzer darf eigene Liste lesen', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = echterNutzer('alice');
    await assertSucceeds(getDoc(doc(db, 'users/alice/listen/liste1')));
});

test('Nutzer darf NICHT die Liste eines anderen Kontos lesen', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = echterNutzer('bob');
    await assertFails(getDoc(doc(db, 'users/alice/listen/liste1')));
});

test('Nicht angemeldet darf keine Liste lesen', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users/alice/listen/liste1')));
});

// ---------------------------------------------------------------------
// Ändern (update) - umbenennen, Filme hinzufügen/entfernen/umsortieren
// ---------------------------------------------------------------------

test('Nutzer darf eigene Liste ändern (z. B. umbenennen)', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = echterNutzer('alice');
    await assertSucceeds(updateDoc(doc(db, 'users/alice/listen/liste1'),
        { kurzname: 'Neu', name: 'Ganz neuer Name' }));
});

test('Nutzer darf NICHT die Liste eines anderen Kontos ändern', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = echterNutzer('bob');
    await assertFails(updateDoc(doc(db, 'users/alice/listen/liste1'),
        { kurzname: 'Uebernommen', name: 'Uebernommen' }));
});

test('Anonymer Nutzer darf eigene(!) Liste nicht ändern', async () => {
    // Kommt in der Praxis nicht vor (anonym kann keine Liste anlegen),
    // stellt aber sicher, dass update genauso wie create istEchtAngemeldet
    // verlangt und sich nicht nur auf die uid-Prüfung verlässt.
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/anon1/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = anonymerNutzer('anon1');
    await assertFails(updateDoc(doc(db, 'users/anon1/listen/liste1'),
        { kurzname: 'Neu', name: 'Neu' }));
});

test('Update mit mehr als 50 Filmen wird abgelehnt', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = echterNutzer('alice');
    const zuVieleFilme = Array.from({ length: 51 }, (_, i) => ({ id: 'film-' + i }));
    await assertFails(updateDoc(doc(db, 'users/alice/listen/liste1'), { filme: zuVieleFilme }));
});

test('Update ist auch am 10er-Limit weiterhin erlaubt (Limit gilt nur beim Anlegen)', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE);
        await setDoc(doc(db, 'users/alice'), { listenCount: 10 });
    });
    const db = echterNutzer('alice');
    await assertSucceeds(updateDoc(doc(db, 'users/alice/listen/liste1'),
        { kurzname: 'Neu', name: 'Immer noch bearbeitbar' }));
});

// ---------------------------------------------------------------------
// Löschen (delete)
// ---------------------------------------------------------------------

test('Nutzer darf eigene Liste löschen', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = echterNutzer('alice');
    await assertSucceeds(deleteDoc(doc(db, 'users/alice/listen/liste1')));
});

test('Nutzer darf NICHT die Liste eines anderen Kontos löschen', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = echterNutzer('bob');
    await assertFails(deleteDoc(doc(db, 'users/alice/listen/liste1')));
});

test('Anonymer Nutzer darf eigene(!) Liste nicht löschen', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/anon1/listen/liste1'), GUELTIGE_LISTE);
    });
    const db = anonymerNutzer('anon1');
    await assertFails(deleteDoc(doc(db, 'users/anon1/listen/liste1')));
});
