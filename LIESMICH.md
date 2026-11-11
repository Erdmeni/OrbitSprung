# Orbitsprung – Android-App mit automatischen Updates

## Einmalig einrichten

1. **GitHub-Repository anlegen** (github.com → New repository, Name z. B. `orbitsprung`, **Public**).
2. **Projekt hochladen**: Inhalt dieses Ordners ins Repository (Branch `main`), z. B. mit GitHub Desktop
   oder im Browser über „Add file → Upload files" (auch den Ordner `.github` mit hochladen!).
3. **Secrets anlegen**: Repository → Settings → Secrets and variables → Actions → New repository secret.
   Die vier Werte stehen in `GitHub-Secrets.txt`.
4. Unter **Actions** den Workflow „Orbitsprung Release" starten (Run workflow).
   Nach ca. 5 Minuten steht unter **Releases** die Datei `Orbitsprung.apk`.

## Handy einrichten

1. Die alte Testversion von Orbitsprung **einmal deinstallieren** (sie ist anders signiert).
2. **Obtainium** installieren: https://github.com/ImranR98/Obtainium/releases (die `app-…-arm64-v8a-release.apk`).
3. In Obtainium „Hinzufügen" → URL `https://github.com/<dein-name>/orbitsprung` → Hinzufügen → Installieren.
4. Ab jetzt meldet Obtainium jedes neue Release, ein Tipp auf „Aktualisieren" genügt.

## Updates

Jeder Push auf `main` baut automatisch die APK. Die Versionsnummer steht im Spiel (`const APP_VERSION='1.5.1';` und Menütext `#ver`, beide gleich). Daraus entstehen Release-Tag `v1.5.1` und der Versionsname der App. Gibt es das Release schon, wird nur gebaut, aber kein neues Release angelegt. Für ein neues Release also die Version erhöhen.

Beim Start fragt das Spiel bei GitHub nach dem neuesten Release. Ist es neuer, erscheint ein Hinweis mit „Ignorieren“ und dem Haken „Diese Nachricht nicht mehr anzeigen“ (gilt nur für genau diese Version). Ohne Netz läuft das Spiel normal weiter.
Das Spiel selbst liegt in `app/src/main/assets/index.html`.

## Wichtig

`orbitsprung-release.jks` und `GitHub-Secrets.txt` sicher aufbewahren und **nicht** ins Repository hochladen.
Geht der Schlüssel verloren, kann keine Update-Version mehr über die installierte App gespielt werden.

## Prüfungen vor jedem Build

Die GitHub Action baut die APK nur, wenn vorher alle Prüfungen grün sind (Job „Prüfen und testen“):

- `tests/release-check.mjs`: bricht ab, wenn `TEST_BUILD=true`, „alles freigeschaltet“ oder ein Test-Titel in der Spieldatei steht oder `APP_VERSION` nicht zum Menütext passt.
- `tests/module.mjs`: Aufteilen in Module und Zusammensetzen ergibt dieselbe Datei.
- `tests/smoke.mjs`: öffnet das Spiel im Browser, startet jeden Modus, tippt, beendet die Runde, klickt Shop, Erfolge und Einstellungen durch und schlägt bei JS-Fehlern fehl.
- `tests/update.mjs`: Update-Hinweis beim Start mit simulierter GitHub-Antwort: neuere, gleiche und ältere Version, Ignorieren, „nicht mehr anzeigen“ nur für genau diese Version, ohne Netz.
- `tests/sync.mjs`: zwei simulierte Geräte mit einem Konto: Spielstand-Migration, Offline-Käufe auf beiden Geräten, alte App-Version, Erfolge nur einmal belohnt.

Lokal: `npm install` und dann `npm test` (optional mit Pfad: `node tests/smoke.mjs datei.html`).

## Hilfsskripte

- `node tools/release.mjs <test-artefakt.html> [version]`: macht aus der Testversion die App-Datei (`TEST_BUILD=false`, Titel und Menütext ohne „Tests“).
- `node tools/split.mjs` teilt `index.html` zum Bearbeiten in Module unter `src/` (Stil, Oberfläche, je Abschnitt eine JS-Datei), `node tools/build.mjs` setzt sie wieder zu `index.html` zusammen. Die Quelle bleibt `index.html`, `src/` wird nicht eingecheckt.
