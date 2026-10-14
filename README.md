# Git Dashboard

Eine Desktop-App für lokale Git-Repositories, gemeinsame Aktivitätsübersichten und konfigurierbare Statistikmodule. Für Windows, macOS und Linux.

## Funktionen

- **Workspace-Übersicht:** geöffnete Repositories, aktueller Branch, lokale Änderungen, neueste Commits und gemeinsame Statistiken.
- **Repository-Baum:** nach übergeordnetem Ordner gruppiert, mit aufklappbaren lokalen und Remote-Branches. Ein Klick öffnet einen Tab; ein Branch-Klick filtert die Historie, ohne einen Checkout auszuführen.
- **Commit-Historie:** jeweils 100 Commits nachladen, nach Nachricht/Hash/Autor suchen und nach Autor filtern. Suche und Autorenfilter gelten für die bereits geladenen Commits.
- **Commit-Details:** vollständige Nachricht, Dateien, hinzugefügte/entfernte Zeilen, farbiger Diff und kopierbarer Hash.
- **Lokaler Status:** neue, bearbeitete, gestagte und konfliktbehaftete Dateien sowie Ahead/Behind gegenüber dem vorhandenen lokalen Upstream-Stand.
- **Git-Aktionen:** Fetch, Pull (Fast-forward/Rebase/Merge), Push und Force-with-lease; Dateien einzeln oder gemeinsam stagen/unstagen, committen und Amend. Branches wechseln/anlegen/umbenennen/löschen, Merge/Rebase/Cherry-pick/Revert, Stash, Tags, Reset, Remotes und lokale Git-Identität. Repositories klonen oder neu anlegen.
- **Module:** hinzufügen, konfigurieren, umsortieren und entfernen; eigener Titel, Repository-Auswahl und Zeitraum (7/30/90/365 Tage oder gesamte Historie). Separate Zusammenstellungen für Startseite und jedes Repository.
- **Dunkle/helle/System-Darstellung**, Tastaturkürzel und automatische Aktualisierung alle 60 Sekunden sowie bei Rückkehr zur App.

### Verfügbare Module

| Modul                    | Auswertung                                                   |
| ------------------------ | ------------------------------------------------------------ |
| Beiträge nach Autor      | Hinzugefügte und entfernte Zeilen, Anzahl Commits pro Person |
| Repository-Aktivität     | Ranking nach Commit-Anzahl                                   |
| Aktivität im Zeitverlauf | Commits pro Tag bzw. zusammengefasstem Zeitabschnitt         |
| Aktivitätskalender       | Tagesaktivität über 13 Wochen                                |
| Datei-Hotspots           | Häufig geänderte Dateien und Zeilenänderungen                |
| Commits nach Wochentag   | Aktivität von Montag bis Sonntag                             |
| Arbeitsverzeichnisse     | Saubere oder lokal geänderte Repositories                    |

Öffne Repositories über **Repository öffnen**: Ordner auswählen oder einen Pfad pro Zeile eingeben. Auch Unterordner werden auf die Repository-Wurzel aufgelöst. Geöffnete Repositories und Module werden beim nächsten Start wiederhergestellt. Das Entfernen aus dem Workspace löscht keine Dateien.

Per Rechtsklick auf einen übergeordneten Ordner im Repository-Baum → **Auf weitere Repositories prüfen** werden seine direkten Unterordner nach weiteren Git-Repositories durchsucht. Der Auswahldialog zeigt alle Funde mit Checkboxen und **Alle auswählen**; bereits geöffnete Repositories sind markiert und werden nicht erneut hinzugefügt. Unterordner werden genau eine Ebene tief geprüft, einschließlich Git-Worktrees mit einer `.git`-Datei. Das Kontextmenü ist auch mit **Shift+F10** erreichbar.

### Wie die Zahlen entstehen

Statistiken verwenden alle erreichbaren Branches und Tags sowie HEAD. Ein Commit wird innerhalb eines Repositories einmal gezählt. Sind zwei geöffnete Repositories Klone derselben Historie, zählt diese Historie in beiden Repositories. Personen werden nach E-Mail-Adresse gruppiert; Git berücksichtigt `.mailmap`. Der Zeitpunkt ist das Committer-Datum, Zeiträume beginnen am lokalen Tagesanfang. Merge-Commits werden aus den Statistikmodulen ausgeschlossen. Die Historienansicht enthält sie weiterhin.

Zeilenstatistiken stammen aus `git log --numstat`: Additionen und Löschungen werden getrennt gezählt. Sie messen Änderungen, nicht dauerhaft verbleibende Zeilen oder Produktivität. Binärdateien zählen als Dateiveränderung, haben aber keine Zeilenzahl. Datei-Hotspots verwenden den Dateinamen im jeweiligen Commit; Namen vor/nach einer Umbenennung werden nicht über die komplette Historie zusammengeführt.

Für Statistiken werden maximal die neuesten **20.000 erreichbaren Commits pro Repository** gelesen; bei Überschreitung erscheint ein Hinweis. Die Commit-Historie lässt sich unabhängig davon weiter nachladen. Zeitverlaufsdiagramme zeigen maximal 366 Tage, der Kalender maximal 13 Wochen; ihre jeweiligen Zeitraumfilter gelten zusätzlich. Diffs sind auf 500 KB begrenzt.

Die automatische Aktualisierung liest nur lokale Git-Daten. Fetch, Pull, Push und andere Schreibaktionen werden ausschließlich über explizite Bedienung ausgelöst. Remote-Branches und Ahead/Behind spiegeln bis zum nächsten Fetch/Pull den zuletzt lokal bekannten Stand wider. Bare-Repositories werden nicht als Workspace-Repositories unterstützt.

### Git bedienen

Öffne ein Repository und klicke auf den lokalen Status, um den **Arbeitsbereich** mit getrennten Listen für gestagte und nicht gestagte Dateien zu öffnen. Nach Auswahl und Staging eine Commit-Nachricht eingeben und **Commit erstellen** wählen. Der Historien-Branchfilter und die Branches im Seitenbaum ändern nur die Anzeige; ein tatsächlicher Branchwechsel erfolgt über **Weitere Git-Aktionen**. Remote-Branches lassen sich dort als neue lokale Tracking-Branches auschecken.

Die Aktionsleiste bietet **Fetch**, **Pull**, **Push** und **Weitere Git-Aktionen**. Git-Ausgabe und Fehler werden live im Ausgabedialog angezeigt; laufende Befehle lassen sich abbrechen. Operationen werden pro gemeinsamem Git-Verzeichnis serialisiert, auch bei verknüpften Worktrees. Nach jeder ausgeführten Aktion wird das betroffene Repository aktualisiert. Bei Merge-/Rebase-/Cherry-pick-/Revert-Konflikten zeigt der Arbeitsbereich **Fortsetzen**, **Operation abbrechen** sowie die betroffenen Dateien. „Unsere/Ihre Version“ folgt der Git-Semantik; beim Rebase können die Seiten gegenüber der Alltagssicht vertauscht sein.

Verwerfen, Amend, Reset, Löschaktionen, Rebase und Force-with-lease benötigen eine Bestätigung mit Repository-Pfad und Befehl. Neue, unversionierte Dateien werden durch **Auswahl verwerfen** nicht gelöscht. Ein fehlgeschlagener oder abgebrochener Git-Befehl kann bereits Änderungen hinterlassen; es gibt keinen automatischen Rollback. Ein unterbrochener Clone wird ebenfalls nicht automatisch gelöscht. Ausgabe ist auf 512 KB begrenzt; einzelne Befehle haben ein Zeitlimit von drei Minuten.

Für weitere nichtinteraktive Git-Funktionen gibt es **Eigener Git-Befehl** (mit Bestätigung, ohne Shell-Operatoren oder globale Optionen vor dem Unterbefehl). Konfigurierte Git-Aliase und Hooks können ausgeführt werden. Die Eingabe ist kein Sicherheits-Sandbox und kann über Git-Argumente auch andere Pfade betreffen. Für interaktive Funktionen wie `git add -p`, interaktiven Rebase oder grafische Merge-Tools öffnet **Terminal öffnen** ein Terminal im Repository-Ordner.

Git verwendet vorhandene SSH-Schlüssel und Credential-Helper. Die App speichert keine Zugangsdaten und führt keine Terminal-Passwortabfragen durch; erstmalige Anmeldung, Passphrase-Abfragen und signierte Commits gegebenenfalls im Terminal erledigen. Die eigene Git-Konfiguration und Hooks bleiben wirksam. Details zu [Pull-Modi](https://git-scm.com/docs/git-pull), [Force-with-lease](https://git-scm.com/docs/git-push) und [Stash](https://git-scm.com/docs/git-stash) stehen in der Git-Dokumentation.

### Schrittweises Laden

Beim Öffnen vieler Repositories erscheinen zuerst ihre Übersichtsdaten (Branches, lokaler Status und die letzten zwölf Commits). Es werden maximal zwei Repositories gleichzeitig geprüft; fertige Ergebnisse werden sofort angezeigt. Die Statistiken folgen anschließend in Paketen von **250 Commits**, abwechselnd für die wartenden Repositories. Die aktive Ansicht erhält bevorzugt das nächste Paket. Ein Fortschrittsbalken zeigt den Ladezustand; Statistikwerte sind währenddessen als Zwischenstand gekennzeichnet.

Die Historie wird für einen Ladevorgang auf die zu Beginn erfassten Git-Revisionen fixiert, damit zwischenzeitliche neue Commits keine Seiten verschieben. Bei unveränderten Git-Referenzen und unveränderter `.mailmap` werden bereits geladene Statistikdaten innerhalb der geöffneten App weiterverwendet. Lokaler Status und letzte Commits werden trotzdem aktualisiert. Neue Repositories werden gezielt ergänzt; laufende, ersetzte Anfragen werden abgebrochen und angefangene Historien nach Möglichkeit fortgesetzt. Automatische Aktualisierungen überlappen sich nicht.

Bereits nachgeladene Seiten der geöffneten Commit-Historie bleiben bei unveränderter Historie erhalten. Im Hintergrundprozess werden nur kleine Metadaten zwischengespeichert; komplette Historien werden nicht nochmals als Cache gehalten. Beim Neustart wird erneut schrittweise aus Git geladen.
Bereits berechnete Modulauswertungen werden bei reinen Status- oder Branch-Metadatenupdates ebenfalls weiterverwendet. Neue Commit-Pakete, geänderte Repository-Auswahlen und Zeitfilter invalidieren diese Auswertungen; Arbeitsverzeichnis-Module zeigen weiterhin den aktuellen Status.

## Entwicklung

Voraussetzungen: Node.js 24+, npm und Git im PATH.

```sh
npm install
npm run dev
```

`npm run build` erstellt die App, `npm start` öffnet den Build. Änderungen am Renderer werden live aktualisiert; nach Änderungen im Electron-Prozess `npm run dev` neu starten.

`npm run dev:web` öffnet nur den Renderer im Browser. Für Zugriff auf lokale Repositories ist die Electron-App erforderlich.

### Tests

```sh
npm test
npm run test:e2e
```

Die Fachtests erzeugen temporäre Git-Repositories und prüfen unter anderem leere Historien, Umbenennungen, Binärdateien, Merge-Zählung, Diffs und Persistenz sowie echte Git-Aktionen gegen lokale Bare-Remotes, Konflikte und Force-with-lease. Die Desktop-Tests starten echtes Electron, öffnen mehrere Repositories, konfigurieren Module, prüfen Filter, Staging/Commit/Push, Branchwechsel, Bestätigungen, Clone/Init und einen Neustart. Die Git-Aktionstests verändern ausschließlich temporäre Test-Repositories. Screenshots liegen anschließend in `test-results/ui/`.

Unter Linux ohne Desktop: `xvfb-run --auto-servernum npm run test:e2e`.

## Pakete

```sh
npm run dist
```

Erstellt Pakete für das jeweilige Betriebssystem in `release/`: Windows Installer/Portable, macOS DMG/ZIP, Linux AppImage/DEB. Betriebssystemspezifische Pakete werden auf dem jeweiligen System gebaut. `npm run pack` erstellt einen entpackten App-Ordner.

Der GitHub-Workflow **Desktop builds** testet und paketiert auf Windows, macOS und Linux. Downloads liegen unter den Artefakten des jeweiligen Workflow-Laufs. Die erzeugten Pakete sind unsigniert; Signierung und macOS-Notarisierung benötigen eigene Zertifikate und sind nicht konfiguriert. Auch für installierte Pakete muss Git verfügbar sein.

### Workspace-Datei

`workspace.json` liegt im Electron-Benutzerdatenordner der App **Git Dashboard**:

- Windows: `%APPDATA%/Git Dashboard/`
- macOS: `~/Library/Application Support/Git Dashboard/`
- Linux: `$XDG_CONFIG_HOME/Git Dashboard/` (standardmäßig `~/.config/Git Dashboard/`)

Schreibvorgänge werden serialisiert und über eine temporäre Datei atomar ersetzt. Eine fehlerhafte Workspace-Datei wird nicht überschrieben: Die App meldet den Pfad und beendet sich. Zum Wiederherstellen die Datei bei geschlossener App sichern und korrigieren oder umbenennen.

Für isolierte Entwicklung und Tests kann `GIT_DASHBOARD_USER_DATA` auf einen eigenen Ordner zeigen. Dieser Override ist in installierten Paketen deaktiviert.

### Architektur

- `electron/`: Git-Prozesse, Persistenz und geprüfte IPC-Aufrufe.
- `shared/`: gemeinsame Typen und reine Statistikfunktionen.
- `src/`: React-Oberfläche, wiederverwendbare Komponenten und Theme-Tokens.
- `tests/`, `e2e/`: Fach- und Desktop-Integrationstests.

Git wird als Prozess mit Argumentliste ausgeführt, ohne Shell-Interpolation. Der Renderer ist isoliert und hat ausschließlich eine typisierte API. IPC-Prüfungen erlauben nur die Hauptansicht der App, Branches und Commit-Hashes werden validiert, und externe Navigation ist gesperrt. Diese Grenze folgt den [Electron-Sicherheitsrichtlinien](https://www.electronjs.org/docs/latest/tutorial/security/).
