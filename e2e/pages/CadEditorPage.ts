import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';

export type RenderMode = 'wireframe' | 'clay' | 'xray' | 'solid';
export type MobileTabId = 'create' | 'view' | 'inspect';

/**
 * Page Object do Editor CAD principal (v1: IA Gemini, Presets, Histórico, Undo/Redo, Viewport 3D e Exportação).
 */
export class CadEditorPage {
  readonly page: Page;
  readonly appTitle: Locator;
  readonly appStatus: Locator;
  readonly undoBtn: Locator;
  readonly redoBtn: Locator;
  readonly viewportMetrics: Locator;
  readonly canvas: Locator;
  readonly dimLabelX: Locator;
  readonly inspectorCode: Locator;
  readonly tabScad: Locator;
  readonly tabIr: Locator;
  readonly exportStlBtn: Locator;
  readonly navLab: Locator;
  readonly labPage: Locator;
  readonly aiPromptInput: Locator;
  readonly aiGenerateBtn: Locator;
  readonly aiByokToggle: Locator;
  readonly aiByokInput: Locator;
  readonly aiFeedback: Locator;
  readonly historyItems: Locator;
  readonly historyClearBtn: Locator;
  readonly historyEmpty: Locator;
  readonly mobileTabCreate: Locator;
  readonly mobileTabView: Locator;
  readonly mobileTabInspect: Locator;

  constructor(page: Page) {
    this.page = page;
    this.appTitle = page.getByTestId('app-title');
    this.appStatus = page.getByTestId('app-status');
    this.undoBtn = page.getByTestId('undo-btn');
    this.redoBtn = page.getByTestId('redo-btn');
    this.viewportMetrics = page.getByTestId('viewport-metrics');
    this.canvas = page.locator('canvas');
    this.dimLabelX = page.getByTestId('dim-label-x');
    this.inspectorCode = page.getByTestId('inspector-code');
    this.tabScad = page.getByTestId('tab-scad');
    this.tabIr = page.getByTestId('tab-ir');
    this.exportStlBtn = page.getByTestId('export-stl');
    this.navLab = page.getByTestId('nav-lab');
    this.labPage = page.getByTestId('lab-page');
    this.aiPromptInput = page.getByTestId('ai-prompt-input');
    this.aiGenerateBtn = page.getByTestId('ai-generate-btn');
    this.aiByokToggle = page.getByTestId('ai-byok-toggle');
    this.aiByokInput = page.getByTestId('ai-byok-input');
    this.aiFeedback = page.getByTestId('ai-feedback');
    this.historyItems = page.getByTestId('history-item');
    this.historyClearBtn = page.getByTestId('history-clear');
    this.historyEmpty = page.getByTestId('history-empty');
    this.mobileTabCreate = page.getByTestId('mobile-tab-create');
    this.mobileTabView = page.getByTestId('mobile-tab-view');
    this.mobileTabInspect = page.getByTestId('mobile-tab-inspect');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.appTitle).toBeVisible({ timeout: 20_000 });
  }

  historyItemButton(index: number): Locator {
    return this.page.getByTestId(`history-item-${index}`);
  }

  async selectPreset(presetId: string): Promise<void> {
    await this.page.getByTestId(`preset-${presetId}`).click();
  }

  async setSliderParam(paramName: string, value: string): Promise<void> {
    const slider = this.page.getByTestId(`param-slider-${paramName}`);
    await slider.fill(value);
    await slider.dispatchEvent('change');
  }

  async setRenderMode(mode: RenderMode): Promise<void> {
    const btn = this.page.getByTestId(`render-mode-${mode}`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }

  async setByokKey(apiKey: string): Promise<void> {
    const expanded = await this.aiByokToggle.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await this.aiByokToggle.click();
    }
    await expect(this.aiByokInput).toBeVisible();
    await this.aiByokInput.fill(apiKey);
  }

  async submitAiPrompt(prompt: string): Promise<void> {
    await this.aiPromptInput.fill(prompt);
    await this.aiGenerateBtn.click();
  }

  async selectMobileTab(tab: MobileTabId): Promise<void> {
    const tabBtn = this.page.getByTestId(`mobile-tab-${tab}`);
    await tabBtn.click();
    await expect(tabBtn).toHaveAttribute('aria-selected', 'true');
  }

  async exportStlAndAssertBinary(expectedFilename: string): Promise<void> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.exportStlBtn.click(),
    ]);
    expect(download.suggestedFilename()).toBe(expectedFilename);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    if (!filePath) {
      throw new Error('Caminho do arquivo STL baixado não encontrado.');
    }
    const buf = readFileSync(filePath);
    expect(buf.byteLength).toBeGreaterThan(84);
    const triCount = buf.readUInt32LE(80);
    expect(triCount).toBeGreaterThan(50);
    expect(buf.byteLength).toBe(84 + triCount * 50);
  }
}
