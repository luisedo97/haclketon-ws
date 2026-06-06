# ws-spy

App de escritorio para vincular múltiples dispositivos WhatsApp, almacenar conversaciones y gestionar tareas vinculadas a contactos. Incluye análisis con IA local via Ollama.

## Stack

| Capa | Tecnología |
|------|------------|
| Desktop | Electron (renderer Angular, reemplazable) |
| API | NestJS + Baileys + Socket.IO |
| IA | Ollama (modelo configurable, default `gemma3:1b`) |
| DB | MySQL + Prisma |
| Infra | Docker Compose |

## Estructura

```
apps/
  desktop/     # Electron + renderer Angular
  api/         # NestJS API
packages/
  shared/      # Tipos y schemas compartidos
docker/        # Scripts auxiliares
```

## Requisitos

- Node.js 20+
- pnpm 9+
- Docker y Docker Compose

## Primer arranque

```bash
# 1. Clonar e instalar dependencias
cp .env.example .env
pnpm install

# 2. Levantar servicios backend (MySQL, Ollama, API, Adminer)
pnpm compose:up

# 3. En otra terminal, levantar la app de escritorio
pnpm dev:desktop
```

Servicios disponibles:

- API: http://localhost:3000
- Adminer (DB): http://localhost:8080
- Ollama: http://localhost:11434

## Desarrollo

```bash
# Todos los workspaces en paralelo
pnpm dev

# Solo API (requiere MySQL/Ollama corriendo)
pnpm dev:api

# Solo desktop (Electron + Angular dev server)
pnpm dev:desktop

# Base de datos
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

## Vincular WhatsApp

1. Abre la app Electron (`pnpm dev:desktop`).
2. Ingresa un nombre y pulsa **Vincular WhatsApp**.
3. Escanea el QR con tu teléfono.
4. El estado del dispositivo se actualiza en tiempo real via Socket.IO.

## API endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET/POST | `/devices` | Listar / crear dispositivos |
| POST | `/devices/:id/connect` | Iniciar sesión Baileys |
| POST | `/devices/:id/disconnect` | Cerrar sesión |
| GET/POST | `/contacts` | CRUD contactos manuales |
| GET | `/conversations` | Conversaciones almacenadas |
| GET/POST/PATCH | `/tasks` | Gestión de tareas |
| POST | `/ai/analyze` | Análisis de ejemplo con Ollama |

## Eventos Socket.IO

| Evento | Payload |
|--------|---------|
| `whatsapp:qr` | `{ deviceId, qr }` |
| `whatsapp:device-status` | `{ deviceId, status, phoneE164? }` |
| `whatsapp:message` | `{ deviceId, message }` |
| `task:updated` | `{ taskId, status }` |

## Cambiar el modelo de Ollama

Edita `.env`:

```env
OLLAMA_MODEL=gemma3:1b
# OLLAMA_MODEL=llama3.2:1b
```

Reinicia el servicio:

```bash
docker compose restart ollama
```

El entrypoint en `docker/ollama/entrypoint.sh` descarga el modelo al iniciar.

## Reemplazar Angular por otro framework

El renderer vive en `apps/desktop/renderer/` y es independiente de Electron.

1. Reemplaza el contenido de `apps/desktop/renderer/` con tu framework (React, Vue, Svelte, etc.).
2. Asegúrate de que el build genere archivos estáticos en `renderer/dist/`.
3. Actualiza los scripts `renderer:dev` y `renderer:build` en `apps/desktop/package.json`.
4. Ajusta la ruta de carga en `apps/desktop/electron/main.ts` si cambia la estructura del output.

En desarrollo, Electron carga `http://localhost:4200`. Cambia el puerto si tu dev server usa otro.

## Variables de entorno

Ver [.env.example](.env.example).

## Próximos pasos (fuera del scaffolding)

- Autenticación de la API
- Vinculación automática contactos ↔ conversaciones
- Análisis IA real sobre historial de mensajes
- Empaquetado y firma del instalable Electron

## Licencia

Privado.
