# ADR-001: Stack e resultados do spike (M0)

- **Status:** aceito
- **Data:** 2026-11-16
- **Contexto:** o plano v1.1 dependia de APIs que não tinham sido verificadas. O M0 existe para fixar versões e provar o caminho crítico antes de codar.

## Decisão

### Versões fixadas (consultadas no npm em 2026-11-16)

| Pacote                              | Versão           | Observação                         |
| ----------------------------------- | ---------------- | ---------------------------------- |
| `react` / `react-dom`               | 19.3.1           |                                    |
| `vite`                              | 8.3.8            | `@vitejs/plugin-react` 6.3.0       |
| `typescript`                        | **~6.0.3**       | ver "Achados" (não usar 7.x ainda) |
| `three`                             | 0.187.0          | `@types/three` 0.187.0             |
| `@react-three/fiber` / `drei`       | 9.8.2 / 10.7.9   |                                    |
| `manifold-3d`                       | 3.5.5            | WASM                               |
| `zod`                               | 4.6.7            | `z.toJSONSchema` nativo            |
| `zustand` / `immer`                 | 5.1.0 / 11.2.10  |                                    |
| `tailwindcss` + `@tailwindcss/vite` | 4.3.5            |                                    |
| `vitest` + `@vitest/coverage-v8`    | 5.1.0            |                                    |
| `@playwright/test`                  | 1.65.1           | Chromium 159                       |
| `eslint` / `typescript-eslint`      | 10.15.0 / 8.72.2 |                                    |

Adiados para quando forem usados: `@google/genai` (3.3.0), `wrangler` (4.162.0), `@testing-library/react` (16.3.3), shadcn/ui.

### Achados do spike

1. **TypeScript 7.0.2 é incompatível com `typescript-eslint`** (peer `typescript <6.1.0`). Fixamos `~6.0.3`. Reavaliar quando o `typescript-eslint` suportar a 7.x.
2. **`zod-to-json-schema` não é necessário:** o Zod 4 gera JSON Schema com `z.toJSONSchema`. Pacote removido do plano.
3. **`manifold-3d` funciona em Node e em Web Worker sob Vite 8.** O WASM é carregado com `Module({ locateFile: () => wasmUrl })`, onde `wasmUrl` vem de `import wasmUrl from 'manifold-3d/manifold.wasm?url'`. Transferência zero-copy dos buffers confirmada. Medido em Chromium headless: inicialização 52 ms, avaliação de cubo menos cilindro (128 segmentos) 52 ms; em Node, 17,6 ms por avaliação. Código em `spike/`.
4. **`getMesh()` devolve `numProp = 3`** (só posições, sem normais). O kernel precisa calcular as normais (ou o viewer usar `computeVertexNormals`). `MeshData.normals` continua no contrato; quem o preenche é o kernel.
5. **Fechamento da malha:** com normais planas os vértices se duplicam por face. A checagem "toda aresta tem 2 triângulos" deve **soldar vértices por posição** (fixtures e kernel).
6. **A tolerância de volume de ±0,5% depende do número de segmentos.** Medido contra a fórmula analítica: cilindro com 128 segmentos, erro de 0,003%; torus (48/96 segmentos), 0,35%; esfera de 64 segmentos, **0,57%**. Regra para os testes do kernel: comparar com o volume do poliedro discretizado, ou usar >= 128 segmentos, ou tolerância de 1% para curvas com menos segmentos. O critério de aceite da F2 passa a valer nesses termos.
7. API do manifold necessária ao IR confirmada: `cube`, `cylinder` (cone com raio superior 0), `sphere`, `extrude` (polígono), `revolve` (torus a partir de `CrossSection.circle`), `translate`, `rotate`, `scale`, `mirror`, `union`, `intersection`, `subtract`, `volume`, `boundingBox`, `genus`, `compose`.

### Gemini (não verificado de ponta a ponta)

- Não há chave de API disponível, então **nenhuma chamada real foi feita**. O que se sabe vem da documentação: o SDK `@google/genai` aceita `responseMimeType: 'application/json'` e `responseJsonSchema` com JSON Schema (incluindo `$ref`/`$defs`).
- **O nome do modelo não foi confirmado.** `GEMINI_MODEL` é variável de ambiente; o padrão será escolhido no M4 listando os modelos disponíveis para a chave (`models.list`).
- **Risco R-1:** o schema do IR é recursivo (`$ref`). Se o Gemini limitar a recursão, usar uma versão achatada com profundidade fixa. Verificar no primeiro dia do M4.

### Ambiente

- Cache do npm em `D:\.npm-cache` e navegadores do Playwright em `D:\.playwright` (`PLAYWRIGHT_BROWSERS_PATH`), para poupar o `C:`.
- Commits com o e-mail `noreply` do GitHub (repositório público).

## Consequências

- O M2 pode começar sem surpresas de bundling do WASM.
- Dois itens seguem **sem teste**: 60 fps com 100k triângulos na MX110 (medir no M2) e a taxa de 8 em 10 prompts gerando IR válido (medir no M4).
