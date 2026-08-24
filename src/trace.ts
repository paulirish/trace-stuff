export interface TraceMetrics {
  mainThreadCpuTimeMs: number;
  longTaskCount: number;
  postCompletionActivityMs: number;
}

export function extractTraceMetrics(
  events: Array<{ name: string; cat?: string; ts: number; ph: string; dur?: number }>,
  stimulusStartUs: number,
  completionUs: number
): TraceMetrics {
  let mainThreadCpuTimeMs = 0;
  let longTaskCount = 0;
  let postCompletionActivityMs = 0;

  for (const ev of events) {
    if (!ev.dur || ev.dur <= 0) continue;
    const durMs = ev.dur / 1000;
    const eventEndUs = ev.ts + ev.dur;

    if (
      ev.ts >= stimulusStartUs &&
      ev.ts <= completionUs &&
      (ev.name === 'RunTask' ||
        ev.name === 'EvaluateScript' ||
        ev.name === 'FunctionCall' ||
        ev.name === 'Layout' ||
        ev.name === 'UpdateLayoutTree' ||
        ev.name === 'HitTest')
    ) {
      mainThreadCpuTimeMs += durMs;
      if (durMs >= 50) {
        longTaskCount++;
      }
    }

    if (ev.ts >= completionUs || eventEndUs > completionUs) {
      if (
        ev.name === 'RunTask' ||
        ev.name === 'EvaluateScript' ||
        ev.name === 'TimerFire' ||
        ev.name === 'Layout' ||
        ev.name === 'UpdateLayoutTree'
      ) {
        const postOverlapUs = Math.max(0, eventEndUs - Math.max(ev.ts, completionUs));
        postCompletionActivityMs += postOverlapUs / 1000;
      }
    }
  }

  return {
    mainThreadCpuTimeMs: Math.round(mainThreadCpuTimeMs * 10) / 10,
    longTaskCount,
    postCompletionActivityMs: Math.round(postCompletionActivityMs * 10) / 10,
  };
}
