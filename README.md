# Text-to-CAD

Descreva uma peça em português e veja o modelo 3D paramétrico no navegador, com visualização interativa e exportação pronta para impressão 3D.

[![Tests](https://img.shields.io/badge/Tests-201_passed-10b981.svg?style=for-the-badge)](tests/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

> **Status:** **v1 concluída (M0–M5)**. Inclui geração por IA via Gemini com proxy seguro `/api/gemini` e loop de reparo, 4 presets paramétricos com ajuste em tempo real, kernel CSG `manifold-3d` em Web Worker, viewport React Three Fiber (Z-up, 4 modos, grid/cotas), emissor OpenSCAD, exportação binária `.stl`/`.scad`/`.json`, histórico persistente de 20 modelos, Desfazer/Refazer (`Ctrl+Z`/`Ctrl+Shift+Z`), layout responsivo desktop/mobile e rota `/lab`.

## Como funciona

```
prompt ──► IA (Gemini /api/gemini) ─┐
                                    ├─► IR (árvore CSG em JSON, Zod) ─┬─► kernel manifold-3d (Worker) ─► viewport 3D ─► .stl
presets paramétricos ───────────────┘                                 └─► emissor OpenSCAD ────────────► .scad / .json
```

A IA **não** gera malha nem código OpenSCAD direto: ela gera o **IR (Intermediate Representation)** validado por `validateIR` com guardrails rígidos antes de virar geometria. Veja [`docs/architecture/visao-geral.md`](docs/architecture/visao-geral.md), [`ADR-001`](docs/adr/ADR-001-stack.md) e [`ADR-002`](docs/adr/ADR-002-ir-contrato.md).

## Funcionalidades da v1

- **Prompt IA em PT-BR (`src/ai/`, `server/`):** Structured Outputs no Gemini com adaptação para `$ref` recursivo, proteção anti-prompt-injection, rate limit (`1` por vez, `10/min`), timeout de `30 s`, loop automático de reparo (até `2` reenvios com os `IRIssue[]`) e opção **BYOK** isolada em `sessionStorage`.
- **4 Presets Paramétricos (`src/presets/`):** _Suporte em L_, _Flange com Furação_, _Caixa com Divisórias_ e _Bucha / Espaçador_, com sliders instantâneos e invariants protegidos (`clampParams`).
- **Viewport 3D & Rota `/lab` (`src/viewer/`, `src/app/`):** eixo Z para cima, 4 modos (_Sólido_, _Wireframe_, _Argila_, _Raio-X_), grid milimétrico, cotas X/Y/Z, volume em cm³, contagem de triângulos e inspeção lado a lado em `/lab`.
- **Exportação (`src/export/`):** `.stl` binário verificado (header 80 bytes + `50` bytes/triângulo), código `.scad` determinístico e `.json` do IR.
- **Produtividade & A11y (`src/app/`, `src/i18n/`):** store imutável (`zustand` + `immer`), Desfazer/Refazer (`Ctrl+Z` / `Ctrl+Shift+Z`), histórico de até `20` modelos no `localStorage` (sem chaves), abas mobile WAI-ARIA, skip link e dicionário centralizado em `src/i18n/pt-BR.ts`.

## Rodando localmente

Requer **Node 22+**.

```bash
npm install
npm run dev          # http://localhost:5173 (editor) e http://localhost:5173/lab
npm test             # testes unitários (Vitest)
npm run coverage     # cobertura mínima de 80% (inclui core, kernel, export, presets, ai, server, app, i18n)
npm run e2e          # Playwright end-to-end (instale antes: npx playwright install chromium)
npm run lint && npm run typecheck && npm run build
```

## Chave do Gemini & Avaliação IA

A chave **nunca** entra no repositório nem no bundle do navegador:

1. **Via `.env.local` (dev):** copie `.env.example` para `.env.local` (ignorado pelo Git) e preencha `GEMINI_API_KEY`. Nunca use prefixo `VITE_` para segredos.
2. **Via interface (BYOK):** abra _Chave própria (BYOK)_ no painel esquerdo; a chave fica restrita ao `sessionStorage` da aba e vai apenas no header `x-user-key` para `/api/gemini`.
3. **Eval manual dos 10 prompts de referência:** com `GEMINI_API_KEY` preenchida em `.env.local`, rode:

```bash
npm run eval:ai
```

Um hook de pré-commit (`.githooks/`) e o CI (`check:secrets`, varredura em `dist/` e `gitleaks`) bloqueiam qualquer commit ou bundle com segredos.

## Deploy (Cloudflare Pages + Worker)

- **Frontend:** gere `dist/` com `npm run build` e publique no Cloudflare Pages.
- **Proxy `/api/gemini`:** definido em [`server/worker.ts`](server/worker.ts) e [`wrangler.toml`](wrangler.toml) com CORS _fail-closed_ por padrão se `ALLOWED_ORIGINS` não estiver definido:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ALLOWED_ORIGINS
npx wrangler deploy
```

## Estrutura

```
src/core/      IR, schema Zod, validação, contratos e emissor OpenSCAD (congelado desde M1)
src/kernel/    avaliação CSG com manifold-3d em Web Worker
src/viewer/    viewport React Three Fiber (Z-up, 4 modos, cotas)
src/presets/   4 modelos paramétricos prontos + clamp de invariantes
src/export/    exportação binária .stl, .scad e .json
src/ai/        cliente Gemini, schema adaptado, prompts, rate limit e BYOK (sessionStorage)
server/        proxy seguro /api/gemini (middleware dev no Vite + Cloudflare Worker)
src/app/       shell React, store Zustand/Immer, histórico (localStorage) e rota /lab
src/i18n/      dicionário PT-BR da interface
docs/          ADRs (M0–M1) e visão geral da arquitetura
.agents/       equipes e regras dos subagentes do projeto
```

## Licença

MIT
