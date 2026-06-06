# Orden de construcción
### Dos personas, máximo paralelismo, dependencias explícitas

## Ruta crítica

La cadena que no se puede paralelizar — todo lo demás se acomoda alrededor:

```
F01S02 (worker LLM) → F03S01 (modelo propuestas) → F03S02 (permisos API)
        → F03S03/F03S04 (bandeja UI) → F04S03 (tablero) = DEMO COMPLETA
```

## Fase 0 — Antes que nada (1-2 h, juntos)

**(F07S03) Allowlist de grupos [Luis]**. Va primero por dos razones: es un cambio chico (un filtro en dos métodos) y mientras no exista, cada minuto de prueba con números reales acumula chats privados en la DB. Borrar la DB de pruebas después de mergearlo.

En paralelo, **decisión conjunta de 10 minutos:** subir `OLLAMA_MODEL` a `qwen2.5:7b` y dejarlo descargando (F01S04 depende de tener un modelo que extraiga bien en español).

## Fase 1 — Fundaciones en paralelo (sin dependencias cruzadas)

| Luis | Tomás |
|---|---|
| (F01S01) Filtro heurístico | (F02S01) Registro + login JWT |
| (F01S02) Worker de cola → Ollama | (F02S02) Roles admin/miembro |
| (F01S03) Contexto de conversación | (F01S04) Prompt: categoría + confianza + responsable |

Luis no necesita usuarios para el pipeline; Tomás no necesita el pipeline para el auth. F01S04 es de Tomás a propósito: puede iterar el prompt contra Ollama directo con transcripts hardcodeados, sin esperar el worker.

**Checkpoint 1:** un mensaje en un grupo allowlisted genera un registro de propuesta en la DB (aunque nadie lo vea todavía), y existe login.

## Fase 2 — El puente (acá se juntan las dos ramas)

1. **(F03S01) Modelo `TaskProposal` [Luis]** — necesita el output del worker (Fase 1 Luis) y el modelo `User` (Fase 1 Tomás). Hacer la migración **de a uno**: es el único punto del proyecto donde pisarse es caro.
2. **(F02S03) Vinculación por código [Luis]** — en paralelo con lo anterior no, inmediatamente después: toca el mismo `whatsapp.service`.
3. **(F03S02) Endpoints con permisos [Luis]** mientras **Tomás arranca (F03S03) la card de aprobación** contra un mock del endpoint (acordar el contrato JSON antes, 15 min de pizarra).

**Checkpoint 2:** Tomás manda un mensaje al grupo de prueba → la propuesta aparece **solo** en la bandeja de Tomás.

## Fase 3 — Cerrar el loop de la demo

| Luis | Tomás |
|---|---|
| (F04S01) Asignación a usuarios (migración) | (F03S03) Card de aprobación editable |
| (F04S02) Match automático de responsable | (F03S04) Aprobar / descartar |
| (F07S01) Backoff exponencial | (F04S03) Tablero compartido en tiempo real |

**Checkpoint 3 = la demo del pitch:** "hay que entregar alimentos la semana que viene en Misiones, lo ve Juan" → propuesta en la bandeja de Tomás → la edita y aprueba → aparece en el tablero asignada a Juan, en vivo en dos pantallas.

> Si el hackathon termina acá, ya hay producto. Todo lo que sigue es margen.

## Fase 4 — Lo que gana jueces (paralelo, sin dependencias entre sí)

| Luis | Tomás |
|---|---|
| (F06S02) docker-compose endurecido | (F05S01) Dashboard servido como web (mobile) |
| (F06S01) Instalador .exe con autostart | (F05S02) Acceso remoto (Tailscale/túnel) para demo desde celulares |
| | (F08S01) Seed de datos de demo |
| | (F07S02) Ventana deslizante + "olvidar grupo" |

Prioridad dentro de la fase: **F05S01 y F08S01 primero** (la demo desde el celular del juez con datos lindos vale más que el .exe). El .exe puede demostrarse con un video de 20 segundos si no llega pulido.

## Fase 5 — Si sobra tiempo

(F08S02) Resumen de actividad en el home. Y ensayar el pitch con el flujo del Checkpoint 3, que es el guion natural.

## Reglas operativas

- **Migraciones Prisma: siempre de a uno y avisando.** Es el único recurso compartido conflictivo (F03S01 y F04S01 pueden incluso unificarse en una sola migración si se hacen seguidas).
- **Contratos antes que código:** cada vez que una story de Luis alimenta una UI de Tomás (F03S02→F03S03, F04S02→F04S03), definir el JSON juntos antes de empezar.
- **Branch por story, merge al pasar el AC.** Con dos personas alcanza con `main` + branches cortas, sin PRs formales si hay confianza.
- Si una story de la ruta crítica se traba más de 2 horas, se simplifica el alcance, no se extiende el tiempo (ej.: F03S03 sin edición de categoría, solo título y responsable).
