# Installation: OCR-Marker Web-App auf Linux-Server

Diese Anleitung richtet sich an eine KI-Assistenz, die die Anwendung auf einem
Linux-Server einrichten soll. Lies sie vollständig, bevor du anfängst.

---

## Was diese App ist

Eine rein clientseitige Web-App (HTML + JavaScript, kein Backend-Code).
Der Browser des Nutzers kommuniziert direkt mit externen Diensten:

- **Marker-Server** (PDF→Markdown OCR): `https://test-ki2.sbbz-ilvesheim.de/marker`
- **OpenWebUI** (KI-Modelle / Chandra): `https://openwebui.sbbz-ilvesheim.de/api`
- **LM Studio** (optional, lokal beim Nutzer): `http://127.0.0.1:1234`

Der Linux-Server muss nur statische Dateien ausliefern und den Marker-API-Aufruf
als Reverse-Proxy weiterleiten (wegen CORS).

---

## Voraussetzungen

- Linux-Server mit nginx (bereits installiert und aktiv)
- git installiert (`apt install git` falls nicht vorhanden)
- Internetzugang des Servers (für den Proxy zum Marker-Server)

---

## Schritt 1: Dateien vom GitHub holen

```bash
cd /var/www
git clone https://github.com/mschaeffhd/ocr-marker.git ocr-marker
cd ocr-marker
git checkout feature/chandra-backend
```

Das kopiert **alle** Anwendungsdateien auf den Server (index.html, app.js,
styles.css, sw.js, lib/, Bilder usw.). Kein separater Download nötig.

Überprüfen ob die Dateien da sind:
```bash
ls /var/www/ocr-marker/index.html
ls /var/www/ocr-marker/app.js
ls /var/www/ocr-marker/lib/pdf.min.js
```

---

## Schritt 2: nginx konfigurieren

Die fertige Konfiguration liegt in dieser Installationsdatei: `nginx-ocr-marker.conf`

```bash
# Konfigurationsdatei kopieren
cp /var/www/ocr-marker/../installation/nginx-ocr-marker.conf \
   /etc/nginx/sites-available/ocr-marker

# Domain/IP eintragen (PFLICHT – sonst funktioniert nginx nicht)
nano /etc/nginx/sites-available/ocr-marker
# → "DEINE_DOMAIN_ODER_IP" ersetzen durch die echte Domain oder IP-Adresse

# Site aktivieren
ln -s /etc/nginx/sites-available/ocr-marker /etc/nginx/sites-enabled/ocr-marker

# Konfiguration prüfen
nginx -t

# nginx neu laden
systemctl reload nginx
```

---

## Schritt 3: Berechtigungen setzen

```bash
chown -R www-data:www-data /var/www/ocr-marker
chmod -R 755 /var/www/ocr-marker
```

---

## Schritt 4: Testen

### 4.1 Webseite erreichbar?

Vom Server selbst:
```bash
curl -s http://localhost/ | grep "versionBadge"
```
Erwartet: eine Zeile mit `versionBadge` und einer Versionsnummer wie `v2.34`.

### 4.2 Statische Dateien korrekt ausgeliefert?

```bash
curl -s http://localhost/app.js | grep "convertWithChandra"
```
Erwartet: mindestens eine Zeile mit `convertWithChandra`.

### 4.3 Marker-Proxy erreichbar?

```bash
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost/api/marker/upload \
  -X POST \
  -F "file=@/dev/null"
```
Erwartet: HTTP 400 oder 422 (kein PDF = Fehler, aber Proxy funktioniert).
Nicht erwartet: 502 (Proxy nicht erreichbar) oder 404.

### 4.4 OpenWebUI direkt erreichbar?

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://openwebui.sbbz-ilvesheim.de/api/v1/models \
  -H "Authorization: Bearer sk-DEIN-API-KEY"
```
Erwartet: HTTP 200.
Hinweis: Den API-Key bekommst du vom Nutzer.

---

## Was der Nutzer danach einstellt

Der Nutzer ruft die Seite vom Mac auf und konfiguriert im Browser unter
**API-Einstellungen**:

- **OpenWebUI URL**: `https://openwebui.sbbz-ilvesheim.de/api`
- **API-Key**: (eigener Key)
- **OCR-Backend**: Marker (Server) oder Chandra
- **Chandra lokal (LM Studio)**: `http://127.0.0.1:1234` – läuft auf dem Mac
  des Nutzers, nicht auf dem Server. Das ist korrekt so.

---

## Fehlerdiagnose

| Problem | Mögliche Ursache | Lösung |
|---------|-----------------|--------|
| Seite lädt nicht | nginx nicht aktiv | `systemctl status nginx` |
| 502 bei /api/marker/ | Marker-Server nicht erreichbar | `curl https://test-ki2.sbbz-ilvesheim.de/marker/health` |
| Modelle laden nicht | Falscher API-Key | Key in den Browser-Einstellungen prüfen |
| Chandra lokal schlägt fehl | Normal wenn kein LM Studio läuft | Nutzer muss LM Studio auf dem Mac starten |
| Alte Version im Browser | Service Worker cached | DevTools → Application → Service Workers → Unregister |

---

## Updates einspielen

```bash
cd /var/www/ocr-marker
git pull
systemctl reload nginx  # nicht nötig, da nur statische Dateien
```

---

## Nicht benötigt auf dem Server

- Python / pip
- Node.js / npm
- Docker
- Datenbankserver
- LM Studio (läuft beim Nutzer lokal auf dem Mac)
