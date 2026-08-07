# Datenmodell der Gruppenfunktion

Stand: Schritt 2 von Issue #16. Beschreibt, wie Gruppen, Mitglieder und geteilte
Bewertungen in Firestore abgelegt sind und warum.

## Übersicht

```
users/{uid}
    groupCount: number          Anzahl selbst angelegter Gruppen (Limit 20)

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
