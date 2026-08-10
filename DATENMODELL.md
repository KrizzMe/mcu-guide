# Datenmodell: Gruppen und eigene Listen

Stand: Relaunch Stufe 4 (Issue #39). Beschreibt, wie Gruppen, Mitglieder,
geteilte Bewertungen sowie eigene (kontogebundene) Listen und deren Teilen in
Firestore abgelegt sind und warum.

Die tatsächlich gültigen Zugriffsregeln liegen seit Issue #37 zusätzlich
versioniert in [`firestore.rules`](firestore.rules) im Projektordner - vorher
existierten sie ausschließlich in der Firebase Console. Änderungen an dieser
Datei müssen weiterhin manuell in der Console übernommen werden (kein
automatisches Deployment aus dem Repo).

## Übersicht

```
users/{uid}
    groupCount: number           Anzahl selbst angelegter Gruppen (Limit 20)
    listenCount: number          Anzahl eigener Listen im Konto (Limit 10)

users/{uid}/listen/{listeId}     Eigene, kontogebundene Liste (Relaunch Stufe 3)
    kurzname: string             Für die Navigation, max. 15 Zeichen
    name: string                 Für Überschriften, max. 40 Zeichen
    filme: [ { id, tmdb, poster, desc }, ... ]     Max. 50 Einträge
    geteiltInGruppen: [ groupId, ... ]             Max. 5 Gruppen (Stufe 4)

groups/{groupId}                groupId = zufällig, dient als Teil des Einladungslinks
    name: string                Anzeigename der Gruppe
    adminUid: string            Kennung des Erstellers
    locked: boolean             true = kein Beitritt mehr möglich
    createdAt: timestamp

groups/{groupId}/private/config     Nur für den Admin lesbar
    inviteCode: string              Zweites Geheimnis des Einladungslinks

groups/{groupId}/members/{uid}      Ein Dokument pro Person
    name: string                    Selbst gewählter Anzeigename
    inviteCode: string              Beim Beitritt geprüfter Code
    joinedAt: timestamp
    updatedAt: timestamp
    ratings: {                      ALLE Bewertungen dieser Person
        "iron-man-2008": { value: 4, updatedAt: 1785661566168 },
        ...
    }

groups/{groupId}/geteilteListen/{ownerUid}_{listeId}    Zeiger (Relaunch Stufe 4)
    ownerUid: string             Wessen Liste
    listeId: string              Welche Liste (siehe users/{uid}/listen/{listeId})
```

## Warum alle Bewertungen in einem Dokument?

Firestore rechnet Lesevorgänge pro Dokument ab. Bei fünf Familienmitgliedern
kostet das Anzeigen einer kompletten Gruppe damit **5 Lesevorgänge statt 235**
(5 Personen x 47 Filme). Beim kostenlosen Kontingent von 50.000 Lesevorgängen
pro Tag ist beides unkritisch, aber die Variante ist schneller und einfacher.

Der theoretische Nachteil - gleichzeitiges Schreiben am selben Dokument könnte
eine Änderung überschreiben - tritt praktisch nicht auf, da jede Person
ausschließlich ihr eigenes Dokument beschreibt.

## Warum ist der Einladungscode nicht im Gruppen-Dokument?

Der Einladungslink besteht aus zwei Teilen: der `groupId` und dem `inviteCode`.
Läge der Code im Gruppen-Dokument, könnte jeder, der eine alte `groupId` kennt,
dort den **neuen** Code nachlesen - "Link neu erzeugen" wäre damit wirkungslos.

Deshalb liegt er in `private/config`, das ausschließlich der Admin lesen darf.
Die Zugriffsregeln selbst dürfen es trotzdem lesen (sie laufen serverseitig) und
können beim Beitritt prüfen, ob der mitgeschickte Code stimmt.

Der Code landet dabei auch im Mitglieds-Dokument, ist also für andere Mitglieder
derselben Gruppe sichtbar. Das ist bewusst in Kauf genommen: Wer bereits in der
Gruppe ist, hat den Code ohnehin. Für Außenstehende bleibt er unsichtbar, da
Mitglieds-Dokumente nur von Mitgliedern gelesen werden dürfen.

## Warum ist bei eigenen Listen Firestore die führende Quelle?

Bewusste Abweichung vom sonstigen Grundsatz "lokal ist führend" (siehe
Bewertungen oben): Sobald eine Liste kontogebunden ist (Relaunch Stufe 3),
gilt Firestore als Wahrheit, `localStorage` ist nur noch Anzeige-Cache. Grund:
Eine kontogebundene Liste soll geräteübergreifend UND für Gruppenmitglieder
sichtbar sein - das geht nur, wenn es eine einzige, serverseitige Quelle gibt.
Bearbeiten setzt deshalb bewusst eine Internetverbindung voraus (keine
Offline-Warteschlange wie bei Bewertungen); ohne Verbindung oder Anmeldung ist
die Liste nur lesbar.

## Warum ein Zeiger-Dokument statt direkter Suche nach geteilten Listen?

Naheliegend wäre gewesen, geteilte Listen über eine Firestore-Collection-
Group-Abfrage zu finden (alle `listen`-Unterkollektionen gleichzeitig
durchsuchen, gefiltert nach `geteiltInGruppen array-contains meineGruppenId`).
Das scheiterte im echten Test mit `permission-denied`, obwohl ein einzelner
`getDoc()` auf genau dasselbe Dokument mit derselben Regel einwandfrei
funktionierte - Firestore-Sicherheitsregeln unterstützen `exists()`-Prüfungen
für Collection-Group-Abfragen über Sammlungsgrenzen hinweg offenbar nicht
zuverlässig, auch wenn sie für ein einzelnes Dokument korrekt auswerten.

Deshalb gibt es stattdessen `groups/{groupId}/geteilteListen` - ein reiner
Zeiger (`ownerUid` + `listeId`), abgesichert über dasselbe, seit Jahren
bewährte Muster wie die Mitgliederliste (`istMitglied` auf eine bekannte,
einzelne Gruppe). Der eigentliche Lesezugriff auf den Listeninhalt läuft
unabhängig davon weiterhin direkt über `users/{uid}/listen/{listeId}` mit
`geteiltInGruppen` - das hat sich als korrekt erwiesen, nur das AUFFINDEN
brauchte einen anderen Weg. Warum eine feste Obergrenze von 5 gleichzeitig
geteilten Gruppen: Firestore-Regeln können nicht über ein Array laufen und
dabei je Eintrag `exists()` aufrufen (harte Grenze der Regel-Sprache) - die
Deckelung erlaubt stattdessen eine fest ausgerollte Prüfung
(`istMitgliedEinerDieserGruppen` in `firestore.rules`), die bei jedem
Lesezugriff live die echte Mitgliedschaft prüft. Rausschmiss aus einer Gruppe
oder deren Auflösung wirkt dadurch sofort, ganz ohne die geteilte Liste selbst
anzufassen.

## Wer darf was?

| Aktion | Erlaubt für |
|---|---|
| Gruppe anlegen | Nur angemeldete Nutzer (Google/E-Mail-Link), nicht anonym |
| Eigene Gruppen auflisten | Nur der jeweilige Admin |
| Gruppen-Eckdaten lesen | Jeder Angemeldete, der die groupId kennt |
| Einladungscode lesen | Nur der Admin |
| Gruppe sperren/umbenennen | Nur der Admin |
| Beitreten | Jeder Angemeldete mit korrektem Code, solange nicht gesperrt |
| Mitglieder + Bewertungen lesen | Nur Mitglieder derselben Gruppe (und der Admin) |
| Eigene Bewertungen schreiben | Nur man selbst |
| Mitglied entfernen | Man selbst oder der Admin |
| Eigene Liste anlegen/ändern/löschen | Nur der Besitzer, und nur echt angemeldet |
| Eigene Liste lesen | Der Besitzer, oder Mitglied einer Gruppe, mit der sie geteilt ist |
| Zeiger auf geteilte Liste lesen | Nur Mitglieder derselben Gruppe (und der Admin) |
| Zeiger auf geteilte Liste anlegen | Nur der Besitzer der Liste, und nur als Mitglied der Zielgruppe |
| Zeiger auf geteilte Liste löschen | Der Besitzer (Teilen beenden) oder der Gruppen-Admin |

## Bekannte Einschränkungen

- **Das 20-Gruppen-Limit ist nicht manipulationssicher.** Der Zähler in
  `users/{uid}` wird von der App gepflegt; wer die Anfragen direkt stellt,
  könnte ihn umgehen. Als Schutz gegen versehentliche Massenanlage reicht es,
  als harte Sperre nicht. Da Gruppen-Erstellung eine echte Anmeldung erfordert,
  ist der Missbrauchsanreiz gering.

- **"Bewertungen anderer erst nach eigener Abgabe sichtbar" ist eine Regel der
  Oberfläche**, keine Zugriffssperre. Wer technisch versiert ist, könnte die
  Daten früher sehen. Für den Familienkreis akzeptiert.

- **Beim Löschen einer Gruppe werden Unterdokumente nicht automatisch mit
  gelöscht.** Mitglieder und Einladungscode müssen einzeln entfernt werden.

- **Das 10-Listen-Limit im Konto ist genauso wenig manipulationssicher wie das
  Gruppen-Limit** (`listenCount` in `users/{uid}`, App-gepflegt) - dieselbe
  akzeptierte Einschränkung, aus demselben Grund (echte Anmeldung nötig).

- **Zeiger auf geteilte Listen (`groups/{gid}/geteilteListen`) werden beim
  Löschen einer Gruppe oder eines Kontos nicht automatisch mit entfernt** -
  dieselbe Einschränkung wie bei Gruppen-Unterdokumenten oben. Praktisch
  unkritisch: Ein verwaister Zeiger zeigt auf eine dann nicht mehr existierende
  Liste, `geteilteListenLaden()` in `groups.js` überspringt ihn beim nächsten
  Laden einfach still (kein Fehler, keine Sicherheitslücke - nur ein
  ungenutztes Dokument, das liegen bleibt).
