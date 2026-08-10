# MCU Fan Guide

Ein privater Fan-Guide für die Filme des Marvel Cinematic Universe (MCU) und
wichtige Zusatzfilme – kuratiert in einer eigenen empfohlenen Reihenfolge für
gemeinsame Familien-Filmabende.

**Live:** https://mymovieguide.de/

## Funktionen

- Alle Filme mit Poster, Laufzeit, Kurzbeschreibung sowie Links zu IMDb und TMDb
- Bewertung pro Film über Popcorn-Tüten (0–5)
- Fortschrittsanzeige direkt in der Navigation: jeder Menüpunkt füllt sich
  grün, je mehr Filme der jeweiligen Sektion bewertet ("gesehen") wurden
- Responsive Gestaltung mit eigenem Poster-Layout für Desktop und Mobile
- **Gruppen:** Bewertungen lassen sich mit der Familie teilen – ohne dass
  Mitglieder sich anmelden müssen (Details siehe [`DATENMODELL.md`](DATENMODELL.md))

## Dateistruktur

| Datei / Ordner | Zweck |
|---|---|
| `index.html` | Seitenstruktur und komplettes CSS |
| `app.js` | Lädt und validiert `moviedata.json`, baut Navigation und Filmkarten auf, Bewertungen, Fortschrittsanzeige |
| `ui.js` | Poster-Großansicht, mobiles Menü, Wischgeste |
| `groups.js` | Gruppenfunktion: Anmeldung, Beitritt, Abgleich, Verwaltung (Firebase) |
| `moviedata.json` | Alle Filmdaten (Titel, Beschreibung, Laufzeit, Links, Poster-Pfad) |
| `posters/` | Lokale Poster-Bilder, Dateiname = `id` aus `moviedata.json` |
| `manifest.json` | App-Icon und Metadaten für "Zum Homescreen hinzufügen" |
| `m.png`, `fav32.png` | App-Icon bzw. Favicon |
| `imdb.png`, `tmdb.png` | Icons für die Verlinkung zu IMDb/TMDb |
| `DATENMODELL.md` | Aufbau der Gruppenfunktion in Firestore, Zugriffsregeln |

## Einen Film hinzufügen

1. `moviedata.json` öffnen und die passende Sektion suchen (z. B. `Erste_Helden`).
2. Im `movies`-Array der Sektion ein neues Objekt ergänzen:

   ```json
   {
       "id": "iron-man-2008",
       "title": "Iron Man (2008)",
       "poster": "posters/iron-man-2008.jpg",
       "desc": "Kurze Beschreibung des Films.",
       "runtime": "126 Min.",
       "imdb": "https://www.imdb.com/title/...",
       "tmdb": "https://www.themoviedb.org/movie/..."
   }
   ```

   Die `id` muss innerhalb der Datei eindeutig sein (wird u. a. für
   Bewertungen und den Poster-Dateinamen verwendet).

3. Das passende Poster-Bild unter `posters/<id>.jpg` ablegen – der
   Dateiname muss exakt der `id` entsprechen.
4. Änderungen lokal testen (siehe unten), dann `moviedata.json` und das
   neue Poster ins Repository hochladen.

Für die Laufzeit eines noch nicht veröffentlichten Films `"runtime": "---"`
eintragen.

## Lokal testen

`index.html` lädt `moviedata.json` per `fetch()` nach – das funktioniert aus
Sicherheitsgründen der Browser **nicht**, wenn man die Datei einfach per
Doppelklick öffnet (`file://`-Adresse). Stattdessen einen kleinen lokalen
Webserver starten:

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