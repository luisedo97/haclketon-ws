# Backlog — features y user stories
### Basado en el estado actual del repo `haclketon-ws` (ws-spy)

**Punto de partida (ya hecho, no se toca):** ingesta Baileys multi-dispositivo con QR vía Socket.IO, persistencia de mensajes/contactos/chats en MySQL (Prisma), CRUD de tareas, análisis IA manual por rango con Ollama, docker-compose completo.

**Convención:** `(F00)` = feature · `(F00S00)` = user story. Asignación: **[Tomás]** / **[Luis]**.

---

## (F01) Detección automática de tareas

Hoy el análisis es manual (seleccionar rango → analizar). Esta feature lo convierte en el pipeline en tiempo real del brief, reutilizando `AiService` y su prompt.

- **(F01S01) [Luis]** Como organización, quiero que cada mensaje entrante pase por un filtro heurístico barato (fechas, verbos de acción, keywords como "hay que", "para el", "acordate"), para no llamar al LLM por cada "jaja ok". *Hook en `handleIncomingMessage` → tabla `analysis_queue`. AC: ≥70% de mensajes triviales descartados sin tocar Ollama.*
- **(F01S02) [Luis]** Como organización, quiero un worker que consuma la cola, arme el contexto y llame a Ollama, para que las tareas se detecten sin intervención humana. *Reusa `AiService.buildPrompt`. AC: mensaje → propuesta en DB en <30 s.*
- **(F01S03) [Luis]** Como organización, quiero que el análisis incluya los últimos N mensajes de la conversación como contexto, para que "dale, la semana que viene" se entienda. *AC: ventana configurable, default 15.*
- **(F01S04) [Tomás]** Como miembro, quiero que cada propuesta traiga categoría (logística, finanzas, voluntariado, comunicación, administración, otro), confianza (0-1) y responsable probable, para revisarla más rápido. *Extiende el prompt y `AiAnalysisOutputSchema`. Evaluar subir de `gemma3:1b` a `qwen2.5:7b` (hay GPU). AC: JSON válido en ≥95% de los casos con 20 mensajes de prueba.*

## (F02) Usuarios y autenticación

Hoy la API es abierta y no existe el concepto "persona que se loguea". Es prerequisito de los permisos.

- **(F02S01) [Tomás]** Como miembro, quiero registrarme y loguearme con email y contraseña, para tener identidad en el sistema. *Modelo `User`, JWT (guard de NestJS), pantallas login/registro. AC: endpoints protegidos devuelven 401 sin token; la sesión persiste (cookie httpOnly o token con expiración ≥7 días en `localStorage`) para no pedir login en cada refresh — crítico para la UX mobile de F05S01.*
- **(F02S02) [Tomás]** Como admin, quiero roles `admin` y `miembro`, para que solo admins gestionen dispositivos, grupos y usuarios. *AC: miembro recibe 403 en endpoints de admin.*
- **(F02S03) [Luis]** Como miembro, quiero vincular mi número de WhatsApp enviando un código de 6 dígitos a un grupo donde está el bot, para que el sistema sepa qué mensajes son míos — sin que el bot envíe nada. *Detección del código en `handleIncomingMessage`, match contra códigos activos, guarda `User.phoneE164`. AC: vinculación en <10 s, código expira a los 15 min.*

## (F03) Bandeja de aprobación privada

El corazón del producto: la propuesta de IA es privada del autor hasta que la aprueba.

- **(F03S01) [Luis]** Como sistema, quiero un modelo `TaskProposal` (estados `pendiente` / `aprobada` / `descartada`, `creatorUserId`, campos extraídos por la IA, referencia al mensaje original), separado de `Task`, para distinguir propuesta de tarea oficial. *Migración Prisma. El worker de F01S02 escribe acá.*
- **(F03S02) [Luis]** Como creador, quiero que solo yo vea y opere mis propuestas pendientes, para que nadie vea tareas no confirmadas. *Filtro por `creatorUserId` del JWT en todos los endpoints. AC: otro usuario recibe 404/403 sobre una propuesta ajena; propuestas de números no vinculados quedan retenidas.*
- **(F03S03) [Tomás]** Como creador, quiero una card de aprobación tipo mini-formulario con todos los campos precargados y editables (título, descripción, fecha, categoría, responsable) y el mensaje original de WhatsApp como referencia, para corregir lo que la IA entendió mal antes de aprobar. *Nueva vista "Bandeja" en el renderer Angular. AC: editar y aprobar en una sola acción.*
- **(F03S04) [Tomás]** Como creador, quiero aprobar (crea la `Task` pública) o descartar (archiva, no borra) cada propuesta, para controlar qué ve la organización. *AC: descartadas quedan consultables para medir falsos positivos; eventos Socket.IO al aprobar Y al descartar (`proposal:approved` / `proposal:discarded`) para que la bandeja se refresque en vivo si está abierta en otra pestaña/dispositivo.*

## (F04) Tablero organizacional y asignación

- **(F04S01) [Luis]** Como organización, quiero que las tareas se asignen a usuarios (`assigneeUserId`) y no solo a contactos, para que cada uno sepa qué le toca. *Migración sobre `Task` manteniendo `contactId` como referencia de origen.*
- **(F04S02) [Luis]** Como creador, quiero que si la IA detectó un responsable que matchea con un usuario registrado (por nombre vinculado o número), el selector llegue precargado, para asignar en un click. *AC: match por `phoneE164` exacto y por nombre normalizado; sin match → selector vacío.*
- **(F04S03) [Tomás]** Como miembro, quiero un tablero compartido con todas las tareas aprobadas (filtros por estado, categoría y asignado; mover entre pendiente / en curso / hecha) que se actualice en tiempo real, para coordinarnos sin WhatsApp. *Reusa `task:updated` de Socket.IO. AC: dos sesiones ven el cambio sin refrescar.*

## (F05) Acceso multiusuario vía web

La app actual es Electron mono-PC. El renderer Angular ya corre en navegador: se sirve desde la API y todos acceden.

- **(F05S01) [Tomás]** Como miembro, quiero entrar al dashboard desde el navegador de mi PC o celular (`http://servidor:3000`), para no depender de la PC donde corre el bot. *La API sirve el build estático del renderer; Electron queda como estación de administración (QR, dispositivos). AC: bandeja y tablero usables en mobile.*
- **(F05S02) [Tomás]** Como ONG, quiero una guía de acceso remoto (LAN / Tailscale / Cloudflare Tunnel), para que el equipo entre desde cualquier lado sin exponer el servidor. *Doc + script opcional. AC: probado con un celular fuera de la red.*

## (F06) Distribución e instalación

- **(F06S01) [Luis]** Como ONG sin perfil técnico, quiero un instalador .exe que deje todo corriendo en segundo plano y arrancando con Windows, para instalar en 5 minutos. *`electron-builder` (ya está el yml) + autostart + chequeo/instalación de Ollama + anti-suspensión. AC: PC limpia → demo funcionando solo con el instalador.*
- **(F06S02) [Luis]** Como ONG con servidor, quiero el docker-compose endurecido (`restart: unless-stopped`, healthchecks, GPU passthrough para Ollama, volúmenes documentados), para correr 24/7 sin niñera. *AC: `docker compose up -d` sobrevive a un reboot.*

## (F07) Privacidad y anti-bloqueo (hardening)

- **(F07S01) [Luis]** Como sistema, quiero reconexión con backoff exponencial + jitter (hoy: retry fijo de 3 s), para no generar patrones de reconexión agresivos que llamen la atención de Meta. *AC: 3s → 6s → 12s… tope 5 min, se resetea al conectar.*
- **(F07S02) [Tomás]** Como admin, quiero una ventana deslizante de mensajes por grupo (default: últimos 50) y un botón "olvidar grupo" que borre todo su historial, para minimizar datos almacenados. *Job de limpieza + endpoint + UI en admin. AC: tras "olvidar", cero mensajes de ese grupo en DB.*
- **(F07S03) [Luis]** ⚠️ **Prioritaria.** Como ONG, quiero una allowlist de grupos monitoreados, porque hoy el sistema guarda TODAS las conversaciones del número (incluyendo chats 1:1 privados) — esto contradice el modelo de consentimiento "grupo de 3" y es indefendible en el pitch. *Filtro en `handleIncomingMessage`/`syncChat`: solo JIDs `@g.us` aprobados por un admin. AC: un mensaje 1:1 jamás se persiste.*

## (F08) Demo y pitch

- **(F08S01) [Tomás]** Como equipo, quiero un seed de datos de demo (usuarios Tomás/Luis, grupos, propuestas y tareas de ejemplo), para que la app nunca se vea vacía frente a los jueces. *AC: `pnpm db:seed` deja todo listo.*
- **(F08S02) [Tomás]** Como miembro, quiero un resumen al entrar ("se detectaron 12 tareas esta semana, tenés 3 pendientes de aprobar"), para ver el valor del sistema de un vistazo. *AC: card de stats en el home del dashboard.*
- **(F08S03) [Luis]** Como equipo, quiero métricas mínimas del pipeline en los logs (mensajes ingresados, % descartado por la heurística, llamadas a Ollama, % con `es_tarea=true`, tiempo medio de inferencia), para tunear el prompt y el filtro sin adivinar y para tener números reales que mostrar en el pitch. *Logger estructurado en F01S01/F01S02; endpoint `/metrics/summary` opcional consumido por F08S02. AC: un `console.log` resumido cada 50 mensajes procesados y los contadores expuestos por API.*

---

**Totales:** Luis 13 stories (pipeline, Baileys, datos, infra, métricas) · Tomás 11 stories (auth, UI, web, demo). Las features F01–F04 son el MVP; F05–F08 son las que ganan el pitch.
