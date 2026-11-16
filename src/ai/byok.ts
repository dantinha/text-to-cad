export const BYOK_SESSION_KEY = 'text-to-cad:byok-gemini-key';

function getSafeSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Lê a chave BYOK opcional armazenada apenas em `sessionStorage` (nunca `localStorage`). */
export function getByokKey(): string {
  const storage = getSafeSessionStorage();
  if (!storage) {
    return '';
  }
  try {
    return (storage.getItem(BYOK_SESSION_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

/** Salva a chave BYOK na sessão atual do navegador; string vazia remove a chave. */
export function setByokKey(key: string): void {
  const storage = getSafeSessionStorage();
  if (!storage) {
    return;
  }
  try {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      storage.removeItem(BYOK_SESSION_KEY);
    } else {
      storage.setItem(BYOK_SESSION_KEY, trimmed);
    }
  } catch {
    // Ambiente com storage bloqueado: ignora silenciosamente sem logar a chave.
  }
}

/** Remove a chave BYOK da sessão atual. */
export function clearByokKey(): void {
  const storage = getSafeSessionStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(BYOK_SESSION_KEY);
  } catch {
    // Ignora silenciosamente.
  }
}
