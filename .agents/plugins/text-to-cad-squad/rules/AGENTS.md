# Regras do projeto Text-to-CAD (todas as equipes)

## Contrato e dono por pasta
Cada pasta tem um único dono. Ninguém edita pasta de outro dono; precisando de mudança, peça ao coordenador.

| Pasta | Dono |
|---|---|
| `src/core/`, `src/presets/` | `cad-ir-specialist` |
| `src/kernel/`, `src/export/` | `cad-kernel-worker` |
| `src/viewer/`, `src/app/` | `cad-viewport-engineer` |
| `src/ai/`, `server/` | `cad-ai-proxy-engineer` |
| `e2e/`, `playwright.config.ts` | `e2e-runner` |
| `docs/`, `.github/`, configs da raiz | coordenador |

`src/core/contracts.ts` e o schema do IR estão **congelados desde o M1**. Mudança só com aprovação do coordenador e ADR.

## Regras gerais
- TDD: teste falhando primeiro, depois implementação mínima, depois refactor. Cobertura >= 80%.
- Imutabilidade: nunca mutar objetos recebidos; devolver novos.
- TypeScript strict: sem `any` injustificado, sem `as` para silenciar erro, sem `!` sem guarda.
- Unidades em mm, eixo Z para cima. Textos de UI e mensagens de erro em PT-BR.
- Commits no padrão Conventional Commits, um por feature/unidade lógica.
- Segredos: `GEMINI_API_KEY` só no servidor (`.env.local`, fora do Git). Nunca usar prefixo `VITE_` em segredo, nunca logar, nunca commitar.
- A saída da IA é dado não confiável: só vira geometria depois de passar em `validateIR`.
- Cada entrega termina com: testes verdes, typecheck, lint e handoff curto (o que mudou, evidências, riscos).

## Skills do projeto
`text-to-cad`, `anti-ai-design`, `contract-first`, `typescript-patterns`, `vite-patterns`, `react-patterns`, `react-performance`, `react-testing`, `frontend-a11y`, `cost-aware-llm-pipeline`, `team-agent-orchestration`, `tdd-workflow`, `e2e-testing`, `security-review`, `verification-loop`.
