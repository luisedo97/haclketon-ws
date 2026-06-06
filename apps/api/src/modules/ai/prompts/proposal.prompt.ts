import { PROPOSAL_CATEGORIES } from '@ws-spy/shared';

export interface PromptMessage {
  text: string;
  fromMe: boolean;
  sentAt: Date;
  authorLabel: string;
}

const CATEGORIES_LIST = PROPOSAL_CATEGORIES.join(' | ');

function formatLine(msg: PromptMessage, isFocus: boolean): string {
  const time = msg.sentAt.toISOString().slice(0, 16).replace('T', ' ');
  const marker = isFocus ? '>>> ' : '    ';
  return `${marker}[${time}] ${msg.authorLabel}: ${msg.text.trim()}`;
}

export function buildProposalPrompt(params: {
  messages: PromptMessage[];
  focusIndex: number;
  conversationTitle: string;
  todayIso: string;
}): string {
  const { messages, focusIndex, conversationTitle, todayIso } = params;

  const transcript = messages
    .map((msg, i) => formatLine(msg, i === focusIndex))
    .join('\n');

  return `Eres un asistente que detecta tareas operativas en conversaciones de WhatsApp de una ONG.
Tu única salida válida es un objeto JSON, sin texto adicional, sin markdown, sin comentarios.

Hoy es ${todayIso}. Grupo: "${conversationTitle}".

Conversación reciente (el mensaje a analizar está marcado con ">>>"):
${transcript}

INSTRUCCIONES:
- Analiza ÚNICAMENTE el mensaje marcado con ">>>". Los demás son contexto para entender pronombres y referencias.
- "es_tarea" = true SOLO si el mensaje marcado implica un compromiso, pedido o acción concreta a realizar.
- "confianza" entre 0 y 1: qué tan seguro estás de que es una tarea real (no chiste, no comentario).
- "titulo": frase corta en infinitivo o imperativo (≤80 chars). Si no hay tarea, dejar "".
- "descripcion": una oración que explique qué hay que hacer y el contexto relevante. Si no hay tarea, "".
- "responsable_probable": nombre o alias mencionado como responsable. Si no se menciona explícitamente, null. NO inventes.
- "fecha_limite": fecha en formato ISO YYYY-MM-DD si se infiere claramente. Si no, null. NO inventes.
- "categoria" debe ser EXACTAMENTE una de: ${CATEGORIES_LIST}.

EJEMPLOS:
Mensaje: ">>> [2026-06-06 10:00] Juan: hay que entregar los alimentos en Misiones el viernes"
Respuesta: {"es_tarea":true,"confianza":0.95,"titulo":"Entregar alimentos en Misiones","descripcion":"Juan acordó entregar alimentos en Misiones el viernes.","responsable_probable":"Juan","fecha_limite":"2026-06-12","categoria":"logística"}

Mensaje: ">>> [2026-06-06 10:00] Juan: jajaja sí dale"
Respuesta: {"es_tarea":false,"confianza":0.0,"titulo":"","descripcion":"","responsable_probable":null,"fecha_limite":null,"categoria":"otro"}

Devuelve SOLO el JSON con esta forma exacta:
{"es_tarea":boolean,"confianza":number,"titulo":string,"descripcion":string,"responsable_probable":string|null,"fecha_limite":string|null,"categoria":string}`;
}
