# Benutzerhandbuch

## Schritt-für-Schritt-Anleitung

### 1. PDF hochladen

- Ziehe eine PDF-Datei auf die Drop-Zone
- Oder klicke auf "wählen" und wähle eine Datei aus
- Unterstützte Formate: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`

### 2. Einstellungen anpassen (optional)

Klicke auf das ⚙️-Icon, um die Sidebar zu öffnen:

#### Basis-Einstellungen
- **Bilderkennungs-Prompt**: Anpassen, wie die KI Bilder beschreibt
- **Force OCR**: Aktivieren, wenn das PDF gescannt ist
- **Page Range**: Nur bestimmte Seiten verarbeiten (z.B. `1-10,15`)

#### Export-Formatierung
- Wähle aus, welche Nachbearbeitungen auf das Markdown angewendet werden
- Passe Schriftgröße und Zeilenabstand für DOCX an

#### API-Einstellungen
- Trage deinen OpenWebUI API-Token ein
- Wähle ein KI-Modell aus der Liste

### 3. Pipeline starten

Klicke auf **🚀 Pipeline starten** oder drücke `Alt + P`.

Die Pipeline durchläuft folgende Schritte:
1. **PDF-Upload** zur Marker API
2. **OCR & Parsing** (Marker verarbeitet das PDF)
3. **Bilderkennung** (KI beschreibt extrahierte Bilder)
4. **Markdown-Erzeugung**

### 4. Ergebnisse prüfen

Während der Verarbeitung siehst du:
- **Fortschrittsbalken** für die Bildanalyse
- **Pipeline-Aktivitäten** mit Log-Ausgaben
- **Markdown-Preview** (Split, Vorschau, Source)

### 5. Vergleichsansicht

Klicke auf eine Seitenzahl oder das Vergleichs-Icon:
- **Links**: Original-PDF-Seite
- **Rechts**: Erkannte Bilder mit KI-Beschreibungen
- Navigation mit `←` / `→` Tasten

### 6. Bilder bearbeiten (optional)

Klicke auf ein extrahiertes Bild in der Vergleichsansicht:
- **Zuschneiden**: Bildausschnitt auswählen
- **Pinsel**: Bereiche übermalen (z.B. um Text zu entfernen)
- **Farbe wählen**: Mit dem Color-Picker oder der Pipette
- **Rückgängig**: `Ctrl + Z`
- **Bild tauschen**: Eigenes Bild hochladen
- **Speichern & KI-Neu**: Bearbeitetes Bild neu analysieren

### 7. Exportieren

- **📘 Word-Datei (.docx)**: Formatiertes Word-Dokument
- **📄 Markdown laden**: Roh-Datei als .md
- **📋 Kopieren**: Markdown in Zwischenablage
- **📦 Archiv (ZIP)**: Markdown + alle Bilder

---

## Tastenkombinationen

| Kombination | Aktion |
|-------------|--------|
| `Alt + P` | Pipeline starten |
| `Alt + S` | Word-Datei herunterladen |
| `Alt + M` | Markdown herunterladen |
| `Alt + C` | Markdown kopieren |
| `Alt + E` | Einstellungen umschalten |
| `Alt + R` | Pipeline zurücksetzen |
| `Escape` | Modal schließen / Fokus entfernen |

In der Vergleichsansicht:
- `←` Vorherige Seite
- `→` Nächste Seite
- `Escape` Zoom-Overlay schließen

---

## Tipps & Tricks

### Bessere Bildbeschreibungen

Passe den **Bilderkennungs-Prompt** an deine Bedürfnisse an:

```
# Standard-Prompt für deutsche Bildbeschreibungen
Describe illustrations comprehensively in German...
```

### Seitenumbrüche erhalten

Aktiviere **Paginate Output**, um Seitenumbrüche im Markdown zu erhalten. Die Seitenzahlen werden als `((n))` eingefügt.

### LaTeX-Mathematik

Die Pipeline erkennt automatisch mathematische Formeln und konvertiert sie in LaTeX:
- Inline: `$...$`
- Block: `$$...$$`

Im Word-Export werden diese mit `<L>...</L>` Tags markiert.

### Große PDFs

Für sehr große PDFs:
1. Verwende **Page Range**, um nur relevante Seiten zu verarbeiten
2. Deaktiviere **Force OCR**, wenn das PDF textbasiert ist
3. Warte auf die vollständige Verarbeitung vor dem Export
