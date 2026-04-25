# PDF → E-Buch Pipeline

[![Version](https://img.shields.io/badge/version-v2.26-ff6b6b)](https://github.com/erichrueger-ssilv/ocr-marker/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> Ein leistungsstarkes Web-Tool zur Umwandlung von PDF-Dokumenten in strukturierte E-Bücher mit KI-gestützter Bilderkennung, LaTeX-Mathematik und Export in Markdown sowie Word (.docx).

---

## 🚀 Features

- **📄 PDF zu Markdown**: Konvertierung mit dem Marker-OCR-Backend
- **🤖 KI-Bildanalyse**: Automatische Bildbeschreibung via OpenWebUI (LLaVA, GPT-4V etc.)
- **📊 Seitenvergleich**: Side-by-Side-Ansicht von Original-PDF und erkannten Bildern
- **🖼️ Bild-Editor**: Integrierter Editor zum Zuschneiden, Übermalen und Austauschen von Bildern
- **📘 Word-Export**: Direkter Export als .docx mit formatierter Mathematik
- **📦 ZIP-Archiv**: Download als komplettes ZIP mit Markdown + Bildern
- **🔧 Konfigurierbar**: Viele Optionen für OCR, Formatierung und KI-Prompts

---

## 🏗️ Architektur

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Benutzer      │────▶│   Frontend      │────▶│   Marker API    │
│   (Browser)     │◄────│   (HTML/JS)     │◄────│   (OCR/Parser)  │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   OpenWebUI     │
                        │   (KI-Modelle)  │
                        └─────────────────┘
```

---

## 📋 Voraussetzungen

- **Marker Server**: Ein laufender Marker-Dienst für PDF-OCR
  - Default: `./api/marker/upload`
- **OpenWebUI**: Eine laufende OpenWebUI-Instanz mit API-Zugang
  - Default: `https://openwebui.sbbz-ilvesheim.de/api`
- **API-Token**: Ein gültiger OpenWebUI API-Key

---

## ⚙️ Installation

### 1. Repository klonen

```bash
git clone https://github.com/erichrueger-ssilv/ocr-marker.git
cd ocr-marker
```

### 2. Statisch hosten

Die Anwendung ist rein clientseitig und benötigt nur einen Webserver:

```bash
# Mit Python
python -m http.server 8080

# Mit Node.js
npx serve .

# Mit Nginx
# Kopiere den Inhalt in ein Web-Verzeichnis
```

### 3. API-Endpoints konfigurieren

Im Frontend unter **🔌 API-Einstellungen**:

| Einstellung | Beschreibung | Standard |
|-------------|--------------|----------|
| OpenWebUI API Token | Dein API-Key | - |
| KI-Modell | Auswahl des LLMs | - |
| Marker Server URL | Upload-Endpoint | `./api/marker/upload` |
| OpenWebUI URL | API-Basis-URL | `https://openwebui.sbbz-ilvesheim.de/api` |

---

## 🎯 Verwendung

### Schnellstart

1. **PDF hochladen**: Datei per Drag & Drop oder Dateiauswahl hochladen
2. **Pipeline starten**: 🚀 Pipeline starten klicken
3. **Warten**: OCR und KI-Analyse laufen automatisch
4. **Ergebnisse prüfen**: Markdown-Preview, Vergleichsansicht
5. **Exportieren**: Als Word (.docx) oder Markdown herunterladen

### Tastenkombinationen

Klicke auf das **Logo** in der Kopfzeile, um alle Tastenkombinationen zu sehen.

| Tastenkombination | Aktion |
|-------------------|--------|
| `Alt + P` | Pipeline starten |
| `Alt + S` | Word-Datei herunterladen |
| `Alt + M` | Markdown herunterladen |
| `Alt + C` | Markdown kopieren |
| `Alt + E` | Einstellungen umschalten |
| `Alt + R` | Pipeline zurücksetzen |

---

## 🛠️ Einstellungen

### Basis-Einstellungen

- **Bilderkennungs-Prompt**: Anpassbarer Prompt für die KI-Bildbeschreibung
- **Force OCR**: OCR immer erzwingen (auch bei textbasierten PDFs)
- **Paginate Output**: Seitenumbrüche im Output erhalten
- **Output Format**: Markdown oder JSON
- **Page Range**: Seitenbereich eingrenzen (z.B. `1-10,15`)

### Export-Formatierung

Umfangreiche Optionen für die DOCX-Aufbereitung:

- Einheiten bereinigen, Griechisch zu LaTeX, Hoch/Tiefzahlen
- LaTeX-Rendering, Sonderzeichen, typografische Anführungszeichen
- Schriftgröße und Zeilenabstand konfigurierbar

### API-Einstellungen

Verbindung zu externen Diensten:

- OpenWebUI API Token
- KI-Modell-Auswahl (automatisch geladen)
- Marker Server URL
- OpenWebUI URL

### Experimentelle Einstellungen

- **Use LLM**: LLM für OCR verwenden
- **Strip Existing OCR**: Vorhandenen OCR-Text entfernen
- **Redo Inline Math**: Inline-Mathematik neu rendern
- **Disable Image Extraction**: Keine Bilder extrahieren

---

## 📁 Projektstruktur

```
.
├── index.html              # Hauptanwendung
├── app.js                  # Frontend-Logik (~2.800 Zeilen)
├── styles.css              # Styles & Themes
├── lib/                    # Lokale Bibliotheken
│   ├── pdf.min.js          # PDF.js
│   ├── pdf.worker.min.js   # PDF.js Worker
│   ├── fabric.min.js       # Canvas-Editor
│   ├── marked.min.js       # Markdown-Renderer
│   ├── jszip.min.js        # ZIP-Erstellung
│   ├── html-docx.js        # DOCX-Export
│   ├── FileSaver.min.js    # Datei-Download
│   └── crypto-js.min.js    # Verschlüsselung
├── logo-ssilv.png          # Logo
├── icon-512.png            # App-Icon
├── manifest.json           # PWA-Manifest
└── sw.js                   # Service Worker
```

---

## 🔧 Technologie-Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+)
- **PDF-Rendering**: PDF.js (Mozilla)
- **Bild-Editor**: Fabric.js
- **Markdown**: Marked.js
- **ZIP**: JSZip
- **DOCX**: html-docx.js
- **Backend (extern)**:
  - Marker (OCR & PDF-Parsing)
  - OpenWebUI (KI-Modelle via API)

---

## 📝 Changelog

Siehe [Git Tags](https://github.com/erichrueger-ssilv/ocr-marker/tags) für die vollständige Versionsgeschichte.

**Highlights:**

- **v2.26**: Tastenkombinationen-Modal, Versions-Badge
- **v2.24**: API-Einstellungen als eigene Sektion
- **v2.21**: Side-by-Side-Layout auf breiten Monitoren
- **v2.19**: Bild-Editor mit Crop, Brush, Undo
- **v2.15**: Direkter Bild-Upload (.png, .jpg, .webp, .gif)
- **v2.0**: Initiales Release mit Pipeline-Workflow

---

## 👤 Autor

**Erich Rüger** – Schloss-Schule Ilvesheim

---

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.
