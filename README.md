# My Movie Guide

Ein privater Fan-Guide für mehrere kuratierte Filmreihen (aktuell Marvel
Cinematic Universe, Star Wars und DC Universe, weitere folgen) – jeweils in
einer eigenen empfohlenen Reihenfolge für gemeinsame Familien-Filmabende.

**Live:** https://mymovieguide.de/

## Funktionen

- Mehrere Filmlisten (MCU, Star Wars, DC, ...) mit Poster, Kurzbeschreibung
  und Link zu TMDb; Titel und Laufzeit werden live von TMDb geladen
- Bewertung pro Film über Popcorn-Tüten (0–5)
- Fortschrittsanzeige direkt in der Navigation: jeder Menüpunkt füllt sich
  grün, je mehr Filme der jeweiligen Sektion bewertet ("gesehen") wurden
- Auswahl bevorzugter Streaming-Anbieter mit Verfügbarkeitsanzeige je Film
  (Daten von TMDb/JustWatch)
- Responsive Gestaltung mit eigenem Poster-Layout für Desktop und Mobile
- **Gruppen:** Bewertungen lassen sich mit der Familie teilen – ohne dass
  Mitglieder sich anmelden müssen (Details siehe [`DATENMODELL.md`](DATENMODELL.md))

## Dateistruktur

| Datei / Ordner | Zweck |
|---|---|
| `index.html` | Seitenstruktur (Markup) |
| `styles.css` | Komplettes CSS |
| `app.js` | Lädt `lists/manifest.json` und die aktive Listendatei, baut Navigation und Filmkarten auf, Bewertungen, Fortschrittsanzeige, Streaming-Anbieter |
| `ui.js` | Poster-Großansicht, mobiles Menü, Wischgeste |
| `groups.js` | Gruppenfunktion: Anmeldung, Beitritt, Abgleich, Verwaltung (Firebase) |
| `lists/manifest.json` | Katalog aller Filmreihen (id, Name, Kurzname, Pfad zur Listendatei, Hintergrundbild) |
| `lists/mcu.json`, `lists/star-wars.json`, `lists/dc.json`, ... | Filmdaten je Filmreihe, aufgeteilt in Sektionen (siehe unten) |
| `posters/<listen-id>/` | Lokale Poster-Bilder je Filmreihe, Dateiname = `id` aus der jeweiligen Listendatei |
| `manifest.json` | PWA-Manifest (App-Icon, Metadaten für "Zum Homescreen hinzufügen") – nicht zu verwechseln mit `lists/manifest.json` |
| `m.png`, `fav32.png` | App-Icon bzw. Favicon |
| `tmdb-logo.svg`, `justwatch-icon.svg` | Icons für die Verlinkung zu TMDb bzw. JustWatch |
| `firestore.rules` | Versionierte Kopie der Firestore-Zugriffsregeln |
| `tests/` | Sicherheitstests der Firestore-Regeln gegen den lokalen Emulator (siehe Kopfkommentar der jeweiligen Datei) |
| `DATENMODELL.md` | Aufbau der Gruppenfunktion in Firestore, Zugriffsregeln |

## Einen Film hinzufügen

1. Die passende Datei unter `lists/` öffnen (z. B. `lists/mcu.json`) und die
   passende Sektion suchen (z. B. `Erste_Helden`).
2. Im `movies`-Array der Sektion ein neues Objekt ergänzen:

   ```json
   {
       "id": "iron-man-2008",
       "poster": "posters/mcu/iron-man-2008.jpg",
       "desc": "Kurze Beschreibung des Films.",
       "tmdb": "https://www.themoviedb.org/movie/1726-iron-man"
   }
   ```

   Die `id` muss innerhalb der Datei eindeutig sein (wird u. a. für
   Bewertungen und den Poster-Dateinamen verwendet). Titel und Laufzeit
   stehen bewusst **nicht** in der Datei – sie werden beim Anzeigen live
   von TMDb geladen (7-Tage-Zwischenspeicherung im Browser) und dafür aus
   der `tmdb`-URL abgeleitet.

3. Das passende Poster-Bild unter `posters/<listen-id>/<id>.jpg` ablegen –
   der Dateiname muss exakt der `id` entsprechen. TMDb-Dateinamen weichen
   davon oft ab, also nach dem Herunterladen den tatsächlichen Dateinamen
   prüfen statt zu raten.
4. Änderungen lokal testen (siehe unten), dann die geänderte Datei unter
   `lists/` und das neue Poster ins Repository hochladen.

## Lokal testen

`app.js` lädt `lists/manifest.json` und die Listendateien per `fetch()` nach –
das funktioniert aus Sicherheitsgründen der Browser **nicht**, wenn man
`index.html` einfach per Doppelklick öffnet (`file://`-Adresse). Stattdessen
einen kleinen lokalen Webserver starten:

```bash
python3 -m http.server
```

(unter Windows ggf. `python` statt `python3`). Danach im Browser
`http://localhost:8000` aufrufen.

Bei Änderungen an `app.js`, `ui.js` oder `groups.js` hilft ein Hard-Refresh
(`Strg + Shift + R`), da der Browser JavaScript-Dateien gerne
zwischenspeichert.

## Speicherung von Bewertungen und Gesehen-Status

Bewertungen werden ausschließlich lokal im Browser gespeichert
(`localStorage`) – **pro Gerät**, nicht account-gebunden. Ein Film gilt
automatisch als "gesehen", sobald er mit mindestens einer Popcorn-Tüte
bewertet wurde; einen separaten Gesehen-Schalter gibt es bewusst nicht.

Ist eine Gruppe aktiv, werden die eigenen Bewertungen zusätzlich mit der
Gruppe geteilt – die lokale Speicherung bleibt dabei aber immer die
führende Quelle. Fällt die Verbindung aus, funktioniert die Bewertung
weiterhin ganz normal; nicht übertragene Änderungen werden nachgereicht,
sobald wieder eine Verbindung besteht. Details zum Datenmodell und den
Firestore-Zugriffsregeln stehen in [`DATENMODELL.md`](DATENMODELL.md).

## Technologie

Reines HTML/CSS/JavaScript ohne Build-Prozess, gehostet über GitHub Pages.
Die Gruppenfunktion nutzt Firebase (Authentication + Firestore) ausschließlich
für Anmeldung und geteilte Daten – das Hosting bleibt bei GitHub Pages.