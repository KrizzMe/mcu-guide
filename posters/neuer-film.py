#!/usr/bin/env python3
"""
Hilfswerkzeug für neue Filme im MCU Fan Guide.

Du gibst einen TMDB-Link an, das Skript holt sich automatisch:
- Titel (im Format "Titel (Jahr)", passend zum bisherigen Stil)
- Laufzeit
- Poster (direkter Download nach posters/<id>.jpg)

Und gibt dir am Ende einen fertigen JSON-Baustein aus, den du nur noch
in die richtige Sektion von moviedata.json einfügen musst - dort dann
noch "desc" selbst ergänzen (deine Zusammenfassung der Handlung).

Nutzung:
    python neuer-film.py mcu https://www.themoviedb.org/movie/557-spider-man
    python neuer-film.py star-wars https://www.themoviedb.org/movie/11-star-wars https://www.themoviedb.org/movie/1891-...

    Erstes Argument ist immer der Ordnername der Filmreihe (z. B. "mcu",
    "star-wars", "indiana-jones") - Poster landen dann direkt unter
    posters/<Filmreihe>/. Danach ein oder mehrere TMDB-Links.

    Ohne Angabe fragt das Skript beides interaktiv ab.

Voraussetzung: Python 3 (kein pip install nötig, nur Standardbibliothek).
Muss im Projektordner ausgeführt werden (dort, wo auch posters/ liegt).
"""

import json
import os
import re
import sys
import unicodedata
import urllib.request

# Dein TMDB-Zugangstoken - bereits eingetragen aus eurem letzten
# Poster-Download. Falls du ihn zwischenzeitlich erneuert hast, hier
# aktualisieren.
API_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmOTVmM2ZjM2E0NDAxNzk1ODZhNTkzNzE5ZTI0Mzc1YyIsIm5iZiI6MTc4NTk2Nzk2NS43ODQ5OTk4LCJzdWIiOiI2YTczYjU1ZDE5YTI1ZDJhNDZlMGY1MGEiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.uuLhvv96xh8JnvmMhbCsFZC3eOyx3Q_OAkmrNkEtcGc"

POSTER_GROESSE = "w500"
POSTER_BASISORDNER = "posters"

HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "accept": "application/json",
}


def tmdb_id_auslesen(link):
    treffer = re.search(r"themoviedb\.org/movie/(\d+)", link)
    if not treffer:
        raise ValueError(f"Konnte keine TMDB-ID aus '{link}' auslesen.")
    return treffer.group(1)


def tmdb_details_holen(tmdb_id):
    """Holt Titel, Erscheinungsjahr, Laufzeit und Poster-Pfad - erst auf
    Deutsch versucht, fehlende Felder (v. a. Titel/Poster) auf Englisch
    nachgefragt, falls TMDB dafür keine deutsche Fassung hinterlegt hat."""
    def abfragen(sprache):
        url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
        if sprache:
            url += f"?language={sprache}"
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))

    daten = abfragen("de-DE")
    daten_en = None

    if not daten.get("title") or not daten.get("poster_path"):
        daten_en = abfragen(None)
        if not daten.get("title"):
            daten["title"] = daten_en.get("title") or daten_en.get("original_title")
        if not daten.get("poster_path"):
            daten["poster_path"] = daten_en.get("poster_path")

    return daten


def id_slug_erzeugen(titel, jahr):
    """Erzeugt eine URL-/dateinamenfreundliche ID aus Titel + Jahr,
    z. B. 'Spider-Man' + 2002 -> 'spider-man-2002'."""
    text = unicodedata.normalize("NFKD", titel).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return f"{text}-{jahr}"


def poster_herunterladen(poster_pfad, ziel_datei):
    if not poster_pfad:
        return False
    bild_url = f"https://image.tmdb.org/t/p/{POSTER_GROESSE}{poster_pfad}"
    req = urllib.request.Request(bild_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as response:
        bild_daten = response.read()
    with open(ziel_datei, "wb") as f:
        f.write(bild_daten)
    return True


def film_verarbeiten(liste_ordner, link):
    print(f"\n--- {link} ---")
    tmdb_id = tmdb_id_auslesen(link)
    daten = tmdb_details_holen(tmdb_id)

    titel_roh = daten.get("title") or daten.get("original_title") or "Unbekannter Titel"
    erscheinungsdatum = daten.get("release_date") or ""
    jahr = erscheinungsdatum[:4] if erscheinungsdatum else "????"
    laufzeit_minuten = daten.get("runtime")
    laufzeit = f"{laufzeit_minuten} Min." if laufzeit_minuten else "---"

    movie_id = id_slug_erzeugen(titel_roh, jahr)
    titel_formatiert = f"{titel_roh} ({jahr})"

    ziel_ordner = os.path.join(POSTER_BASISORDNER, liste_ordner)
    os.makedirs(ziel_ordner, exist_ok=True)
    poster_datei = os.path.join(ziel_ordner, f"{movie_id}.jpg")
    poster_ok = poster_herunterladen(daten.get("poster_path"), poster_datei)

    # Kein "title" und kein "runtime" im Baustein: beide werden seit der
    # Umstellung auf Live-Abfrage nicht mehr in den Listen gespeichert,
    # sondern zur Laufzeit direkt von TMDB gezogen (siehe app.js). Hier
    # nur zur Kontrolle ausgegeben, nicht Teil des JSON-Bausteins.
    baustein = {
        "id": movie_id,
        "poster": f"posters/{liste_ordner}/{movie_id}.jpg",
        "desc": "<<< HIER DEINE ZUSAMMENFASSUNG DER HANDLUNG EINTRAGEN >>>",
        "tmdb": link
    }

    print(f"Titel:    {titel_formatiert}  (zur Kontrolle - wird NICHT gespeichert, kommt live von TMDB)")
    print(f"Laufzeit: {laufzeit}  (zur Kontrolle - wird NICHT gespeichert, kommt live von TMDB)")
    print(f"Poster:   {'heruntergeladen -> ' + poster_datei if poster_ok else 'NICHT gefunden bei TMDB'}")
    print("\nFertiger Baustein zum Einfügen in die Listen-Datei (z. B. lists/{}.json):\n".format(liste_ordner))
    print(json.dumps(baustein, ensure_ascii=False, indent=4))
    print()

    return baustein


def main():
    argumente = sys.argv[1:]

    if argumente:
        liste_ordner = argumente[0]
        links = argumente[1:]
        if not links:
            print("Fehler: Nach dem Filmreihen-Ordner fehlt mindestens ein TMDB-Link.")
            print("Beispiel: python neuer-film.py mcu https://www.themoviedb.org/movie/557-spider-man")
            sys.exit(1)
    else:
        liste_ordner = input("Ordnername der Filmreihe (z. B. mcu, star-wars): ").strip()
        if not liste_ordner:
            print("Kein Ordnername eingegeben, breche ab.")
            sys.exit(1)
        eingabe = input("TMDB-Link zum neuen Film: ").strip()
        if not eingabe:
            print("Kein Link eingegeben, breche ab.")
            sys.exit(1)
        links = [eingabe]

    bausteine = []
    for link in links:
        try:
            bausteine.append(film_verarbeiten(liste_ordner, link))
        except Exception as e:
            print(f"FEHLER bei {link}: {e}")

    if len(bausteine) > 1:
        print("\n=== Alle Bausteine zusammen ===\n")
        print(json.dumps(bausteine, ensure_ascii=False, indent=4))


if __name__ == "__main__":
    main()