# Text-to-CAD

Descreva uma peça em português e veja o modelo 3D paramétrico no navegador, com exportação para impressão 3D.

[![Tests](https://img.shields.io/badge/Tests-101_passed-10b981.svg?style=for-the-badge)](tests/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

> **Status:** v1 em construção (M0–M2 concluídos). Já funcionam o contrato central (IR Zod + validação), o emissor OpenSCAD, o kernel CSG `manifold-3d` em Web Worker e o viewport 3D (React Three Fiber, Z-up, 4 modos de renderização, cotas e fit-to-view). Presets, exportação STL e integração com Gemini chegam nos próximos marcos. Plano e decisões em [`docs/`](docs/).

## Como funciona

```
prompt ──► IA (Gemini)  ─┐
                         ├─► IR (árvore CSG em JSON, validada por Zod) ─┬─► kernel manifold-3d (Web Worker) ─► viewport 3D ─► .stl
presets paramétricos  ───┘                                              └─► emissor OpenSCAD ─► .scad
```

A IA **não** gera malha nem código OpenSCAD direto: ela gera o IR, que passa por `validateIR` antes de virar geometria. Veja [ADR-002](docs/adr/ADR-002-ir-contrato.md).

## Rodando

Requer Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes unitários (Vitest)
npm run coverage   # com cobertura mínima de 80%
npm run e2e        # Playwright (instale antes: npx playwright install chromium)
npm run lint && npm run typecheck && npm run build
```

## Chave do Gemini (a partir do M4)

A chave **nunca** vai ao repositório nem ao navegador. Copie `.env.example` para `.env.local` (ignorado pelo Git) e preencha `GEMINI_API_KEY`. O navegador chama `/api/gemini`, e só o servidor lê a chave. Nunca use o prefixo `VITE_` em segredos. Um hook de pré-commit (`.githooks/`) e o CI barram commits com chaves.

## Estrutura

```
src/core/      IR, schema, validação, contratos        (congelado desde o M1)
src/kernel/    avaliação CSG com manifold-3d em Worker (M2, pronto)
src/viewer/    viewport React Three Fiber              (M2, pronto)
src/presets/   modelos paramétricos prontos            (M3)
src/export/    STL, SCAD, JSON                         (M3)
src/ai/        cliente Gemini e loop de reparo         (M4)
server/        proxy /api/gemini                       (M4)
src/app/       shell da interface, estado, i18n        (M5)
docs/adr/      decisões de arquitetura
.agents/       equipes de agentes do projeto
spike/         verificações do M0 (descartáveis)
```

## Licença

MIT
