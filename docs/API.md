# API-Dokumentation

## Übersicht

Die Anwendung kommuniziert mit zwei externen APIs:

1. **Marker API** – PDF-OCR und Parsing
2. **OpenWebUI API** – KI-Modell für Bildbeschreibung

---

## Marker API

### Upload Endpoint

```
POST {markerServerUrl}
```

**Standard:** `./api/marker/upload`

### Request

```http
POST /marker/upload HTTP/1.1
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="pdf"; filename="document.pdf"
Content-Type: application/pdf

[PDF-Binary-Daten]
--boundary--
```

### Query-Parameter

| Parameter | Typ | Beschreibung | Standard |
|-----------|-----|--------------|----------|
| `force_ocr` | boolean | OCR erzwingen | `false` |
| `paginate` | boolean | Seitenumbrüche erhalten | `false` |
| `output_format` | string | `markdown` oder `json` | `markdown` |
| `page_range` | string | Seitenbereich (z.B. `1-10`) | - |
| `use_llm` | boolean | LLM für OCR verwenden | `false` |
| `strip_existing_ocr` | boolean | Vorhandenen OCR entfernen | `false` |
| `langs` | string | Sprachen (Komma-getrennt) | `de,en` |

### Response

```json
{
  "markdown": "# Titel\n\nInhalt...",
  "metadata": {
    "title": "Dokumenttitel",
    "pages": 10
  },
  "images": {
    "page_1.png": "base64-encoded-image...",
    "page_2.png": "base64-encoded-image..."
  }
}
```

---

## OpenWebUI API

### Modelle auflisten

```
GET {openwebuiUrl}/models
```

**Headers:**
```http
Authorization: Bearer {apiToken}
```

### Bildbeschreibung

```
POST {openwebuiUrl}/chat/completions
```

**Headers:**
```http
Content-Type: application/json
Authorization: Bearer {apiToken}
```

**Body:**
```json
{
  "model": "llava-13b",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Describe illustrations comprehensively in German..."
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,iVBORw0KGgo..."
          }
        }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "choices": [
    {
      "message": {
        "content": "((Bild))\nDiagramm:\nEine farbenfrohe Illustration...\n((/Bild))"
      }
    }
  ]
}
```

---

## Konfiguration im Frontend

### API-Settings Panel

Die API-Konfiguration erfolgt über das **🔌 API-Einstellungen** Panel in der Sidebar:

| Feld | Beschreibung | Beispiel |
|------|--------------|----------|
| **OpenWebUI API Token** | Dein persönlicher API-Key | `sk-abc123...` |
| **KI-Modell** | Auswahl aus verfügbaren Modellen | `llava-13b` |
| **Marker Server URL** | Endpoint für PDF-Upload | `./api/marker/upload` |
| **OpenWebUI URL** | Basis-URL der OpenWebUI-Instanz | `https://openwebui.example.com/api` |

### Proxy-Konfiguration

Für die Marker API wird ein Proxy empfohlen, um CORS-Probleme zu vermeiden:

#### Apache (.htaccess)
```apache
RewriteEngine On
RewriteRule ^api/marker/upload$ https://marker-server.example.com/marker/upload [P,NE,L]

# Preflight
RewriteCond %{REQUEST_METHOD} OPTIONS
RewriteRule ^api/marker/upload$ - [R=204,L]
```

#### Nginx
```nginx
location /api/marker/ {
    proxy_pass https://marker-server.example.com/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

## Fehlerbehandlung

### Häufige Fehler

| Fehler | Ursache | Lösung |
|--------|---------|--------|
| `401 Unauthorized` | Ungültiger API-Token | Token prüfen und neu eingeben |
| `403 Forbidden` | CORS-Blockade | Proxy konfigurieren oder CORS-Header setzen |
| `404 Not Found` | Falsche API-URL | URL in den Einstellungen korrigieren |
| `500 Server Error` | Marker-Server-Fehler | Server-Logs prüfen |
| `Network Error` | Keine Netzwerkverbindung | Verbindung prüfen, VPN/Proxy prüfen |

### Debug-Modus

Öffne die Browser-Entwicklertools (F12) und prüfe die Konsole:

```javascript
// In der Browser-Konsole
pipelineState  // Zeigt den aktuellen Zustand
```
