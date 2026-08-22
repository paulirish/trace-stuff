import type {
  ExperimentManifest,
  ScenarioDefinition,
  ContextDriver,
} from '../types.ts';

export const publicGridScenario: ScenarioDefinition = {
  name: 'grid-filter-public',

  async prepare(ctx: ContextDriver): Promise<void> {
    await ctx.navigate('/');
    await ctx.waitForFonts();
    await ctx.waitForSemanticState('grid-ready');
  },

  async stimulate(ctx: ContextDriver): Promise<void> {
    await ctx.focus('[data-testid="grid-filter"]');
    await ctx.typeTrusted('performance');
  },

  completion: {
    selector: '[data-testid="visible-row-count"]',
    expectedText: '137 results',
  },

  correctness: [
    { type: 'visual', name: 'filtered-grid-visual' },
    { type: 'dom', name: 'filtered-grid-dom' },
    { type: 'a11y', name: 'filtered-grid-a11y' },
  ],
};

export function createGridHoldoutGenerator(seed: number): (s: number) => ScenarioDefinition {
  return (s: number) => {
    const queries = ['standard', 'data', 'item 1', 'optimization', 'payload'];
    const selectedQuery = queries[(seed + s) % queries.length];

    return {
      name: `grid-filter-holdout-seed-${s}`,

      async prepare(ctx: ContextDriver): Promise<void> {
        await ctx.navigate('/');
        await ctx.waitForFonts();
        await ctx.waitForSemanticState('grid-ready');
      },

      async stimulate(ctx: ContextDriver): Promise<void> {
        await ctx.focus('[data-testid="grid-filter"]');
        await ctx.typeTrusted(selectedQuery);
      },

      completion: {
        selector: '[data-testid="visible-row-count"]',
      },

      correctness: [
        { type: 'dom', name: 'holdout-grid-dom' },
      ],
    };
  };
}

export const gridExperimentManifest: ExperimentManifest = {
  name: 'grid-filter-2026',
  build: {
    command: '',
    outputDir: '.',
  },
  scenario: publicGridScenario,
  metric: {
    name: 'input-to-correct-frame',
    direction: 'lower-is-better',
    tracePreset: 'interaction-minimal',
  },
  holdoutGenerator: createGridHoldoutGenerator(42),
  practicalThreshold: 0.02,
  significanceAlpha: 0.05,
};
