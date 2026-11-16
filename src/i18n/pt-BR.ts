/**
 * Dicionário centralizado de textos da interface em Português (PT-BR).
 * Preparado para futura expansão multilíngue (seção 0 do plano v1.1).
 */
export const PT_BR = {
  app: {
    title: 'Text-to-CAD',
    statusBadge: 'v1 · IA, CSG & STL',
    subtitle: 'Prompt IA (Gemini) & Presets → manifold-3d (Worker) → Viewport 3D & Exportação',
    skipToMain: 'Ir para o editor 3D',
  },
  nav: {
    mainAriaLabel: 'Navegação principal',
    editor: 'Editor',
    lab: 'Lab (/lab)',
    undo: 'Desfazer',
    redo: 'Refazer',
    undoShortcutLabel: 'Desfazer alteração no modelo (Ctrl+Z)',
    redoShortcutLabel: 'Refazer alteração no modelo (Ctrl+Shift+Z)',
  },
  mobileTabs: {
    ariaLabel: 'Alternar painéis no celular',
    create: 'Criar & Presets',
    view: 'Visualizar 3D',
    inspect: 'Código & STL',
  },
  ai: {
    sectionTitle: 'Prompt IA (Gemini)',
    shortcutHint: 'Ctrl+Enter',
    placeholder: 'Descreva a peça em mm (ex.: suporte em L 80x40 mm com 2 furos)',
    generate: 'Gerar modelo',
    cancel: 'Cancelar',
    byokToggle: 'Chave própria (BYOK)',
    byokActive: 'ativa',
    byokLabel: 'Chave API Gemini',
    byokClear: 'Limpar',
    byokClearAria: 'Limpar chave API Gemini',
    byokPrivacyNote:
      'Guardada apenas nesta aba (sessionStorage); nunca gravada em disco nem enviada em logs.',
    loadingMessage: 'Gerando e validando geometria via Gemini...',
    successMessage: 'Modelo gerado pela IA e validado.',
    cancelledMessage: 'Geração cancelada.',
    errorTip: 'Simplifique o prompt ou escolha um preset abaixo.',
  },
  presets: {
    sectionTitle: 'Modelos Paramétricos',
    paramsTitle: 'Parâmetros',
    resetDefault: 'Padrão',
    resetDefaultAria: 'Restaurar parâmetros padrão',
    aiActiveHint:
      'Modelo gerado pela IA em exibição. Selecione um preset acima ou no histórico para voltar aos sliders.',
  },
  history: {
    title: 'Histórico recente',
    clear: 'Limpar',
    clearAria: 'Limpar histórico local de modelos',
    empty: 'Nenhum modelo salvo ainda. Gere via IA ou altere um preset para registrar.',
    badgeAi: 'IA',
    badgePreset: 'Preset',
    restorePrefix: 'Restaurar modelo',
  },
  inspector: {
    exportTitle: 'Exportar Modelo',
    downloadStl: 'Baixar .STL',
    downloadStlAria: 'Baixar modelo em formato STL binário',
    copy: 'Copiar',
    copied: 'Copiado',
    tabsAriaLabel: 'Formato de inspeção',
    tabScad: 'OpenSCAD (.scad)',
    tabIr: 'IR (JSON)',
  },
} as const;

export type PtBrDictionary = typeof PT_BR;
