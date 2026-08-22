export type OutcomeStatus = 'ACCEPT' | 'REJECT' | 'INCONCLUSIVE' | 'INVALID';

export type GuardrailResult = 'pass' | 'fail' | 'skipped';

export interface GuardrailsSummary {
  visual: GuardrailResult;
  dom: GuardrailResult;
  accessibility: GuardrailResult;
  bundleBytes: GuardrailResult;
  holdout: GuardrailResult;
  postCompletion: GuardrailResult;
}

export interface MetricObjectiveResult {
  name: string;
  direction: 'lower-is-better' | 'higher-is-better';
  baselineMedianMs: number;
  candidateMedianMs: number;
  relativeChange: number;
  confidenceInterval: [number, number];
}

export interface CalibrationSummary {
  estimatedDetectableEffect: number;
  aaPassed: boolean;
  blockCount: number;
  trialsPerBlock: number;
  sampleTimeSeconds: number;
}

export interface ExperimentOutcome {
  status: OutcomeStatus;
  reason?: string;
  objective: MetricObjectiveResult;
  calibration: CalibrationSummary;
  guardrails: GuardrailsSummary;
  campaignId: string;
  baselineRevision: string;
  candidateRevision: string;
  timestamp: string;
}

export interface BrowserPolicy {
  windowWidth: number;
  windowHeight: number;
  deviceScaleFactor: number;
  locale: string;
  timezone: string;
  colorScheme: 'light' | 'dark';
  headless: boolean;
  enableGpu: boolean;
  cpuThrottlingRate: number;
  disableBackgroundNetworking: boolean;
}

export interface DefaultBrowserPolicy extends BrowserPolicy {
  windowWidth: 1280;
  windowHeight: 800;
  deviceScaleFactor: 1;
  locale: 'en-US';
  timezone: 'UTC';
  colorScheme: 'light';
  headless: true;
  enableGpu: true;
  cpuThrottlingRate: 1;
  disableBackgroundNetworking: true;
}

export type InputAction =
  | { type: 'focus'; selector: string }
  | { type: 'type'; text: string }
  | { type: 'click'; selector: string }
  | { type: 'scroll'; selector: string; deltaY: number }
  | { type: 'wait'; durationMs: number };

export interface StimulusToken {
  timestampUs: number;
  action: InputAction;
}

export interface ContextDriver {
  navigate(url: string): Promise<void>;
  waitForFonts(): Promise<void>;
  waitForSemanticState(stateName: string): Promise<void>;
  focus(selector: string): Promise<void>;
  typeTrusted(text: string): Promise<void>;
  clickTrusted(selector: string): Promise<void>;
  scrollTrusted(selector: string, deltaY: number): Promise<void>;
  getDOMSnapshot(): Promise<SerializedDOMNode>;
  getAccessibilityTree(): Promise<SerializedA11yNode>;
  takeScreenshotBuffer(): Promise<Buffer>;
}

export interface SerializedDOMNode {
  tagName: string;
  id?: string;
  className?: string;
  attributes: Record<string, string>;
  textContent?: string;
  children: SerializedDOMNode[];
}

export interface SerializedA11yNode {
  role: string;
  name?: string;
  value?: string;
  children: SerializedA11yNode[];
}

export interface SemanticCompletionPredicate {
  selector: string;
  expectedText?: string;
  minChildCount?: number;
}

export interface CorrectnessCheck {
  type: 'visual' | 'dom' | 'a11y' | 'assertion';
  name: string;
  selector?: string;
}

export interface ScenarioDefinition {
  name: string;
  prepare(ctx: ContextDriver): Promise<void>;
  stimulate(ctx: ContextDriver): Promise<void>;
  completion: SemanticCompletionPredicate;
  correctness: CorrectnessCheck[];
}

export interface MetricDefinition {
  name: string;
  direction: 'lower-is-better' | 'higher-is-better';
  tracePreset: 'interaction-minimal' | 'full';
}

export interface ExperimentManifest {
  name: string;
  build: {
    command: string;
    outputDir: string;
  };
  scenario: ScenarioDefinition;
  metric: MetricDefinition;
  holdoutGenerator?: (seed: number) => ScenarioDefinition;
  practicalThreshold: number;
  significanceAlpha: number;
}

export type TrialVariant = 'A' | 'B';

export interface RawTrialObservation {
  trialIndex: number;
  variant: TrialVariant;
  blockIndex: number;
  stimulusStartUs: number;
  completionUs: number;
  durationMs: number;
  valid: boolean;
  invalidationReason?: string;
  bytesTransferred: number;
  requestCount: number;
  mainThreadCpuTimeMs: number;
  longTaskCount: number;
  postCompletionActivityMs: number;
}

export interface CampaignLedgerEntry {
  entryId: string;
  timestamp: string;
  baselineHash: string;
  candidateHash: string;
  manifestHash: string;
  hiddenSeed: number;
  blockOrder: TrialVariant[][];
  trials: RawTrialObservation[];
  calibration: CalibrationSummary;
  outcome: OutcomeStatus;
  reason?: string;
}

export interface CampaignLedgerData {
  campaignId: string;
  createdAt: string;
  acceptedChampionHash: string | null;
  entries: CampaignLedgerEntry[];
}
