/**
 * Sicherheitstests für die bisher UNGETESTETEN Firestore-Regeln (Issue #57):
 *
 *   - groups/{gid}                       (get/list/create/update/delete)
 *   - groups/{gid}/private/config        (Einladungscode, nur Admin)
 *   - groups/{gid}/claims/{claimCode}    (Übergabe-Dokumente für Wiedereinstieg)
 *   - groups/{gid}/members/{uid}         (Beitritt/Verwaltung, ergänzend zur
 *                                          ratings-Typprüfung aus Issue #54,
 *                                          siehe firestore-members-ratings.rules.test.js)
 *   - users/{uid}                        (Top-Level-Nutzerdokument)
 *
 * Diese Datei ergänzt firestore-listen.rules.test.js (users/{uid}/listen/*,
 * groups/{gid}/geteilteListen/*) und firestore-members-ratings.rules.test.js
 * (nur die ratings-Typprüfung von members/{uid}) - zusammen decken die drei
 * Dateien jetzt alle Pfade aus firestore.rules ab.
 *
 * Einmalige Einrichtung und Ausführung: siehe Kopfkommentar in
 * firestore-listen.rules.test.js (derselbe Emulator, dieselbe Anleitung).
 *     firebase emulators:exec --only firestore "node tests/firestore-groups-core.rules.test.js"
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
    doc, setDoc, getDoc, updateDoc, deleteDoc,
    collection, query, where, getDocs
} = require('firebase/firestore');

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
// eines Tests, nicht Teil des zu testenden Verhaltens selbst.
async function alsAdmin(aufgabe) {
    await testEnv.withSecurityRulesDisabled(async context => {
        await aufgabe(context.firestore());
    });
}

// Offene Gruppe samt Einladungscode - Ausgangszustand für die meisten Tests.
async function grundGruppe(gid, adminUid, inviteCode) {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'groups', gid), { adminUid, name: 'Testgruppe', locked: false });
        await setDoc(doc(db, 'groups', gid, 'private', 'config'), { inviteCode });
    });
}

async function mitglied(gid, uid, zusatz = {}) {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'groups', gid, 'members', uid), { name: uid, ...zusatz });
    });
}

const GID = 'gruppeA';
const INVITE_CODE = 'einladungscode-lang-genug';

// =======================================================================
// groups/{gid}
// =======================================================================

// --- get ---

test('Angemeldeter Nutzer darf die Eckdaten einer beliebigen Gruppe lesen (get)', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('fremder'); // kein Mitglied, kein Admin
    await assertSucceeds(getDoc(doc(db, 'groups', GID)));
});

test('Anonymer Nutzer darf die Eckdaten einer Gruppe lesen (get)', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = anonymerNutzer('anon1');
    await assertSucceeds(getDoc(doc(db, 'groups', GID)));
});

test('Nicht angemeldeter Nutzer darf die Eckdaten einer Gruppe NICHT lesen (get)', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'groups', GID)));
});

// --- list ---

test('Admin darf seine eigenen Gruppen auflisten (mit adminUid-Filter)', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('admin1');
    const q = query(collection(db, 'groups'), where('adminUid', '==', 'admin1'));
    await assertSucceeds(getDocs(q));
});

test('Auflisten mit Filter auf eine fremde adminUid wird abgelehnt', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('admin1');
    const q = query(collection(db, 'groups'), where('adminUid', '==', 'jemand-anders'));
    await assertFails(getDocs(q));
});

test('Unbeschränktes Auflisten aller Gruppen wird abgelehnt, sobald fremde dabei sind', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await grundGruppe('gruppeB', 'admin2', 'anderer-code-lang-genug');
    const db = echterNutzer('admin1');
    await assertFails(getDocs(collection(db, 'groups')));
});

// --- create ---

test('Echter Nutzer darf eine eigene Gruppe anlegen', async () => {
    const db = echterNutzer('alice');
    await assertSucceeds(setDoc(doc(db, 'groups', GID),
        { adminUid: 'alice', name: 'Meine Gruppe', locked: false }));
});

test('Anonymer Nutzer darf KEINE Gruppe anlegen', async () => {
    const db = anonymerNutzer('anon1');
    await assertFails(setDoc(doc(db, 'groups', GID),
        { adminUid: 'anon1', name: 'Meine Gruppe', locked: false }));
});

test('Nutzer darf KEINE Gruppe mit fremder adminUid anlegen (Spoofing)', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID),
        { adminUid: 'bob', name: 'Meine Gruppe', locked: false }));
});

test('Gruppenname leer wird beim Anlegen abgelehnt', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID),
        { adminUid: 'alice', name: '', locked: false }));
});

test('Gruppenname über 60 Zeichen wird beim Anlegen abgelehnt', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID),
        { adminUid: 'alice', name: 'x'.repeat(61), locked: false }));
});

test('Gruppe mit locked: true wird beim Anlegen abgelehnt', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID),
        { adminUid: 'alice', name: 'Meine Gruppe', locked: true }));
});

test('Gruppe ohne locked-Feld wird beim Anlegen abgelehnt', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID),
        { adminUid: 'alice', name: 'Meine Gruppe' }));
});

test('Am 20er-Limit wird das Anlegen einer weiteren Gruppe abgelehnt', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice'), { groupCount: 20 });
    });
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID),
        { adminUid: 'alice', name: 'Meine Gruppe', locked: false }));
});

test('Unter dem 20er-Limit ist das Anlegen weiterhin erlaubt', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users/alice'), { groupCount: 19 });
    });
    const db = echterNutzer('alice');
    await assertSucceeds(setDoc(doc(db, 'groups', GID),
        { adminUid: 'alice', name: 'Meine Gruppe', locked: false }));
});

// --- update ---

test('Admin darf seine Gruppe umbenennen und sperren', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('admin1');
    await assertSucceeds(updateDoc(doc(db, 'groups', GID),
        { name: 'Neuer Name', locked: true }));
});

test('Nicht-Admin darf die Gruppe NICHT ändern', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob');
    const db = echterNutzer('bob');
    await assertFails(updateDoc(doc(db, 'groups', GID), { name: 'Übernommen' }));
});

test('Admin darf die Adminrolle an ein bestehendes Mitglied abgeben', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob');
    const db = echterNutzer('admin1');
    await assertSucceeds(updateDoc(doc(db, 'groups', GID), { adminUid: 'bob' }));
});

test('Admin darf die Adminrolle NICHT an ein Nicht-Mitglied verschenken', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('admin1');
    await assertFails(updateDoc(doc(db, 'groups', GID), { adminUid: 'fremder' }));
});

// --- delete ---

test('Admin darf seine Gruppe löschen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('admin1');
    await assertSucceeds(deleteDoc(doc(db, 'groups', GID)));
});

test('Nicht-Admin darf die Gruppe NICHT löschen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob');
    const db = echterNutzer('bob');
    await assertFails(deleteDoc(doc(db, 'groups', GID)));
});

// =======================================================================
// groups/{gid}/private/config
// =======================================================================

test('Admin darf private/config lesen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('admin1');
    await assertSucceeds(getDoc(doc(db, 'groups', GID, 'private', 'config')));
});

test('Admin darf private/config schreiben', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('admin1');
    await assertSucceeds(setDoc(doc(db, 'groups', GID, 'private', 'config'),
        { inviteCode: 'neuer-code-lang-genug' }));
});

test('Gruppenmitglied (nicht Admin) darf private/config NICHT lesen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob');
    const db = echterNutzer('bob');
    await assertFails(getDoc(doc(db, 'groups', GID, 'private', 'config')));
});

test('Fremder ohne Gruppenbezug darf private/config NICHT lesen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('fremder');
    await assertFails(getDoc(doc(db, 'groups', GID, 'private', 'config')));
});

test('Nicht angemeldeter Nutzer darf private/config NICHT lesen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'groups', GID, 'private', 'config')));
});

// =======================================================================
// groups/{gid}/claims/{claimCode}
// =======================================================================

const CLAIM_CODE = 'uebergabe-code-lang-genug';

async function claimAnlegen(gid, code, daten) {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'groups', gid, 'claims', code), daten);
    });
}

// --- get ---

test('Angemeldeter Nutzer, der den claimCode kennt, darf das Übergabe-Dokument lesen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await claimAnlegen(GID, CLAIM_CODE, { name: 'Bob', ratings: {} });
    const db = echterNutzer('irgendwer'); // weder Mitglied noch Admin - der Code selbst ist das Geheimnis
    await assertSucceeds(getDoc(doc(db, 'groups', GID, 'claims', CLAIM_CODE)));
});

test('Nicht angemeldeter Nutzer darf das Übergabe-Dokument NICHT lesen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await claimAnlegen(GID, CLAIM_CODE, { name: 'Bob', ratings: {} });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'groups', GID, 'claims', CLAIM_CODE)));
});

// --- list ---

test('Admin darf die Übergabe-Codes auflisten', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await claimAnlegen(GID, CLAIM_CODE, { name: 'Bob', ratings: {} });
    const db = echterNutzer('admin1');
    await assertSucceeds(getDocs(collection(db, 'groups', GID, 'claims')));
});

test('Nicht-Admin darf die Übergabe-Codes NICHT auflisten (sonst durchsuchbar)', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob');
    await claimAnlegen(GID, CLAIM_CODE, { name: 'Bob', ratings: {} });
    const db = echterNutzer('bob');
    await assertFails(getDocs(collection(db, 'groups', GID, 'claims')));
});

// --- create / update ---

test('Admin darf ein Übergabe-Dokument anlegen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('admin1');
    await assertSucceeds(setDoc(doc(db, 'groups', GID, 'claims', CLAIM_CODE),
        { name: 'Bob', ratings: {} }));
});

test('Nicht-Admin darf KEIN Übergabe-Dokument anlegen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob');
    const db = echterNutzer('bob');
    await assertFails(setDoc(doc(db, 'groups', GID, 'claims', CLAIM_CODE),
        { name: 'Bob', ratings: {} }));
});

test('Admin darf ein Übergabe-Dokument aktualisieren', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await claimAnlegen(GID, CLAIM_CODE, { name: 'Bob', ratings: {} });
    const db = echterNutzer('admin1');
    await assertSucceeds(updateDoc(doc(db, 'groups', GID, 'claims', CLAIM_CODE),
        { name: 'Bob (aktualisiert)' }));
});

test('Nicht-Admin darf ein Übergabe-Dokument NICHT aktualisieren', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob');
    await claimAnlegen(GID, CLAIM_CODE, { name: 'Bob', ratings: {} });
    const db = echterNutzer('bob');
    await assertFails(updateDoc(doc(db, 'groups', GID, 'claims', CLAIM_CODE),
        { name: 'Übernommen' }));
});

// --- delete ---

test('Angemeldeter Nutzer darf ein Übergabe-Dokument nach dem Einlösen löschen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await claimAnlegen(GID, CLAIM_CODE, { name: 'Bob', ratings: {} });
    const db = echterNutzer('bob'); // kein Admin, kein Mitglied - Löschen ist bewusst offen
    await assertSucceeds(deleteDoc(doc(db, 'groups', GID, 'claims', CLAIM_CODE)));
});

test('Nicht angemeldeter Nutzer darf ein Übergabe-Dokument NICHT löschen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await claimAnlegen(GID, CLAIM_CODE, { name: 'Bob', ratings: {} });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(deleteDoc(doc(db, 'groups', GID, 'claims', CLAIM_CODE)));
});

// =======================================================================
// groups/{gid}/members/{uid}
//
// Ergänzt firestore-members-ratings.rules.test.js (dort nur die
// ratings-Typprüfung aus Issue #54) um die übrigen Aspekte dieser Regel:
// get/list, Beitritt per Einladungscode vs. per Wiedereinstiegs-claimCode,
// Admin-Namensänderung, Austreten/Rauswurf.
// =======================================================================

// --- get / list ---

test('Gruppenmitglied darf die Mitgliederliste auflisten', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'admin1');
    await mitglied(GID, 'bob');
    const db = echterNutzer('bob');
    await assertSucceeds(getDocs(collection(db, 'groups', GID, 'members')));
});

test('Fremder ohne Gruppenmitgliedschaft darf die Mitgliederliste NICHT auflisten', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob');
    const db = echterNutzer('fremder');
    await assertFails(getDocs(collection(db, 'groups', GID, 'members')));
});

test('Admin darf ein einzelnes Mitglieds-Dokument lesen, auch ohne selbst Mitglied zu sein', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob');
    const db = echterNutzer('admin1');
    await assertSucceeds(getDoc(doc(db, 'groups', GID, 'members', 'bob')));
});

// --- create: Beitritt per Einladungscode ---

test('Beitritt mit falschem Einladungscode wird abgelehnt', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID, 'members', 'alice'),
        { name: 'Alice', inviteCode: 'falscher-code' }));
});

test('Beitritt bei gesperrter Gruppe ohne claimCode wird abgelehnt', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'groups', GID), { adminUid: 'admin1', name: 'Testgruppe', locked: true });
        await setDoc(doc(db, 'groups', GID, 'private', 'config'), { inviteCode: INVITE_CODE });
    });
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID, 'members', 'alice'),
        { name: 'Alice', inviteCode: INVITE_CODE }));
});

test('Beitritt unter einer fremden uid wird abgelehnt', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID, 'members', 'bob'),
        { name: 'Alice', inviteCode: INVITE_CODE }));
});

test('Beitritt mit leerem Namen wird abgelehnt', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID, 'members', 'alice'),
        { name: '', inviteCode: INVITE_CODE }));
});

test('Beitritt mit Namen über 40 Zeichen wird abgelehnt', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID, 'members', 'alice'),
        { name: 'x'.repeat(41), inviteCode: INVITE_CODE }));
});

// --- create: Wiedereinstieg per claimCode ---

test('Wiedereinstieg mit gültigem claimCode funktioniert auch bei gesperrter Gruppe', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'groups', GID), { adminUid: 'admin1', name: 'Testgruppe', locked: true });
        await setDoc(doc(db, 'groups', GID, 'private', 'config'), { inviteCode: INVITE_CODE });
    });
    await claimAnlegen(GID, CLAIM_CODE, { name: 'Bob', ratings: { 'iron-man-2008': { value: 5, updatedAt: 1 } } });
    const db = echterNutzer('bob');
    await assertSucceeds(setDoc(doc(db, 'groups', GID, 'members', 'bob'),
        { name: 'Bob', claimCode: CLAIM_CODE, ratings: { 'iron-man-2008': { value: 5, updatedAt: 1 } } }));
});

test('Wiedereinstieg mit einem nicht existierenden claimCode wird abgelehnt', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('bob');
    await assertFails(setDoc(doc(db, 'groups', GID, 'members', 'bob'),
        { name: 'Bob', claimCode: 'code-der-nie-existiert-hat' }));
});

test('Wiedereinstieg mit leerem claimCode wird abgelehnt', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    const db = echterNutzer('bob');
    await assertFails(setDoc(doc(db, 'groups', GID, 'members', 'bob'), { name: 'Bob' }));
});

// --- update ---

test('Admin darf ausschließlich den Namen eines Mitglieds ändern', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob', { inviteCode: INVITE_CODE, ratings: {} });
    const db = echterNutzer('admin1');
    await assertSucceeds(updateDoc(doc(db, 'groups', GID, 'members', 'bob'), { name: 'Korrigiert' }));
});

test('Admin darf über das Namens-Update NICHT zusätzlich die Bewertungen ändern', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'bob', { inviteCode: INVITE_CODE, ratings: {} });
    const db = echterNutzer('admin1');
    await assertFails(updateDoc(doc(db, 'groups', GID, 'members', 'bob'),
        { name: 'Korrigiert', 'ratings.iron-man-2008': { value: 5, updatedAt: 1 } }));
});

test('Mitglied darf seinen inviteCode nachträglich NICHT ändern', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'alice', { inviteCode: INVITE_CODE, ratings: {} });
    const db = echterNutzer('alice');
    await assertFails(updateDoc(doc(db, 'groups', GID, 'members', 'alice'),
        { inviteCode: 'anderer-code' }));
});

// --- delete ---

test('Mitglied darf selbst aus der Gruppe austreten', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'alice', { inviteCode: INVITE_CODE, ratings: {} });
    const db = echterNutzer('alice');
    await assertSucceeds(deleteDoc(doc(db, 'groups', GID, 'members', 'alice')));
});

test('Admin darf ein Mitglied aus der Gruppe entfernen (Rauswurf)', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'alice', { inviteCode: INVITE_CODE, ratings: {} });
    const db = echterNutzer('admin1');
    await assertSucceeds(deleteDoc(doc(db, 'groups', GID, 'members', 'alice')));
});

test('Ein Mitglied darf ein ANDERES Mitglied NICHT entfernen', async () => {
    await grundGruppe(GID, 'admin1', INVITE_CODE);
    await mitglied(GID, 'alice', { inviteCode: INVITE_CODE, ratings: {} });
    await mitglied(GID, 'bob', { inviteCode: INVITE_CODE, ratings: {} });
    const db = echterNutzer('bob');
    await assertFails(deleteDoc(doc(db, 'groups', GID, 'members', 'alice')));
});

// =======================================================================
// users/{uid} (Top-Level-Dokument)
// =======================================================================

test('Nutzer darf sein eigenes Top-Level-Dokument lesen', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users', 'alice'), { groupCount: 1, listenCount: 2 });
    });
    const db = echterNutzer('alice');
    await assertSucceeds(getDoc(doc(db, 'users', 'alice')));
});

test('Nutzer darf sein eigenes Top-Level-Dokument schreiben', async () => {
    const db = echterNutzer('alice');
    await assertSucceeds(setDoc(doc(db, 'users', 'alice'), { groupCount: 1 }));
});

test('Nutzer darf das Top-Level-Dokument eines anderen NICHT lesen', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users', 'alice'), { groupCount: 1 });
    });
    const db = echterNutzer('bob');
    await assertFails(getDoc(doc(db, 'users', 'alice')));
});

test('Nutzer darf das Top-Level-Dokument eines anderen NICHT schreiben', async () => {
    const db = echterNutzer('bob');
    await assertFails(setDoc(doc(db, 'users', 'alice'), { groupCount: 999 }));
});

test('Nicht angemeldeter Nutzer darf KEIN Top-Level-Dokument lesen oder schreiben', async () => {
    await alsAdmin(async db => {
        await setDoc(doc(db, 'users', 'alice'), { groupCount: 1 });
    });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users', 'alice')));
    await assertFails(setDoc(doc(db, 'users', 'irgendwer'), { groupCount: 1 }));
});

test('Anonymer Nutzer darf sein eigenes Top-Level-Dokument lesen und schreiben', async () => {
    const db = anonymerNutzer('anon1');
    await assertSucceeds(setDoc(doc(db, 'users', 'anon1'), { groupCount: 1 }));
    await assertSucceeds(getDoc(doc(db, 'users', 'anon1')));
});
