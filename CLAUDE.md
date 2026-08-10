My Movie Guide - Projektkontext für Claude Code
Diese Datei wird bei jeder neuen Sitzung automatisch gelesen. Sie hält fest, was sich über eine lange gemeinsame Entwicklungsgeschichte als feste Arbeitsweise herausgebildet hat - damit das nicht bei jeder Sitzung neu erklärt werden muss.
Was das Projekt ist
Private, nicht-kommerzielle Familien-App zum Bewerten von Filmen in mehreren kuratierten Filmreihen (aktuell MCU und Star Wars, weitere folgen), mit optionalem Teilen der Bewertungen in Gruppen. Reines HTML/CSS/JavaScript ohne Build-Prozess, gehostet über GitHub Pages, Backend nur für Anmeldung und geteilte Daten (Firebase). Domain: mymovieguide.de.
Sprache

* Alle Code-Kommentare auf Deutsch.
* Alle sichtbaren Texte (UI, Fehlermeldungen, Konsolen-Ausgaben) auf Deutsch.
* Bei neueren Dateien (groups.js) sind auch Funktions- und Variablennamen auf Deutsch (`zeichneFenster`, `oeffneGruppenFenster`, `listeWechseln`). Bei neuem Code in diesem Stil weitermachen. Ältere Funktionsnamen in app.js sind teils noch Englisch (`renderNav`, `openOverlay`) - nicht ohne Grund umbenennen, nur neue Funktionen konsequent Deutsch benennen.
* Anleitungen zu Konsolen/Oberflächen (Firebase, GitHub, etc.) IMMER mit den deutschen Menü-Bezeichnungen, da alle Beteiligten die deutschsprachige Oberfläche nutzen.

Vor jeder Aufgabe

* Kurze Modell-Einschätzung geben (auch wenn nur eine Instanz von Claude Code läuft, als Aufwandseinschätzung sinnvoll): mechanische Änderungen/kleine Fixes = einfacher Aufwand; Architekturentscheidungen, Sicherheitsregeln, komplexe Bugs = hoher Aufwand, mehr Sorgfalt nötig.
* `<title>`-Tag in index.html vor jeder Auslieferung prüfen. Muss exakt "My Movie Guide" lauten. Ist in der Vergangenheit mehrfach versehentlich auf einen alten Stand zurückgefallen.

Testphilosophie (nicht verhandelbar)

* Syntax immer prüfen (`node --check` für JS, JSON-Validierung für Datendateien) bevor eine Datei als fertig gilt.
* Bei Logik-Änderungen: isoliert testen (Kernfunktionen extrahieren, mit echten und mit Fehlerfällen durchspielen), nicht nur "sieht richtig aus".
* Bei Änderungen an Firestore-Regeln: IMMER Negativtests einbauen, die beweisen, dass verbotene Zugriffe auch wirklich abgelehnt werden - nicht nur, dass erlaubte Zugriffe funktionieren. Vorbild: die bestehenden Testdateien mit über 50 Einzeltests (u. a. für #16/#17).
* Bei Änderungen an moviedata-artigen Dateien mit vielen Einträgen (aktuell 47 MCU- + 9 Star-Wars-Filme): nach der Änderung Feld-für- Feld gegen die vorherige Fassung vergleichen, um sicherzustellen, dass ausschließlich die beabsichtigten Felder sich geändert haben.
* Windows-Zeilenenden (CRLF) in JSON-Dateien beim Bearbeiten erhalten, damit Diffs nur die tatsächlich geänderten Zeilen zeigen.

Architektur-Fakten, die man kennen sollte

* Lokale Speicherung ist die führende Quelle. Bewertungen liegen immer zuerst in localStorage. Eine Gruppe dient AUSSCHLIESSLICH dem Teilen, ist niemals die primäre Datenquelle. Diese Regel nicht aufweichen, auch nicht für neue Features.
* Titel und Laufzeit werden NICHT gespeichert, sondern live von TMDB gezogen (mit 7-Tage-Zwischenspeicherung, parallele statt sequenzielle Abfrage). moviedata-Dateien enthalten dafür bewusst kein "title"/"runtime"-Feld mehr.
* Mehrere Filmlisten: lists/manifest.json ist der Katalog, jede Filmreihe eine eigene Datei (lists/mcu.json, lists/star-wars.json, ...). Poster liegen in Unterordnern (posters/mcu/, posters/star-wars/). Film-IDs (Titel+Jahr) sind bewusst listenübergreifend eindeutig - Bewertungen/Gruppen funktionieren dadurch ohne Änderung über alle Listen hinweg.
* Das "Fenster"-Muster: Login, Mein Profil, Gruppen, Datenschutz, Infos und Listen-Auswahl teilen sich EIN gemeinsames Overlay (`#gruppen-fenster` in index.html, Logik in groups.js über eine `ansicht`-Zustandsvariable). Neue ähnliche Bereiche in dieses Muster einfügen statt ein neues Overlay zu bauen.
* Navigation: `Home │ Listen Login/Profil Gruppen │ Sektionen der aktiven Liste`. Neue Nav-Einträge folgen demselben Muster (data-Attribut, addEventListener, Fortschritts-Füllung falls zutreffend).
* Firebase-Projekt: `mcuguide` (Name historisch, nicht mehr geändert). Firestore-Region Frankfurt. Auth: Google + E-Mail-Link, anonym für Gruppenbeitritt ohne Konto.
* TMDB-Nutzung: API-Schlüssel liegt bewusst im öffentlichen Code (wie der Firebase-Schlüssel), da clientseitige Abfragen laut TMDB erlaubt sind. Attribution (Logo + vorgeschriebener Satz) ist Pflicht, siehe "Infos"-Bereich.
* Kein Build-Prozess: app.js/ui.js sind klassische Scripts (globaler Scope, keine Module), groups.js ist ein ES-Modul (wegen Firebase-SDK- Import). Cross-File-Kommunikation läuft über `window.*`-Exporte.

Arbeitsweise mit dem Nutzer

* Der Nutzer testet grundsätzlich lokal (`python -m http.server`), bevor irgendetwas nach GitHub hochgeladen wird.
* Größere Features werden vorher als GitHub Issue formuliert (mit Akzeptanzkriterien, technischen Anforderungen, offenen Fragen), bevor Code entsteht - nicht direkt drauflosprogrammieren.
* Commit-Nachrichten sind ausführlich und erklären das WARUM hinter Entscheidungen, nicht nur das WAS (Beispiel-Stil: "bewusst NICHT X, weil Y"). Diesen Stil beibehalten.
* Feature-Branches pro Issue oder pro sinnvoll zusammengehörigem Paket, nicht alles in einem Mammut-Branch.
* Bei mehrdeutigen Anforderungen: sinnvolle Annahme treffen, klar benennen, umsetzen - nicht bei jeder Kleinigkeit nachfragen. Bei echten Architekturentscheidungen (z. B. Datenmodell-Änderungen) hingegen lieber einmal zu viel nachfragen als falsch raten.
* Rechtliche/urheberrechtliche Sorgfalt ist dem Nutzer wichtig (siehe z. B. den Wechsel der Posterquelle zu TMDB wegen fehlender Nutzungserlaubnis bei der vorherigen Quelle) - bei ähnlichen Fragen dieselbe Sorgfalt walten lassen, im Zweifel ansprechen statt stillschweigend "wird schon passen".

Bekannte Stolperfallen

* Poster-Dateinamen von TMDB entsprechen oft NICHT der erwarteten Konvention (z. B. deutsche TMDB-Titel statt Episode-Bezeichnungen) - nach dem Herunterladen immer die tatsächlichen Dateinamen mit dem Nutzer abgleichen, nicht raten.
* GitHub-Weboberfläche liefert über web_fetch gelegentlich veraltete, zwischengespeicherte Inhalte - bei Zweifeln lieber auf die direkte Aussage des Nutzers verlassen als auf einen Fetch-Abruf.
