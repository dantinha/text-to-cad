import { describe, expect, it } from 'vitest';
import { findSecrets, isScannable } from '../../scripts/secrets.ts';

// Amostras montadas em runtime para não acionar scanners de segredo sobre o próprio teste.
const envName = 'GEMINI_' + 'API_KEY';
const googleKey = 'AI' + 'za' + 'Sy' + 'A'.repeat(33);
const aqKey = 'A' + 'Q.' + 'Ab8RN6Ko_' + 'x'.repeat(30);

describe('findSecrets', () => {
  it('detecta chave de API do Google (AIza…)', () => {
    expect(findSecrets(`const k = "${googleKey}";`)).toHaveLength(1);
  });

  it('detecta token do Google AI Studio (AQ.…)', () => {
    expect(findSecrets(`${envName}=${aqKey}`)).toHaveLength(1);
  });

  it('detecta GEMINI_API_KEY preenchida em arquivo versionado', () => {
    expect(findSecrets(`${envName}=valorQualquerLongo123456`)).toHaveLength(1);
  });

  it('não acusa variável vazia, placeholder, referência de env nem texto comum', () => {
    expect(findSecrets(`${envName}=`)).toHaveLength(0);
    expect(findSecrets(`${envName}=\nGEMINI_MODEL=`)).toHaveLength(0);
    expect(findSecrets(`${envName}=\${process.env.CHAVE_AQUI}`)).toHaveLength(0);
    expect(findSecrets(`${envName}=<cole-sua-chave-aqui>`)).toHaveLength(0);
    expect(findSecrets('Olá mundo, sem segredo. AIza curto')).toHaveLength(0);
  });

  it('reporta número da linha sem expor o segredo inteiro', () => {
    const [hit] = findSecrets(`linha1\nchave ${googleKey}`);
    expect(hit?.line).toBe(2);
    expect(hit?.preview).not.toContain(googleKey);
  });
});

describe('isScannable', () => {
  it('ignora binários, lockfile e node_modules', () => {
    expect(isScannable('package-lock.json')).toBe(false);
    expect(isScannable('node_modules/x/index.js')).toBe(false);
    expect(isScannable('assets/logo.png')).toBe(false);
  });

  it('varre código e configuração', () => {
    expect(isScannable('src/ai/client.ts')).toBe(true);
    expect(isScannable('.env.example')).toBe(true);
  });
});
