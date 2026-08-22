import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  CampaignLedgerData,
  CampaignLedgerEntry,
  TrialVariant,
  RawTrialObservation,
  CalibrationSummary,
  OutcomeStatus,
} from './types.ts';

export class CampaignLedger {
  private filePath: string;
  private data: CampaignLedgerData;

  constructor(filePath: string, data: CampaignLedgerData) {
    this.filePath = filePath;
    this.data = data;
  }

  public static async loadOrCreate(
    campaignId: string,
    ledgerDir: string = '.perf-campaigns'
  ): Promise<CampaignLedger> {
    await fs.mkdir(ledgerDir, { recursive: true });
    const filePath = path.join(ledgerDir, `${campaignId}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as CampaignLedgerData;
      return new CampaignLedger(filePath, parsed);
    } catch {
      const newLedger: CampaignLedgerData = {
        campaignId,
        createdAt: new Date().toISOString(),
        acceptedChampionHash: null,
        entries: [],
      };
      const ledger = new CampaignLedger(filePath, newLedger);
      await ledger.save();
      return ledger;
    }
  }

  public async save(): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  public getEntries(): readonly CampaignLedgerEntry[] {
    return this.data.entries;
  }

  public getAcceptedChampionHash(): string | null {
    return this.data.acceptedChampionHash;
  }

  public setAcceptedChampionHash(hash: string): void {
    this.data.acceptedChampionHash = hash;
  }

  public findExistingEntry(
    baselineHash: string,
    candidateHash: string,
    manifestHash: string
  ): CampaignLedgerEntry | undefined {
    return this.data.entries.find(
      (e) =>
        e.baselineHash === baselineHash &&
        e.candidateHash === candidateHash &&
        e.manifestHash === manifestHash
    );
  }

  public createEntry(
    baselineHash: string,
    candidateHash: string,
    manifestHash: string,
    hiddenSeed: number,
    blockOrder: TrialVariant[][],
    calibration: CalibrationSummary
  ): CampaignLedgerEntry {
    const newEntry: CampaignLedgerEntry = {
      entryId: `entry-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      timestamp: new Date().toISOString(),
      baselineHash,
      candidateHash,
      manifestHash,
      hiddenSeed,
      blockOrder,
      trials: [],
      calibration,
      outcome: 'INCONCLUSIVE',
    };
    this.data.entries.push(newEntry);
    return newEntry;
  }

  public appendTrialsToEntry(
    entryId: string,
    newTrials: RawTrialObservation[],
    outcome: OutcomeStatus,
    reason?: string
  ): void {
    const entry = this.data.entries.find((e) => e.entryId === entryId);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found in campaign ledger.`);
    }
    entry.trials.push(...newTrials);
    entry.outcome = outcome;
    if (reason) {
      entry.reason = reason;
    }
  }
}
