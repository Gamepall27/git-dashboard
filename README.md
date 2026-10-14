# Git Dashboard

Eine Desktop-App für lokale Git-Repositories, gemeinsame Aktivitätsübersichten und konfigurierbare Statistikmodule. Für Windows, macOS und Linux.

## Entwicklung

Voraussetzungen: Node.js 24+, npm und Git im PATH.

```sh
npm install
npm run dev
```

`npm run build` erstellt die App, `npm start` öffnet den Build. Änderungen am Renderer werden live aktualisiert; nach Änderungen im Electron-Prozess `npm run dev` neu starten.

## Pakete

```sh
npm run dist
```

Erstellt Pakete für das jeweilige Betriebssystem in `release/`: Windows Installer/Portable, macOS DMG/ZIP, Linux AppImage/DEB. Betriebssystemspezifische Pakete werden auf dem jeweiligen System gebaut.
