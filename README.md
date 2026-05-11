# 🏫 Stundenplaner

**Dynamischer Stundenplan-Generator für Grundschulen**

Eine Desktop-Anwendung zur automatischen Erstellung von Wochenstundenplänen für Grundschulen. Fächer, Lehrkräfte und Klassen einmalig konfigurieren – die App erstellt einen optimierten Stundenplan und exportiert ihn nach Excel.

---

## Funktionen

- **Fachverwaltung** – Fächer mit klassenspezifischen Min./Max.-Stunden, erlaubten Wochentagen und Stundenbeschränkungen konfigurieren
- **Lehrerverwaltung** – Lehrerprofile mit Kernfächern, erlaubten/verbotenen Fächern, Wochenstunden, Freitage-Präferenzen und Klassenlehrerzuweisungen pflegen
- **Klassenverwaltung** – Klassen mit Klassenstufe, Wochenstunden, Max. Tagesstunden und Fachzuweisungen anlegen
- **Automatische Stundenplanerstellung** – Constraint-basierter Algorithmus, der alle konfigurierten Regeln berücksichtigt:
  - Lehrerverfügbarkeit und Fachkompetenz
  - Freitage-Einschränkungen pro Lehrer
  - Maximale Stunden pro Tag und Klasse
  - Fach-Wochentag- und Stunden-Beschränkungen
  - Minimierung von Freistunden im Lehrerplan
  - Optionale Doppelbesetzung bei verfügbarer Lehrerkapazität
- **Excel-Export** – Klassenweise Stundenplandateien sowie Lehrerübersicht und individuelle Lehrerpläne
- **Datenbankimport/-export** – Vollständige SQLite-Datenbanksicherung und -wiederherstellung

---

## Datenschutz

Alle Daten werden **lokal auf Ihrem Gerät** in einer SQLite-Datenbank gespeichert. Die App hat keine Cloud- oder Netzwerkabhängigkeiten und funktioniert vollständig offline.

---

## Technologie

| Ebene | Technologie |
|---|---|
| Desktop-Shell | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | React 19 + TypeScript |
| Bundler | Vite |
| Styling | Tailwind CSS v4 |
| UI-Komponenten | Radix UI Primitives |
| Zustand | Zustand |
| Routing | React Router v7 |
| Datenbank | SQLite via `tauri-plugin-sql` |
| Excel-Export | SheetJS (xlsx) |
| Tests | Vitest + Testing Library |
| Linting | ESLint v9 Flat Config |

---

## Erste Schritte

### Voraussetzungen

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://rustup.rs/) (Stable Toolchain)
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: Microsoft C++ Build Tools + WebView2

### Installation

```bash
# JavaScript-Abhängigkeiten installieren
npm install

# Im Entwicklungsmodus starten
npm run tauri dev

# Produktions-Build erstellen
npm run tauri build
```

### Entwicklungsbefehle

| Befehl | Beschreibung |
|---|---|
| `npm run dev` | Nur Vite-Dev-Server starten |
| `npm run tauri dev` | Vollständige Tauri-Entwicklungsumgebung starten |
| `npm run build` | TypeScript-Prüfung + Vite-Build |
| `npm run tauri build` | Produktions-Desktop-App erstellen |
| `npm run test` | Unit-Tests ausführen (Watch-Modus) |
| `npm run test:run` | Unit-Tests einmalig ausführen |
| `npm run lint` | ESLint ausführen |
| `npm run format` | Mit Prettier formatieren |

---

## Arbeitsablauf

1. **Fächer konfigurieren** – Alle Schulfächer mit Klassenstufenbeschränkungen anlegen
2. **Lehrkräfte konfigurieren** – Alle Lehrer mit Fachkompetenzen und Verfügbarkeiten anlegen
3. **Klassen konfigurieren** – Klassen anlegen und Fächer mit gewünschten Wochenstunden zuweisen
4. **Stundenplan erstellen** – Auf „Stundenplan generieren" auf der Stundenplanseite klicken
5. **Prüfen & Exportieren** – Den erstellten Stundenplan prüfen und nach Excel exportieren

---

## Projektstruktur

```
stundenplaner/
├── src/                          # React-Frontend
│   ├── components/
│   │   ├── ui/                   # Wiederverwendbare UI-Primitives
│   │   ├── layout/               # App-Shell (Sidebar, Layout)
│   │   ├── subjects/             # Fachformular-Komponenten
│   │   ├── teachers/             # Lehrerformular-Komponenten
│   │   └── classes/              # Klassenformular-Komponenten
│   ├── pages/                    # Routen-Seitenkomponenten
│   ├── services/                 # Datenbankzugriffsschicht
│   ├── stores/                   # Zustand-Stores
│   ├── types/                    # TypeScript-Typen & Konstanten
│   └── utils/                    # Planungsalgorithmus & Excel-Export
├── src-tauri/                    # Rust/Tauri-Backend
│   ├── src/
│   │   ├── lib.rs                # Tauri-App-Setup & Plugin-Registrierung
│   │   └── db.rs                 # DB-Migrationen & Import/Export-Befehle
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

---

## Lizenz

MIT – siehe [LICENSE](LICENSE)
