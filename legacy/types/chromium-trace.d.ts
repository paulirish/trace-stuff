// Thanks https://github.com/GoogleChrome/lighthouse/blob/8577fd6dacdfb930bd6c87f8e159ab63b43e3cd1/types/artifacts.d.ts

export interface Trace {
  traceEvents: TraceEvent[];
  metadata?: {
    'cpu-family'?: number;
  };
  [futureProps: string]: any;
}

/** The type of the Profile & ProfileChunk event in Chromium traces. Note that this is subtly different from Crdp.Profiler.Profile. */
export interface TraceCpuProfile {
  nodes?: Array<{id: number, callFrame: {functionName: string, url?: string}, parent?: number}>
  samples?: Array<number>
  timeDeltas?: Array<number>
}

/**
 * @see https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU/preview
 */
export interface TraceEvent {
  name: string;
  cat: string;
  args: {
    fileName?: string;
    snapshot?: string;
    sync_id?: string;
    beginData?: {
      frame?: string;
      startLine?: number;
      url?: string;
    };
    source_type?: string;
    data?: {
      frameTreeNodeId?: number;
      persistentIds?: boolean;
      frame?: string;
      isLoadingMainFrame?: boolean;
      documentLoaderURL?: string;
      frames?: {
        frame: string;
        parent?: string;
        processId?: number;
      }[];
      page?: string;
      readyState?: number;
      requestId?: string;
      startTime?: number;
      endTime?: number;
      timeDeltas?: TraceCpuProfile['timeDeltas'];
      cpuProfile?: TraceCpuProfile;
      callFrame?: Required<TraceCpuProfile>['nodes'][0]['callFrame']
      /** Marker for each synthetic CPU profiler event for the range of _potential_ ts values. */
      _syntheticProfilerRange?: {
        earliestPossibleTimestamp: number
        latestPossibleTimestamp: number
      }
      stackTrace?: {
        url: string
      }[];
      styleSheetUrl?: string;
      timerId?: string;
      url?: string;
      is_main_frame?: boolean;
      cumulative_score?: number;
      id?: string;
      nodeId?: number;
      impacted_nodes?: Array<{
        node_id: number,
        old_rect?: Array<number>,
        new_rect?: Array<number>,
      }>;
      score?: number;
      weighted_score_delta?: number;
      had_recent_input?: boolean;
      compositeFailed?: number;
      unsupportedProperties?: string[];
      size?: number;
      finishTime?: number;
      encodedDataLength?: number;
      decodedBodyLength?: number;
      didFail?: boolean;

    };
    frame?: string;
    name?: string;
    labels?: string;
    attribution?: Array<any>;
  };
  pid: number;
  tid: number;
  /** Timestamp of the event in microseconds. */
  ts: number;
  dur?: number;  // Not included on usertiming marks…
  ph: string; // TODO, make more specific? 'B'|'b'|'D'|'E'|'e'|'F'|'I'|'M'|'N'|'n'|'O'|'R'|'S'|'T'|'X';
  s?: 't';
  id?: string;
  id2?: {
    local?: string;
  };
}
