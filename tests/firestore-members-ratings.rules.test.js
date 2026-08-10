/**
 * Sicherheitstests für die Firestore-Regel groups/{gid}/members/{uid},
 * speziell die mit Issue #54 ergänzte Typprüfung von "ratings" beim
 * Anlegen und Ändern eines Mitglieds-Dokuments.
 *
 * Vorher gab es hier KEINE Prüfung des ratings-Feldes - ein Mitglied
 * konnte es beim Update auf einen beliebigen Typ (z. B. einen String)
 * setzen, was app.js beim Rendern der Gruppen-Bewertungen (buildGroupInfo)
 * ungeprüft ausgewertet hätte. Diese Datei prüft NUR die members-Regel;
 * für die übrigen Gruppen-Pfade (groups/{gid}, claims, private/config,
 * geteilteListen) gibt es weiterhin keine Tests (siehe Issue #57).
 *
 * Einmalige Einrichtung und Ausführung: siehe Kopfkommentar in
 * firestore-listen.rules.test.js (derselbe Emulator, dieselbe Anleitung).
 *     firebase emulators:exec --only firestore "node tests/firestore-members-ratings.rules.test.js"
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
    doc, setDoc, updateDoc
} = require('firebase/firestore');

const GID = 'gruppe1';
const INVITE_CODE = 'einladungscode-lang-genug';

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
    // Offene Gruppe mit Admin "admin1" und Einladungscode - Ausgangszustand
    // für alle Tests dieser Datei, unter Umgehung der Regeln angelegt.
    await testEnv.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, 'groups', GID), {
            adminUid: 'admin1', name: 'Testgruppe', locked: false
        });
        await setDoc(doc(db, 'groups', GID, 'private', 'config'), {
            inviteCode: INVITE_CODE
        });
    });
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

// ---------------------------------------------------------------------
// Beitritt (create)
// ---------------------------------------------------------------------

test('echter Nutzer darf mit gültigem Einladungscode und ohne ratings-Feld beitreten', async () => {
    const db = echterNutzer('alice');
    await assertSucceeds(setDoc(doc(db, 'groups', GID, 'members', 'alice'), {
        name: 'Alice', inviteCode: INVITE_CODE
    }));
});

test('echter Nutzer darf mit gültigem Einladungscode und ratings als Map beitreten', async () => {
    const db = echterNutzer('alice');
    await assertSucceeds(setDoc(doc(db, 'groups', GID, 'members', 'alice'), {
        name: 'Alice', inviteCode: INVITE_CODE, ratings: { 'iron-man-2008': { value: 5, updatedAt: 1 } }
    }));
});

test('anonymer Nutzer darf mit gültigem Einladungscode und ratings als Map beitreten', async () => {
    const db = anonymerNutzer('anon1');
    await assertSucceeds(setDoc(doc(db, 'groups', GID, 'members', 'anon1'), {
        name: 'Gast', inviteCode: INVITE_CODE, ratings: { 'iron-man-2008': { value: 3, updatedAt: 1 } }
    }));
});

test('Beitritt mit ratings als String (statt Map) wird abgelehnt', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID, 'members', 'alice'), {
        name: 'Alice', inviteCode: INVITE_CODE, ratings: '<img src=x onerror=alert(1)>'
    }));
});

test('Beitritt mit ratings als Array (statt Map) wird abgelehnt', async () => {
    const db = echterNutzer('alice');
    await assertFails(setDoc(doc(db, 'groups', GID, 'members', 'alice'), {
        name: 'Alice', inviteCode: INVITE_CODE, ratings: ['<img src=x onerror=alert(1)>']
    }));
});

// ---------------------------------------------------------------------
// Eigene Bewertungen ändern (update)
// ---------------------------------------------------------------------

test('Mitglied darf eigene Bewertungen mit gültiger Map aktualisieren', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'groups', GID, 'members', 'alice'), {
            name: 'Alice', inviteCode: INVITE_CODE, ratings: {}
        });
    });
    const db = echterNutzer('alice');
    await assertSucceeds(updateDoc(doc(db, 'groups', GID, 'members', 'alice'), {
        'ratings.iron-man-2008': { value: 4, updatedAt: 2 }
    }));
});

test('Mitglied darf ratings NICHT auf einen String setzen (Issue #54)', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'groups', GID, 'members', 'alice'), {
            name: 'Alice', inviteCode: INVITE_CODE, ratings: {}
        });
    });
    const db = echterNutzer('alice');
    await assertFails(updateDoc(doc(db, 'groups', GID, 'members', 'alice'), {
        ratings: '<img src=x onerror=alert(document.cookie)>'
    }));
});

test('Mitglied darf ratings NICHT auf ein Array setzen (Issue #54)', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'groups', GID, 'members', 'alice'), {
            name: 'Alice', inviteCode: INVITE_CODE, ratings: {}
        });
    });
    const db = echterNutzer('alice');
    await assertFails(updateDoc(doc(db, 'groups', GID, 'members', 'alice'), {
        ratings: [{ value: '<img src=x onerror=alert(1)>' }]
    }));
});

test('fremdes Mitglied darf die Bewertungen von Alice nicht ändern', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'groups', GID, 'members', 'alice'), {
            name: 'Alice', inviteCode: INVITE_CODE, ratings: {}
        });
    });
    const db = echterNutzer('mallory');
    await assertFails(updateDoc(doc(db, 'groups', GID, 'members', 'alice'), {
        'ratings.iron-man-2008': { value: 5, updatedAt: 99 }
    }));
});
