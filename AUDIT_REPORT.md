# Architectural & Product Audit Report: `perf-experiment` Evaluator Harness

**Auditor:** Principal Performance Engineer & Systems Architect
**Target Package:** `perf-experiment` (v0.1.0)
**Date:** March 2026

---

## Executive Summary

`perf-experiment` is designed as an automated, statistically sound, anti-reward-hacking web performance evaluator. Its core vision is to act as a frozen, deterministic, objective "judge" comparing two immutable application revisions (Baseline $A$ vs. Candidate $B$) on a single machine.

### Key Audit Findings
1. **Strong Architectural Foundations:** The package excels in its separation of concerns (acting purely as an objective judge without agent orchestration creep), its browser noise-suppression configuration, its interleaved symmetric block design (`ABBA`/`BAAB`), and its append-only campaign ledger architecture.
2. **Critical Trace & Metric Extraction Gap:** Despite claiming trace-based evaluation and listing `@paulirish/trace_engine` in `package.json`, trace collection is **never enabled during actual experiment runs** in `runner.ts`, and `@paulirish/trace_engine` is completely unused. Evaluation relies 100% on raw JS wall-clock time (`performance.timeOrigin + performance.now()`), leaving the engine highly sensitive to OS clock jitter and predicate-gaming cheats.
3. **Guardrail Vulnerabilities & Blind Spots:**
   - The DOM snapshot comparison truncates serialization at `maxChild = 50`, allowing an agent to delete or corrupt DOM elements beyond index 50 without failing DOM guardrails.
   - The post-completion deferred work guardrail is effectively disabled during live runs because `postCompletionActivityMs` is hardcoded to `0` (due to missing trace integration).
   - `DeterministicOriginProxy` does not enforce HAR network replay or record/replay mode for external resources during evaluation runs in `runner.ts`.
4. **Statistical Parameter Degeneracy:** The default comparison parameters execute only $1$ block ($4$ trials total), causing $N=1$ block delta calculations where standard deviation and confidence interval math degenerate.

Overall, `perf-experiment` has a strong conceptual design and clean statistical pillars, but requires key architectural refactors in trace-based work extraction, guardrail depth, and network replay enforcement before it can be safely used in an autonomous agent optimization loop.

---

## Detailed Dimension Review

### 1. Scope & Separation of Concerns (The Unix Evaluator Model)

* **Observed Implementation:**
  - **CLI & Public API:** The CLI (`src/cli/index.ts`) exposes a pure Unix-style command `perf-experiment compare --baseline <rev> --candidate <rev> [--campaign <id>] [--experiment <path>] [--out <file>]`. Programmatically, `runCompare` (`src/runner.ts`) serves as the evaluation entry point.
  - **Pure Judge Role:** The evaluator strictly limits itself to building variants, running trials, verifying correctness, computing statistics, and producing a structured `ExperimentOutcome` JSON result (`ACCEPT`, `REJECT`, `INCONCLUSIVE`, `INVALID`). It contains zero agent orchestration logic (no LLM prompts, file edits, git loop management, or optimization state).
  - **Variant Materialization:** `VariantMaterializer` (`src/materializer.ts`) materializes baseline and candidate revisions into isolated temporary worktrees (`.tmp-worktrees/`), executes build commands, computes lockfile/directory SHA-256 hashes, and tears down worktrees upon completion.

* **Alignment vs. Gap Analysis:**
  - **Alignment:** **Exceeds Expectations.** Outstanding adherence to the Unix evaluator principle. The interface is completely decoupled from how code changes are generated, making it cleanly consumable by any external agent or CI harness.
  - **Gap:** `VariantMaterializer` executes arbitrary build commands (`manifest.build.command`) directly via process execution (`execFileAsync`) within the main process environment without containerized or sandbox isolation.

* **Risks & Blind Spots:**
  - **Untrusted Build Execution:** Running candidate build commands directly on the host machine without sandboxing risks arbitrary code execution or environment contamination if an untrusted agent generates malicious build scripts.

---

### 2. Network & Environmental Determinism

* **Observed Implementation:**
  - **Origin Proxy:** `DeterministicOriginProxy` (`src/proxy.ts`) spins up an isolated local HTTP server (`http://127.0.0.1:<port>/`) to serve static assets from materialized baseline and candidate directories.
  - **Network Replay Engine:** `NetworkRecordReplayer` (`src/replay.ts`) implements HAR-style request/response recording and replaying with base64 body encoding.
  - **Browser Launch Noise Suppression:** `BrowserDriver` (`src/browser.ts`) applies comprehensive Chrome flags: `--disable-background-networking`, `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-breakpad`, `--disable-component-update`, `--disable-extensions`, `--disable-domain-reliability`, `--disable-sync`, `--force-color-profile=srgb`, `--metrics-recording-only`, and CDP timezone overrides.
  - **Virtual Time Control:** `BrowserDriver` exposes CDP `Emulation.setVirtualTimePolicy` methods (`enableVirtualTime`, `disableVirtualTime`).

* **Alignment vs. Gap Analysis:**
  - **Alignment:** Browser launch configuration and noise suppression flags are top-tier and eliminate background Chrome tasks, sync, component updates, and renderer backgrounding.
  - **Gaps:**
    1. **Unenforced Network Replay:** `NetworkRecordReplayer` is implemented as an isolated class, but `runner.ts` never puts the proxy into `replay` mode or attaches HAR archives during `runCompare`. External network requests during evaluation runs return 404 or pass through, creating potential live network exposure.
    2. **Unused Virtual Time Setup:** Although `BrowserDriver` implements virtual time controls, `runner.ts` **never invokes `enableVirtualTime()` or `disableVirtualTime()`** during fixture navigation, font loading, or animation settling prior to stimulus dispatch.

* **Risks & Blind Spots:**
  - **Live Network Jitter:** If target applications fetch third-party fonts, scripts, or APIs, un-proxied network traffic will introduce network latency jitter into trial durations.
  - **Setup Phase Variance:** Lack of virtual time during fixture setup and settling means wall-clock host load can alter initial DOM or timer state before stimulus execution begins.

---

### 3. Metric Design & Trace Extraction

* **Observed Implementation:**
  - **Wall-Clock Dependency:** `runner.ts` measures candidate performance strictly using wall-clock timestamps obtained via JS `performance.timeOrigin + performance.now()` inside `driver.getMonotonicTimeUs()` and `driver.waitForCompletion()`.
  - **Unused Trace Engine:** `@paulirish/trace_engine` is listed as a dependency in `package.json`, but is **never imported or referenced anywhere in `src/`**.
  - **Dormant CDP Tracing:** `BrowserDriver` contains CDP methods `startTracing()` and `stopTracing()`, but `runner.ts` **never calls them during trial runs**.
  - **Dummy Metrics:** Fields on `RawTrialObservation` such as `mainThreadCpuTimeMs` (copied directly from `durationMs`), `longTaskCount` (hardcoded to `0`), and `postCompletionActivityMs` (hardcoded to `0`) are dummy placeholders.
  - **Single Execution Path:** The engine does not differentiate between lightweight **Scoring Runs** and rich **Evidence Runs**. All trials execute identical un-traced runs.

* **Alignment vs. Gap Analysis:**
  - **Major Architectural Gap:** The current implementation relies **100% on raw wall-clock timing**. It fails to extract structural or execution-work metrics (layout/restyle event counts, V8 compilation/execution time, task counts, or GPU raster work).

* **Risks & Blind Spots:**
  - **OS & CPU Noise Vulnerability:** Wall-clock duration on developer machines exhibits significant variance due to OS thread scheduling, thermal throttling, and background CPU spikes.
  - **Predicate Hacking Susceptibility:** An agent can alter JS completion predicates (e.g. immediately setting element text or triggering completion events) without actually performing DOM layout or paint work. The evaluator will record a fast wall-clock time and declare a false "win".

---

### 4. Anti-Reward-Hacking & Correctness Guardrails

* **Observed Implementation:**
  - **Multi-Modal Guardrail Runner:** After executing performance trials, `runner.ts` performs dedicated baseline vs. candidate comparison runs to evaluate correctness:
    - **Visual:** Pixel/byte buffer diff (`compareScreenshots`).
    - **DOM:** Structural tree comparison (`compareDOMStructures`).
    - **Accessibility:** AXTree role/name comparison (`compareAccessibilityTrees`).
    - **Bundle & Delivery:** Enforces external request limits and JS bundle growth caps ($\le 50\% + 5\text{KB}$) (`verifyBundleAndDeliveryConstraints`).
    - **Post-Completion Horizon:** Checks if post-completion main-thread activity exceeds $200\text{ms}$ (`verifyPostCompletionHorizon`).
    - **Parameterized Holdouts:** Generates seeded holdout scenarios (`createGridHoldoutGenerator`) to test undisclosed query variations.

* **Alignment vs. Gap Analysis:**
  - **Alignment:** Strong multi-layered guardrail design covering visual, DOM, accessibility, bundle size, post-completion activity, and holdout scenarios.
  - **Gaps:**
    1. **DOM Snapshot Truncation Bug:** In `src/browser.ts`, `getDOMSnapshot()` limits serialization to 50 children per node (`Math.min(node.childNodes.length, 50)`). In virtualized or large list applications (such as the 20,000-row proving grid), rows 51 to 20,000 are completely invisible to the DOM guardrail!
    2. **Neutered Post-Completion Guardrail:** Because CDP tracing is not enabled during trial runs, `postCompletionActivityMs` is hardcoded to `0` in `runner.ts`. As a result, Mutation 4 (deferred work cheat via `setTimeout`) is **never detected during live candidate evaluations**.
    3. **Fragile Visual Diffing:** `compareScreenshots` uses exact buffer equality (`bufA.equals(bufB)`). It lacks perceptual hashing or structural visual diffing (e.g., SSIM or pixelmatch thresholding), making it sensitive to anti-aliasing noise or rendering order while blind to off-screen visual deletions.

* **Risks & Blind Spots:**
  - **Agent Reward-Hacking Vulnerability:** An agent optimizing a grid can delete or corrupt rows 51–20,000 to achieve massive rendering speedups while passing DOM guardrails.
  - **Async Work Cheats:** Agents can defer expensive computation or rendering past the completion predicate using `setTimeout` or `requestIdleCallback`, passing evaluation because post-completion tracking is disabled.

---

### 5. Statistical Rigor & Experiment Design

* **Observed Implementation:**
  - **Interleaved Symmetric Blocks:** `generateBlockOrder()` creates randomized symmetric block orders (`ABBA` or `BAAB`) using a seeded pseudo-random number generator (`createSeededRandom`) to cancel out background thermal drift and baseline OS load.
  - **Log-Ratio Paired Deltas:** `computeBlockDeltas()` calculates paired log-ratio deltas ($\ln(\text{Candidate}) - \ln(\text{Baseline})$) per block.
  - **A/A Calibration:** `computeAACalibration()` runs initial A/A baseline trials to measure the machine's Minimum Detectable Effect (MDE) and verify calibration (`aaPassed`).
  - **Statistical Decision Rules:** Uses a Student's t-distribution approximation ($t_{\text{crit}} = 2.0$, ~95% confidence interval):
    - `ACCEPT`: Candidate produces a statistically significant improvement $\ge \text{practicalThreshold}$ with CI entirely below zero.
    - `REJECT`: Candidate exhibits statistically significant regression $> 1\%$ OR fails any correctness guardrail.
    - `INCONCLUSIVE`: Confidence interval includes zero or environment noise floor exceeds target sensitivity.
  - **Append-Only Campaign Ledger:** `CampaignLedger` (`src/ledger.ts`) records baseline/candidate commit hashes, manifest hashes, hidden seeds, block orders, raw observations, and outcome status in `.perf-campaigns/<campaignId>.json`.

* **Alignment vs. Gap Analysis:**
  - **Alignment:** Outstanding statistical foundation leveraging interleaved paired blocks, log-transformed ratio metrics, MDE calibration gating, and append-only campaign ledgers.
  - **Gaps:**
    1. **Default Sample Size Degeneracy:** In `runner.ts`, `blockCount` defaults to 1. Executing 1 block produces only 1 paired delta ($N=1$). Computing standard deviation and standard error on $N=1$ yields $0$ or division by $N-1 = 0$, causing standard error calculations to degenerate ($N \ge 2$ blocks / 8 trials minimum required).
    2. **A/A Calibration Sample Size:** A/A calibration executes only 2 'A' trials (1 pair), providing insufficient degrees of freedom for reliable MDE estimation.
    3. **Missing Outlier & Validity Filtering:** While `RawTrialObservation.valid` exists in the interface, `runner.ts` contains no automated detection logic to invalidate trials affected by CPU preemptions, long GC pauses, or context switches.

* **Risks & Blind Spots:**
  - Running comparisons with default parameters ($1$ block) produces mathematically invalid confidence intervals.
  - Unfiltered OS CPU spikes will skew block deltas and trigger false `INCONCLUSIVE` or `REJECT` verdicts.

---

## Critical Recommendations

To transform `perf-experiment` into a trustworthy, autonomous performance evaluation harness, the following top 4 architectural refactors are required:

### 1. Integrate Full Trace Engine Metrics (`@paulirish/trace_engine`)
* **Action:** Enable CDP tracing during evaluation trials in `runner.ts` and integrate `@paulirish/trace_engine` to parse raw CDP trace events.
* **Impact:** Replaces noisy wall-clock timestamps with deterministic, work-based execution metrics (Main-Thread CPU time, V8 Compile/Execute duration, Layout & Style recalculation counts, and Long Task counts). Prevents agents from gaming JS completion predicates without performing actual browser work.

### 2. Remove DOM Snapshot Truncation & Upgrade Visual Diffing
* **Action:**
  1. Remove `maxChild = 50` truncation in `BrowserDriver.getDOMSnapshot()` and replace it with full DOM structure hashing or structural depth comparison.
  2. Implement perceptual visual diffing (e.g. `pixelmatch` thresholding or SSIM) in `compareScreenshots()`.
* **Impact:** Closes the critical reward-hacking vulnerability where agents corrupt list/grid elements beyond index 50, and eliminates flakiness caused by single-pixel buffer byte differences.

### 3. Enforce Real Post-Completion Horizon Tracking & HAR Network Replay
* **Action:**
  1. Calculate true post-completion CPU/layout activity from CDP trace events for the post-completion window (e.g. +500ms post-completion) and populate `t.postCompletionActivityMs`.
  2. Wire `NetworkRecordReplayer` into `runner.ts` so that all external network traffic is frozen and replayed deterministically from HAR archives during candidate trials.
* **Impact:** Eliminates network jitter and catches async work deferral cheats (`setTimeout`, `requestIdleCallback`) during live candidate evaluations.

### 4. Enforce Minimum Block Count ($N \ge 2$) & Implement Outlier Invalidation
* **Action:**
  1. Increase the default `blockCount` in `runner.ts` to at least 2 blocks (8 trials total) and require $N \ge 2$ in statistical evaluation.
  2. Add run validity checks (e.g., detecting main-thread contention or dropped CDP events) to mark outlier trials as `valid: false`.
* **Impact:** Ensures valid $t$-distribution standard error calculations, stabilizes confidence intervals, and protects evaluation runs against host OS CPU spikes.
