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

Jeder Push auf `main` baut automatisch eine neue Version (Versionsnummer steigt von selbst).
Das Spiel selbst liegt in `app/src/main/assets/index.html`.

## Wichtig

`orbitsprung-release.jks` und `GitHub-Secrets.txt` sicher aufbewahren und **nicht** ins Repository hochladen.
Geht der Schlüssel verloren, kann keine Update-Version mehr über die installierte App gespielt werden.
