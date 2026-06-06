# Brief — "Centinela" (nombre provisorio)
### Detector de tareas en WhatsApp para ONGs · Open source · Self-hosted

---

## 1. Problema

En las ONGs la coordinación operativa vive en WhatsApp: compromisos, entregas, pedidos y fechas se acuerdan en chats y se pierden. Nadie los traslada a un sistema de gestión porque nadie tiene tiempo de hacerlo. El resultado: tareas olvidadas, duplicadas o invisibles para el resto de la organización.

## 2. Solución

Un bot pasivo que participa como tercer integrante en grupos de WhatsApp de la organización. Lee las conversaciones, detecta posibles tareas con un modelo de IA local ("hay que entregar alimentos la semana que viene en Misiones"), las resume y clasifica, y las envía a una **bandeja de aprobación privada** del autor del mensaje. Cuando él la aprueba, la tarea pasa a un tablero visible para toda la organización y, si se explicitó un responsable, se le asigna automáticamente.

**Principio clave: el bot nunca actúa solo.** Solo propone; una persona decide. Esto evita falsos positivos molestos y genera confianza.

## 3. Arquitectura

Todo corre en una sola máquina (notebook con GPU), sin servicios externos.

```
WhatsApp (grupos de 3: persona A + persona B + bot)
        │
        ▼
┌─────────────────────┐
│ Listener (Baileys)  │  Node/TS · número dedicado · solo lectura
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Cola de mensajes    │  SQLite (tabla de pendientes de procesar)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Pipeline de IA      │  1) Filtro heurístico (regex/keywords: fechas,
│ (Ollama local)      │     verbos de acción) → descarta ~80% del ruido
│                     │  2) LLM clasifica + extrae JSON estructurado
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ API + Dashboard     │  Next.js · auth propia · bandeja → tablero
└─────────────────────┘
```

### Componentes

| Componente | Tecnología | Por qué |
|---|---|---|
| Conexión WhatsApp | **Baileys** (librería no oficial, Node/TS) | Sin navegador, liviana, multi-device, sesión persistente. Más estable que whatsapp-web.js para correr 24/7 |
| LLM | **Ollama** + Qwen 2.5 7B o Llama 3.1 8B (Q4) | Corre bien en GPU de notebook, buen español, salida JSON confiable |
| Base de datos | **SQLite** (embebida, better-sqlite3 + Drizzle) | Cero configuración, suficiente para 10-20 grupos, clave para el empaquetado en .exe |
| Backend + Dashboard | **Next.js + TypeScript** | Un solo proyecto para API y UI |
| Auth | **Lucia / NextAuth** self-hosted | Email + contraseña, sin servicios externos |

### Extracción estructurada

El LLM recibe el mensaje + contexto (últimos N mensajes del grupo) y devuelve JSON:

```json
{
  "es_tarea": true,
  "confianza": 0.87,
  "titulo": "Entregar alimentos en Misiones",
  "descripcion": "Tomás acordó con Juan la entrega de alimentos",
  "responsable_probable": "Juan",
  "fecha_limite": "2026-06-13",
  "categoria": "logística",
  "grupo_origen": "Tomás-Juan",
  "mensaje_original_id": "..."
}
```

Categorías iniciales: logística, finanzas, voluntariado, comunicación, administración, otro.

## 4. Multiusuario y permisos

La identidad se resuelve **vinculando el número de WhatsApp de cada persona con su cuenta del dashboard**:

1. El usuario se registra en el dashboard (email + contraseña).
2. El sistema le muestra un código de 6 dígitos.
3. Lo envía como mensaje a cualquier grupo donde esté el bot.
4. El bot (que solo lee) detecta el código y confirma la vinculación número ↔ cuenta.

Con eso, el ciclo de vida de una tarea tiene tres estados:

| Estado | Quién la ve | Quién puede actuar |
|---|---|---|
| `pendiente` | **Solo el creador** (el usuario cuyo número envió el mensaje detectado) | Solo el creador: aprobar, editar, asignar o descartar |
| `aprobada` | **Toda la organización** en el tablero | Asignado y admins pueden moverla (en curso / hecha) |
| `descartada` | Nadie (archivo interno) | — · sirve para medir falsos positivos del modelo |

**La card de aprobación es un mini-formulario, no un botón.** Todos los campos que extrajo el LLM llegan precargados pero editables: título, descripción, fecha límite, categoría y responsable (selector con los usuarios registrados). El mensaje original se muestra como referencia de solo lectura. El creador puede entonces corregir lo que el modelo entendió mal, completar lo que falta, y recién ahí aprobar — o descartar.

**Asignación:** si el LLM extrajo un responsable y matchea con un usuario registrado, el selector llega precargado con él; el creador puede confirmarlo o cambiarlo. Si el LLM no detectó responsable, el creador puede asignarlo manualmente en ese mismo paso. Si nadie lo asigna, la tarea entra al tablero sin asignar y cualquiera puede tomarla.

**Caso borde:** si el autor del mensaje no está registrado, la tarea propuesta queda retenida hasta que se registre y vincule su número (alternativa configurable: derivarla a la bandeja de un admin).

Roles mínimos: `admin` (gestiona usuarios y grupos) y `miembro`.

## 5. Hosting y acceso

**No necesita nube.** Todo corre en una máquina local de la ONG (la notebook con GPU o un mini PC en la sede). Esto es además un argumento del pitch: las conversaciones nunca salen de la organización y el costo es cero.

```
            WhatsApp ──▶ ┌────────────────────────────────────┐ ◀──▶ Usuarios
                         │  Servidor de la ONG (Windows/Linux)│      (web, celular)
                         │  Bot Baileys · Ollama · SQLite ·   │      vía LAN o
                         │  Dashboard Next.js                 │      Tailscale/túnel
                         └────────────────────────────────────┘
```

El dashboard es una web (`http://servidor:3000`) con login propio. Cómo llegan los usuarios:

| Opción | Cómo funciona | Costo | Cuándo conviene |
|---|---|---|---|
| Solo LAN | IP local en el WiFi de la sede | $0 | Todos trabajan en el mismo lugar |
| **Tailscale** (recomendada) | VPN mesh: cada miembro instala la app y accede desde cualquier lado, sin abrir puertos ni exponer nada a internet | $0 (plan free; alternativas 100% OSS: Headscale, WireGuard) | Equipo distribuido, máxima privacidad |
| Cloudflare Tunnel | URL pública (`tareas.miong.org`) tunelada al servidor local sin abrir puertos | $0 + dominio (~USD 10/año) | Acceso desde cualquier navegador sin instalar nada |

**Variante híbrida (documentada, no default):** VPS barato (~USD 5/mes) para bot + dashboard, delegando solo la inferencia a una API económica (Groq/DeepSeek, centavos/mes a este volumen). Útil si la ONG no puede dejar una máquina prendida 24/7, pero deja de ser "sin servicios externos".

**Demo del hackathon:** notebook + Cloudflare Tunnel o ngrok → los jueces entran desde sus celulares.

## 6. Distribución: dos empaques, un mismo código

| Modo | Para quién | Cómo |
|---|---|---|
| **docker-compose** | ONG con servidor Linux o perfil técnico | `git clone && docker compose up` |
| **Instalador .exe Windows** | ONG que solo tiene una PC de oficina | Doble click, queda en segundo plano y arranca con Windows |

### El .exe en detalle

- **Un solo proceso Node** (bot Baileys + API + dashboard Next.js en modo `standalone`) compilado a ejecutable con `pkg` o Node SEA. SQLite va embebida.
- **Ollama se instala aparte con su propio instalador oficial**, que ya lo deja como app de bandeja con arranque automático. Nuestro proceso le pega a `localhost:11434`.
- **Inicio automático:** instalador con **Inno Setup** que registra el programa al inicio de sesión (simple), o como **servicio de Windows** vía NSSM/`node-windows` (robusto: arranca sin login y se reinicia solo si crashea).
- **Primera ejecución:** página `/setup` en el dashboard (u opcionalmente ícono de bandeja con Tauri) para escanear el QR de WhatsApp. La sesión se persiste en `%APPDATA%` y no se vuelve a pedir.
- **Cuidados:** el instalador configura Windows para no suspender la máquina; reconexión de Baileys con backoff.

## 7. Estrategia anti-bloqueo (Meta)

Riesgo principal del proyecto. Mitigaciones:

1. **Solo lectura.** El bot nunca envía mensajes, nunca inicia chats, nunca agrega contactos. La detección de Meta apunta a spam y envíos masivos; un cliente pasivo es de bajo riesgo.
2. **Número dedicado con historial.** Chip prepago activado semanas antes, con uso humano normal previo. Nunca un número virtual recién creado.
3. **Vinculación por QR/pairing code** desde la app oficial en un teléfono real que queda encendido (el bot es un "dispositivo vinculado").
4. **Comportamiento humano:** reconexiones con backoff exponencial, sin loops de reconexión, presencia/typing apagados.
5. **Plan B:** la capa de WhatsApp está aislada detrás de una interfaz `MessageSource`. Si bloquean el número, se cambia el chip en minutos. A futuro: adaptador para la Cloud API oficial o Telegram.

> Nota de honestidad para el pitch y el README: usar Baileys viola los ToS de WhatsApp. El riesgo práctico de un bot pasivo de baja escala es bajo, pero existe, y documentarlo abiertamente es lo correcto en un proyecto open source.

## 8. Privacidad y consentimiento

- Todos los datos quedan en la máquina de la ONG. Nada sale a terceros.
- El bot solo se agrega a grupos donde **ambas personas saben que está** (el formato "grupo de 3" lo hace explícito por diseño).
- Ventana deslizante de contexto (p. ej. últimos 50 mensajes por grupo); el resto se descarta.
- Botón "olvidar grupo" que borra todo el historial de un grupo.
- Las tareas `pendientes` son privadas del autor por diseño (sección 4).

## 9. Alcance del MVP (hackathon)

**Demo objetivo:** mensaje real en un grupo → en <30 s aparece la tarea propuesta solo para su autor → la aprueba desde el celular → aparece en el tablero del equipo, asignada al responsable mencionado.

Incluye: bot en 2-3 grupos reales · pipeline heurística + LLM · vinculación por código · bandeja privada + tablero compartido · docker-compose funcional. El .exe puede mostrarse como "instalador en video/screenshots" si no llega pulido.

Roadmap (fuera del MVP): notificaciones al responsable · multi-organización · detección de tareas completadas ("ya entregué lo de Misiones") · adaptador Cloud API oficial / Telegram · métricas.

## 10. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Bloqueo del número por Meta | Baja-media | Sección 7; capa de WhatsApp intercambiable |
| Falsos positivos del LLM | Alta al inicio | Aprobación humana; umbral de confianza; filtro heurístico |
| LLM lento en la notebook | Baja con GPU | Modelo 7B Q4 responde en 1-3 s; la heurística evita llamar al LLM por cada mensaje |
| Baileys se rompe con updates de WhatsApp | Media | Pinear versión, monitorear el repo |
| PC de la ONG apagada/suspendida | Media | Instalador configura suspensión; servicio con auto-restart; los mensajes no leídos se procesan al reconectar |

## 11. Reparto de trabajo sugerido (equipo de 3-4, 24-48 h)

1. **Persona A:** Baileys + ingestión + SQLite + vinculación por código
2. **Persona B:** pipeline IA — heurística, prompt, Ollama, esquema JSON
3. **Persona C:** dashboard — auth, bandeja privada, tablero, asignación
4. **Persona D (o repartido):** docker-compose, empaquetado Windows, README, demo, pitch

## 12. Licencia y publicación

- **AGPL-3.0** (mejoras sobre el código se comparten, espíritu ONG) o MIT si prefieren máxima adopción.
- README con instalación en 3 comandos (Docker) y en 2 clicks (Windows), GIF de la demo, y la nota de honestidad sobre los ToS de WhatsApp.
