/**
 * Extrae el número E.164 de un JID de WhatsApp individual.
 * Retorna null para grupos, broadcasts y JIDs no numéricos.
 */
export function parsePhoneFromJid(jid: string): string | null {
  if (
    jid.endsWith('@g.us') ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@lid') ||
    jid === 'status@broadcast'
  ) {
    return null;
  }

  const userPart = jid.split('@')[0] ?? '';
  const phone = userPart.split(':')[0] ?? '';

  if (!/^\d+$/.test(phone)) {
    return null;
  }

  return phone;
}

function isNumericDisplayName(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/**
 * Formatea un JID o contacto para mostrar en UI.
 */
export function formatConversationTitle(
  jid: string,
  contact?: { displayName: string; phoneE164?: string; pushName?: string | null } | null,
  conversationTitle?: string | null,
): string {
  if (conversationTitle?.trim()) {
    return conversationTitle.trim();
  }

  if (contact?.pushName?.trim()) {
    return contact.pushName.trim();
  }

  if (
    contact?.displayName?.trim() &&
    !isNumericDisplayName(contact.displayName)
  ) {
    return contact.displayName.trim();
  }

  const phone = parsePhoneFromJid(jid);
  if (phone) {
    return `+${phone}`;
  }

  if (contact?.displayName?.trim()) {
    return contact.displayName.trim();
  }

  return 'Contacto';
}
