# ADR-002: IR CSG como contrato único, congelado no M1

- **Status:** aceito
- **Data:** 2026-11-16

## Contexto

Quatro equipes vão trabalhar em paralelo (kernel, viewer, IA, exportação). Sem um contrato único, cada uma redefine a geometria à sua maneira e os módulos deixam de encaixar.

## Decisão

1. **A IA e os presets produzem o mesmo IR**: uma árvore CSG em JSON (`IRDocument`), com `schemaVersion: 1`, `units: "mm"` e eixo Z para cima. Todo o restante (malha, `.scad`, `.stl`) deriva do IR de forma determinística.
2. **Fonte única:** `src/core/ir/schema.ts` (Zod) validado contra `src/core/ir/types.ts` em tempo de compilação. O JSON Schema para o Gemini sai de `irJsonSchema()`.
3. **Entrada não confiável:** tudo que vem da IA, do histórico ou do usuário passa por `validateIR` antes de virar geometria. O validador faz primeiro uma passada estrutural (nós, profundidade, ciclos, ids) e só então roda o Zod, de modo que entrada hostil não estoura a pilha.
4. **Guardrails** (em `src/core/ir/limits.ts`): <= 200 nós, profundidade <= 12, dimensões 0,1–1000 mm, deslocamentos ±1000 mm, ângulos ±360°, escala 0,01–100, `segments` 3–128, polígono 3–256 vértices, ids únicos. Objetos são estritos (campos desconhecidos são rejeitados).
5. **Erros esperados são valores, não exceções:** `Result<T, E>`; `IRIssue` com `path`, `code` e `message` em PT-BR.

### Nós

`cube`, `cylinder`, `sphere`, `cone`, `torus`, `extrude`, `translate`, `rotate`, `scale`, `mirror`, `union`, `intersection`, `difference` (esta com `base` + `subtract[]`, para a IA não depender de ordem de filhos).

### Congelamento

A partir do M1, ficam **congelados**: `src/core/contracts.ts`, `src/core/ir/types.ts` e `src/core/ir/schema.ts`. Para mudar, é preciso (a) aprovação do coordenador, (b) um novo ADR, (c) incremento de `schemaVersion` se a mudança quebrar IRs existentes. Mudanças só aditivas (novo nó opcional) exigem apenas (a) e (b).

## Consequências

- As equipes trabalham contra as mesmas fixtures (`tests/fixtures/ir.ts`, `tests/fixtures/mesh.ts`).
- O tutorial da v2 poderá referenciar nós por `id` sem alterar o IR.
- Alinhamentos entre equipes na v1: `RotateNode` segue ordem Euler XYZ (`X`, `Y`, `Z`), compatível com OpenSCAD e `manifold-3d`; `MeshData` não carrega cor por face/vértice (o viewer v1 usa material único e o emissor `.scad` preserva `color`); booleanos que resultarem em sólido vazio devem retornar `KernelError` com `code: 'invalid_mesh'`.
- Preço: limites rígidos podem recusar modelos legítimos grandes; ajustar `limits.ts` por ADR se isso aparecer.
