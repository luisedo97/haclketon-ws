export function formatConversationTitle(
  jid: string,
  contact?: {
    displayName: string;
    phoneE164?: string;
    pushName?: string | null;
  } | null,
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
    !/^\d+$/.test(contact.displayName.trim())
  ) {
    return contact.displayName.trim();
  }

  if (jid.endsWith('@s.whatsapp.net')) {
    return `+${jid.split('@')[0]?.split(':')[0] ?? jid}`;
  }

  if (contact?.displayName?.trim()) {
    return contact.displayName.trim();
  }

  return 'Contacto';
}
