import { describe, expect, it } from 'vitest';
import { validateIR } from '@/core/ir/validate';
import { MAX_DEPTH, MAX_NODES } from '@/core/ir/limits';
import { allNodeTypesDoc, cubeDoc, deepChain, wideUnion } from '../fixtures/ir';

const issuesOf = (input: unknown) => {
  const r = validateIR(input);
  if (r.ok) throw new Error('esperava falha de validação');
  return r.error;
};

describe('validateIR: documentos válidos', () => {
  it('aceita um cubo mínimo e devolve o mesmo conteúdo', () => {
    const r = validateIR(cubeDoc());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(cubeDoc());
  });

  it('aceita todos os 13 tipos de nó', () => {
    expect(validateIR(allNodeTypesDoc())).toEqual({ ok: true, value: allNodeTypesDoc() });
  });

  it('aceita exatamente MAX_NODES nós e MAX_DEPTH de profundidade', () => {
    expect(validateIR(wideUnion(MAX_NODES)).ok).toBe(true);
    expect(validateIR(deepChain(MAX_DEPTH)).ok).toBe(true);
  });

  it('não muta a entrada (entrada congelada)', () => {
    const frozen = Object.freeze(JSON.parse(JSON.stringify(allNodeTypesDoc())));
    expect(validateIR(frozen).ok).toBe(true);
  });
});

describe('validateIR: raiz do documento', () => {
  it('rejeita entrada que não é objeto', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      expect(issuesOf(bad).length).toBeGreaterThan(0);
    }
  });

  it('rejeita schemaVersion diferente de 1', () => {
    const [i] = issuesOf({ ...cubeDoc(), schemaVersion: 2 });
    expect(i).toMatchObject({ path: 'schemaVersion', code: 'schema_version' });
  });

  it('rejeita unidade diferente de mm', () => {
    const [i] = issuesOf({ ...cubeDoc(), units: 'cm' });
    expect(i).toMatchObject({ path: 'units', code: 'unidade_invalida' });
  });

  it('rejeita raiz ausente', () => {
    const semRaiz = Object.fromEntries(Object.entries(cubeDoc()).filter(([k]) => k !== 'root'));
    expect(issuesOf(semRaiz)).toContainEqual(
      expect.objectContaining({ path: 'root', code: 'campo_obrigatorio' }),
    );
  });
});

describe('validateIR: campos e limites', () => {
  const withRoot = (root: unknown) => ({ ...cubeDoc(), root });

  it('rejeita tipo de nó desconhecido', () => {
    const [i] = issuesOf(withRoot({ id: 'a', type: 'pyramid' }));
    expect(i).toMatchObject({ path: 'root.type', code: 'tipo_invalido' });
  });

  it('rejeita campo obrigatório ausente com o caminho do campo', () => {
    expect(issuesOf(withRoot({ id: 'a', type: 'cube' }))).toContainEqual(
      expect.objectContaining({ path: 'root.size', code: 'campo_obrigatorio' }),
    );
  });

  it('rejeita dimensão abaixo de 0,1 mm e acima de 1000 mm', () => {
    expect(issuesOf(withRoot({ id: 'a', type: 'cube', size: [0.05, 10, 10] }))).toContainEqual(
      expect.objectContaining({ path: 'root.size[0]', code: 'valor_fora_do_limite' }),
    );
    expect(issuesOf(withRoot({ id: 'a', type: 'cube', size: [10, 1000.5, 10] }))).toContainEqual(
      expect.objectContaining({ path: 'root.size[1]', code: 'valor_fora_do_limite' }),
    );
  });

  it('rejeita NaN e Infinity', () => {
    expect(issuesOf(withRoot({ id: 'a', type: 'sphere', radius: Number.NaN })).length).toBe(1);
    expect(issuesOf(withRoot({ id: 'a', type: 'sphere', radius: Infinity })).length).toBe(1);
  });

  it('rejeita segments acima de 128, abaixo de 3 ou não inteiro', () => {
    for (const segments of [129, 2]) {
      expect(issuesOf(withRoot({ id: 'a', type: 'sphere', radius: 5, segments }))).toContainEqual(
        expect.objectContaining({ path: 'root.segments', code: 'valor_fora_do_limite' }),
      );
    }
    const [nonInt] = issuesOf(withRoot({ id: 'a', type: 'sphere', radius: 5, segments: 12.5 }));
    expect(nonInt).toMatchObject({ path: 'root.segments', code: 'tipo_invalido' });
    expect(nonInt?.message).toContain('número inteiro');
    expect(validateIR(withRoot({ id: 'a', type: 'sphere', radius: 5, segments: 128 })).ok).toBe(
      true,
    );
  });

  it('reporta limites de string em caracteres', () => {
    const [shortId] = issuesOf(withRoot({ id: '', type: 'cube', size: [1, 1, 1] }));
    expect(shortId?.message).toContain('caracteres');
    const [longLabel] = issuesOf(
      withRoot({ id: 'a', type: 'cube', size: [1, 1, 1], label: 'x'.repeat(81) }),
    );
    expect(longLabel?.message).toContain('caracteres');
  });

  it('rejeita polígono com menos de 3 ou mais de 256 vértices', () => {
    const poly = (n: number) => Array.from({ length: n }, (_, k) => [k, k * 2]);
    const ext = (n: number) => ({ id: 'e', type: 'extrude', polygon: poly(n), height: 5 });
    expect(validateIR(withRoot(ext(2))).ok).toBe(false);
    expect(validateIR(withRoot(ext(3))).ok).toBe(true);
    expect(validateIR(withRoot(ext(256))).ok).toBe(true);
    expect(validateIR(withRoot(ext(257))).ok).toBe(false);
  });

  it('rejeita escala fora de 0,01–100', () => {
    const sc = (factor: number[]) => ({
      id: 's',
      type: 'scale',
      factor,
      child: { id: 'c', type: 'cube', size: [1, 1, 1] },
    });
    expect(validateIR(withRoot(sc([0.001, 1, 1]))).ok).toBe(false);
    expect(validateIR(withRoot(sc([101, 1, 1]))).ok).toBe(false);
    expect(validateIR(withRoot(sc([0.01, 100, 1]))).ok).toBe(true);
  });

  it('rejeita vetor normal nulo no mirror', () => {
    const r = withRoot({
      id: 'm',
      type: 'mirror',
      normal: [0, 0, 0],
      child: { id: 'c', type: 'cube', size: [1, 1, 1] },
    });
    expect(issuesOf(r)[0]).toMatchObject({ code: 'valor_invalido' });
  });

  it('rejeita torus com raio menor maior ou igual ao raio maior', () => {
    const t = (minorRadius: number) =>
      withRoot({ id: 't', type: 'torus', majorRadius: 10, minorRadius });
    expect(validateIR(t(10)).ok).toBe(false);
    expect(validateIR(t(3)).ok).toBe(true);
  });

  it('rejeita campos desconhecidos (objeto estrito)', () => {
    const [i] = issuesOf(withRoot({ id: 'a', type: 'cube', size: [1, 1, 1], hack: true }));
    expect(i).toMatchObject({ path: 'root', code: 'campo_desconhecido' });
  });

  it('rejeita cor e id em formato inválido', () => {
    expect(
      issuesOf(withRoot({ id: 'a', type: 'cube', size: [1, 1, 1], color: 'vermelho' })),
    ).toContainEqual(expect.objectContaining({ path: 'root.color', code: 'formato_invalido' }));
    expect(issuesOf(withRoot({ id: 'a b!', type: 'cube', size: [1, 1, 1] }))).toContainEqual(
      expect.objectContaining({ path: 'root.id', code: 'formato_invalido' }),
    );
  });

  it('exige base + 1 subtração em difference e 2 filhos em union', () => {
    const cube = { id: 'c', type: 'cube', size: [1, 1, 1] };
    expect(validateIR(withRoot({ id: 'd', type: 'difference', base: cube, subtract: [] })).ok).toBe(
      false,
    );
    expect(validateIR(withRoot({ id: 'u', type: 'union', children: [cube] })).ok).toBe(false);
  });

  it('reporta todos os problemas, não só o primeiro', () => {
    const issues = issuesOf(withRoot({ id: 'a', type: 'cube', size: [0, 5000, 10] }));
    expect(issues.length).toBe(2);
  });

  it('mensagens em português', () => {
    const msgs = issuesOf(withRoot({ id: 'a', type: 'cube', size: [0, 5000, 10] })).map(
      (i) => i.message,
    );
    for (const m of msgs) {
      expect(m).not.toMatch(/Invalid|expected|received/i);
      expect(m.length).toBeGreaterThan(5);
    }
  });
});

describe('validateIR: guardrails estruturais', () => {
  it('rejeita mais de MAX_NODES nós', () => {
    expect(issuesOf(wideUnion(MAX_NODES + 1))).toContainEqual(
      expect.objectContaining({ code: 'limite_nos' }),
    );
  });

  it('rejeita profundidade acima de MAX_DEPTH', () => {
    expect(issuesOf(deepChain(MAX_DEPTH + 1))).toContainEqual(
      expect.objectContaining({ code: 'limite_profundidade' }),
    );
  });

  it('não estoura a pilha com cadeia profunda (10 mil níveis)', () => {
    expect(issuesOf(deepChain(10_000)).length).toBeGreaterThan(0);
  });

  it('rejeita ids duplicados indicando o caminho do segundo', () => {
    const cube = (id: string) => ({ id, type: 'cube', size: [1, 1, 1] });
    const doc = {
      ...cubeDoc(),
      root: { id: 'u', type: 'union', children: [cube('x'), cube('x')] },
    };
    expect(issuesOf(doc)).toContainEqual(
      expect.objectContaining({ path: 'root.children[1].id', code: 'id_duplicado' }),
    );
  });

  it('detecta referência circular sem lançar exceção', () => {
    const t: Record<string, unknown> = { id: 't', type: 'translate', offset: [0, 0, 0] };
    t.child = t;
    expect(() => validateIR({ ...cubeDoc(), root: t })).not.toThrow();
    expect(issuesOf({ ...cubeDoc(), root: t })).toContainEqual(
      expect.objectContaining({ code: 'ciclo' }),
    );
  });
});
