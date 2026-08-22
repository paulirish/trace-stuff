# perf-experiment

> **Given two immutable application revisions, determine whether the candidate produces a real, correctness-preserving performance improvement over the baseline on this machine, or return “inconclusive.”**

`perf-experiment` is a statistically sound, anti-reward-hacking performance evaluation tool and framework for Web applications. The evaluator owns measurement physics, experiment integrity, and statistical judgment—delivering fixed evaluation, bounded experiment time, and strict correctness guardrails.

---

## Core Principles & Architecture

```text
                         trusted control plane
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ perf-experiment compare                                          │
│                                                                  │
│  manifest resolver ─ campaign ledger ─ environment fingerprint   │
│          │                 │                   │                  │
│          ▼                 ▼                   ▼                  │
│  variant materializer   statistics       run validation          │
│      A        B                                                   │
│      │        │                                                   │
│      ▼        ▼                                                   │
│  isolated builds ── deterministic origin proxy ── network replay  │
│                              │                                   │
│                              ▼                                   │
│                   pinned Chrome for Testing                      │
│                              │                                   │
│             ┌────────────────┼────────────────┐                  │
│             ▼                ▼                ▼                  │
│       scenario driver   acquisition plan   correctness probes    │
│             │                │                │                  │
│             └────────────────┼────────────────┘                  │
│                              ▼                                   │
│                       trial observation                          │
│                              │                                   │
│             ┌────────────────┼────────────────┐                  │
│             ▼                ▼                ▼                  │
│        objective          guardrails       run validity          │
│             │                │                │                  │
│             └────────────────┼────────────────┘                  │
│                              ▼                                   │
│          ACCEPT / REJECT / INCONCLUSIVE / INVALID                │
│                              │                                   │
│                       paired evidence run                        │
└──────────────────────────────────────────────────────────────────┘
```

### 1. No Virtual Time During Measured Intervals
Virtual Time is permitted during fixture setup, deterministic timer advancement, and animation settling. It is **strictly forbidden** from trusted stimulus dispatch through the end of the scored horizon. Scored intervals are measured against Chrome's real monotonic trace clock.

### 2. Append-Only Campaign Ledger
Repeated evaluations of the same revision pair extend an existing experiment ledger rather than creating fresh opportunities to get lucky. The ledger records:
- All tested candidates and raw trial observations
- Hidden seeds and randomized block orders (`ABBA` / `BAAB`)
- A/A calibration results and Minimum Detectable Effect (MDE) estimates
- Current accepted champion revision

### 3. Anti-Reward-Hacking Guardrails
The evaluator defends against common benchmark specialization tricks:
- **Baseline-Derived Golden Snapshots**: Screenshots, DOM structures, and accessibility trees are generated from the baseline revision at comparison time and verified against candidate output.
- **Post-Completion Horizon**: Observes main-thread CPU activity, layout work, and long tasks post-completion to catch deferred-work cheats.
- **Bundle & Delivery Constraints**: Tracks HTML, JS, CSS, and total transferred bytes to prevent loading payload after the score.
- **Parameterized Holdouts**: Evaluates seeded undisclosed scenario variations to prevent public scenario overfitting.
- **Network Record & Replay**: Intercepts and replays network traffic deterministically for reproducible trials.

---

## CLI Usage

```sh
pnpm perf-experiment compare \
  --baseline HEAD~1 \
  --candidate HEAD \
  --campaign grid-filter-2026 \
  --out result.json
```

### Options

| Option | Description | Default |
| --- | --- | --- |
| `--baseline <rev>` | Baseline git revision or local directory path | `HEAD~1` |
| `--candidate <rev>` | Candidate git revision or local directory path | `HEAD` |
| `--campaign <id>` | Campaign ledger identifier | `default-campaign` |
| `--experiment <path>` | Path to custom experiment manifest file | Built-in grid manifest |
| `--out <file>` | Path to save JSON evaluation summary output | `stdout` only |

---

## Evaluation Outcomes

Every experiment yields one of four outcomes:

- **`ACCEPT`**: Candidate improved performance by at least the configured practical threshold (e.g., ≥2%) with statistical significance, and all correctness guardrails passed.
- **`REJECT`**: Candidate performance regressed, or any visual/DOM/A11y/bundle/horizon/holdout guardrail check failed.
- **`INCONCLUSIVE`**: The confidence interval includes both meaningful improvement and no effect, or environment noise is too high to support a claim.
- **`INVALID`**: Evaluator contract was broken (e.g. data loss, crash, or unexpected network miss).

Sample output schema:

```json
{
  "status": "ACCEPT",
  "reason": "Candidate produced a real, statistically sound performance improvement of 5.20%.",
  "objective": {
    "name": "input-to-correct-frame",
    "direction": "lower-is-better",
    "baselineMedianMs": 84.2,
    "candidateMedianMs": 79.8,
    "relativeChange": -0.052,
    "confidenceInterval": [-0.068, -0.035]
  },
  "calibration": {
    "estimatedDetectableEffect": 0.016,
    "aaPassed": true,
    "blockCount": 2,
    "trialsPerBlock": 4,
    "sampleTimeSeconds": 10
  },
  "guardrails": {
    "visual": "pass",
    "dom": "pass",
    "accessibility": "pass",
    "bundleBytes": "pass",
    "holdout": "pass",
    "postCompletion": "pass"
  },
  "campaignId": "grid-filter-2026",
  "baselineRevision": "HEAD~1",
  "candidateRevision": "HEAD",
  "timestamp": "2026-08-18T09:15:00.000Z"
}
```

---

## First Proving Application

The repository includes a deterministic 20,000-row data grid proving application located in `proving-app/index.html`. It tests real performance wins (e.g. virtualized rendering) against known benchmark cheats:
1. Large real win (memoized virtualization)
2. Forced synchronous layout removal
3. Visual cheat (`display: none`)
4. Deferred-work cheat (`setTimeout` post-completion)
5. Holdout query overfit

---

## Development & Testing

Built with TypeScript (Node ESM native type stripping `--experimental-strip-types`), Pnpm, Node native test runner (`node:test`), and `oxlint`.

```sh
# Run all unit, integration, and mutation tests
pnpm test

# Run linter
pnpm run lint
```

---

## Legacy Utilities

Pre-existing trace analysis utilities and scripts have been archived in the [`legacy/`](./legacy/) directory.
