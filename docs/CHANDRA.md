# Chandra OCR-Backend

## Übersicht

Chandra ist ein lokales Vision-Modell, das als alternatives OCR-Backend zu Marker eingesetzt werden kann. Es läuft über **LM Studio** auf dem lokalen Rechner und ist über eine OpenAI-kompatible API erreichbar.

**Modell:** `chandra-ocr-2-nvfp4-mlx`  
**Standard-URL:** `http://127.0.0.1:1234`

---

## Funktionsprinzip

Für jede PDF-Seite führt Chandra zwei Schritte aus:

1. **Rohtext-Extraktion** (via PDF.js `getTextContent()`): Der eingebettete Text der PDF-Seite wird direkt ausgelesen – inklusive Zeilenstruktur über `hasEOL`-Flags.
2. **Multimodaler API-Aufruf**: Das Modell erhält gleichzeitig:
   - Den extrahierten Rohtext als autoritative Quelle für alle Symbole und Inhalte
   - Die gerenderte Seite als PNG-Bild (Scale 2.0) für Layout und Struktur

### Warum Rohtext + Bild?

Vision-Modelle neigen dazu, mathematische Symbole aus dem Kontext zu „interpretieren" statt sie wortwörtlich zu übertragen. Beispiel: Ein `n` als obere Summengrenze wird zu `∞` korrigiert, weil das Modell weiß, dass Erwartungswerte üblicherweise als unendliche Reihen definiert werden.

Durch den eingebetteten PDF-Rohtext als explizite Quelle wird diese Halluzination verhindert – das Modell muss nicht mehr raten.

---

## API-Aufruf

```
POST http://127.0.0.1:1234/v1/chat/completions
```

```json
{
  "model": "chandra-ocr-2-nvfp4-mlx",
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "<Prompt mit Rohtext und Anweisungen>"
      },
      {
        "type": "image_url",
        "image_url": { "url": "data:image/png;base64,..." }
      }
    ]
  }],
  "max_tokens": 4096,
  "temperature": 0
}
```

---

## Prompt-Strategie

Der Prompt kombiniert drei Anforderungen:

1. **Symboltreue**: Rohtext ist autoritativ – keine Interpretation oder Korrektur von Symbolen (besonders mathematische Variablen wie `n`, `k`, `∞`)
2. **Listenstruktur**: Nummerierte Listen (1. 2. 3.) müssen erhalten bleiben, nie in Fließtext auflösen
3. **Bildbeschreibungen**: Abbildungen, Diagramme und Histogramme werden visuell auf Deutsch beschrieben – der Bildunterschrift-Label allein genügt nicht

---

## Chandra Output-Format

Chandra gibt strukturiertes HTML mit `data-label`-Attributen zurück. Die Funktion `chandraHtmlToMarkdown()` in `app.js` verarbeitet dieses Format zu sauberem Markdown.

### Unterstützte Block-Typen

| `data-label` | Markdown-Ausgabe |
|---|---|
| `Section-Header` | `## Überschrift` |
| `Text` | Fließtext mit LaTeX |
| `List-Group` | Nummerierte oder Bullet-Liste |
| `List-Item` | `- Eintrag` |
| `Equation-Block` | `$$...$$` |
| `Table` | Markdown-Tabelle mit LaTeX in Zellen |
| `Figure` / `Image` | `*[Abbildung: deutsche Beschreibung]*` |
| `Page-Header` / `Page-Footer` | wird unterdrückt |

### Math-Handling

- `<math>...</math>` in Textblöcken → `$...$` (via `innerText()`)
- `<math display="block">` → `$$...$$`
- `<math>` in Tabellenzellen → `$...$` (via `innerText()` beim Tabellen-Rendering)

---

## Seitenzahlen

Die erste Text-Item der PDF-Seite wird auf eine 1–4-stellige Zahl geprüft. Falls gefunden, wird die Original-Seitenzahl als `((324))` vor den Seiteninhalt gesetzt.

---

## Konfiguration im Frontend

| Einstellung | Beschreibung | Standard |
|---|---|---|
| Chandra URL | LM Studio API-Endpunkt | `http://127.0.0.1:1234` |
| Chandra Modell | Modellname in LM Studio | `chandra-ocr-2-nvfp4-mlx` |

---

## Unterschiede zu Marker

| Eigenschaft | Marker | Chandra |
|---|---|---|
| Läuft auf | Server (remote) | Lokal (LM Studio) |
| Benötigt Netzwerk | Ja | Nein |
| Mathematik-Qualität | Hoch (dedizierter Parser) | Gut (durch Rohtext-Anker) |
| Bildbeschreibungen | Via separaten LLM-Aufruf | Integriert im selben Aufruf |
| Geschwindigkeit | Schnell | Abhängig von lokaler Hardware |
