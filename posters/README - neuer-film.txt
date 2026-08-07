So funktioniert's künftig, wenn ein neuer Film erscheint:

python neuer-film.py [Ordner] [TMDB-Link]

Beispiele:
python neuer-film.py mcu https://www.themoviedb.org/movie/...
python neuer-film.py star-wars https://www.themoviedb.org/movie/181812-...
python neuer-film.py indiana-jones https://www.themoviedb.org/movie/...

Das Skript lädt automatisch den Poster nach posters/<Ordner>/ herunter
und gibt dir einen fertigen JSON-Baustein aus - mit id, Poster-Pfad
und TMDB-Link. Titel und Laufzeit stehen NICHT im Baustein, die zieht
sich die App bei jedem Aufruf live von TMDB (siehst du im Skript nur
noch zur Kontrolle in der Konsolen-Ausgabe, "wird NICHT gespeichert").

Nur bei "desc" steht ein Platzhalter, den du durch deine (eigene oder
KI-gekürzte) Zusammenfassung ersetzt.

Danach kopierst du den Block an die richtige Stelle in
lists/<Ordner>.json - z. B. lists/mcu.json bei "mcu", lists/star-wars.json
bei "star-wars". Die Zuordnung zur passenden Sektion innerhalb der
Datei bleibt bewusst bei dir, das ist ja der kuratorische Teil.

Praktisch: Dein TMDB-Token ist im Skript bereits eingetragen. Falls du
ihn zwischenzeitlich erneuert hast, musst du die Zeile
API_TOKEN = "..." einmal aktualisieren.

Läuft im selben Ordner wie euer Projekt (dort, wo auch posters/ liegt),
damit die Poster gleich am richtigen Platz landen.