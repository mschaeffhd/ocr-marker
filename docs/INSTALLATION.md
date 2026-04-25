# Installation & Einrichtung

## Systemanforderungen

- Ein moderner Webbrowser (Chrome, Firefox, Edge, Safari)
- Ein Webserver für statische Dateien
- Optional: Docker für Container-Deployment

## Schnellinstallation

### 1. Dateien bereitstellen

Kopiere alle Dateien aus dem Repository auf deinen Webserver:

```bash
# Mit git
git clone https://github.com/erichrueger-ssilv/ocr-marker.git

# Oder ZIP herunterladen und entpacken
```

### 2. Webserver konfigurieren

#### Nginx

```nginx
server {
    listen 80;
    server_name deine-domain.de;
    root /var/www/ocr-marker;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # CORS für API-Proxy (falls nötig)
    location /api/ {
        proxy_pass http://backend:8000/;
    }
}
```

#### Apache

Die `.htaccess` ist bereits im Repository enthalten:

```apache
# CORS Header
Header always set Access-Control-Allow-Origin "*"

# Proxy für Marker API
RewriteEngine On
RewriteRule ^api/marker/upload$ https://dein-marker-server/marker/upload [P,NE,L]
```

### 3. Externe Dienste einrichten

#### Marker Server

Der Marker-Server muss erreichbar sein und PDF-Dateien entgegennehmen:

```bash
# Beispiel: Marker als Docker-Container
docker run -p 8000:8000 your-marker-image
```

#### OpenWebUI

Eine OpenWebUI-Instanz mit API-Zugang:

```bash
# OpenWebUI läuft typischerweise unter:
# https://openwebui.sbbz-ilvesheim.de
```

### 4. Erste Konfiguration

1. Öffne die Anwendung im Browser
2. Klicke auf ⚙️ Einstellungen
3. Trage ein:
   - **OpenWebUI API Token**: Dein API-Key
   - **Marker Server URL**: URL deines Marker-Servers
   - **OpenWebUI URL**: URL deiner OpenWebUI-Instanz
4. Klicke auf "🔄 Modelle neu laden"

---

## Entwicklungsumgebung

### Lokale Entwicklung

```bash
# Repository klonen
git clone https://github.com/erichrueger-ssilv/ocr-marker.git
cd ocr-marker

# Lokaler Server starten
python -m http.server 8080
# oder
npx serve .

# Im Browser öffnen: http://localhost:8080
```

### Live-Reloading (optional)

Für aktive Entwicklung mit automatischem Reload:

```bash
# Mit Node.js
npm install -g browser-sync
browser-sync start --server --files "*.html, *.css, *.js"
```

---

## Fehlerbehebung

### Browser-Cache

Nach Updates den Cache leeren:
- **Chrome/Edge**: `Strg + Shift + R`
- **Firefox**: `Strg + F5`
- **Safari**: `Cmd + Option + R`

### CORS-Fehler

Wenn die API-Anfragen blockiert werden:

1. Prüfe die `.htaccess`-Konfiguration
2. Stelle sicher, dass der Marker-Server CORS erlaubt
3. Verwende einen Proxy (siehe `.htaccess`)

### PDF.js Worker

Falls PDFs nicht gerendert werden:
- Prüfe, ob `lib/pdf.worker.min.js` existiert
- Prüfe die Browser-Konsole auf Fehlermeldungen
