## various trace file utilities I've amassed over the years

This repo is messy.

🚧 No promises that these aren't broken. Hacking encouraged!

### Some of what's here:

* `bytes-in-trace-by-cat.mjs` - Emit data about what trace event names and categories take up byte size in the JSON
* `format-trace.mjs` - Save a "properly formatted" version of the trace to a new file.
* `user-timings-to-trace.mjs` - Take some user timings (performance.measure/mark) and generate a trace for visualization.
* `winnow-trace.mjs` - Remove trace events to crop it to a timerange, exclude some category, etc. Save it to a new file.
* `generic-trace-to-devtools-trace.mjs` - Take a trace captured from chrome://tracing or perfetto (but converted to json)… And convert it to a trace that DevTools can load as first-class. (not falling back to isGenericTrace handling)
* `extract-netlog-from-trace.mjs` - Extract .netlog from a trace, to use in the [viewer](https://netlog-viewer.appspot.com/).
* `extract-cpu-profile-from-trace.mjs` - Extract .cpuprofile from a trace. It'll create 1 or more .cpuprofiles next to the trace
* `process-traces.mjs` - iterate over all traces found in a folder, run them through a trace processor to see what breaks.
* `trace-file-utils.mjs` - loading, saving utilities.. matching whats in NPP & LH.


## Notes

### Trace synthesis 

We have a BUNCH of code that synthesizes traces out of generic data so it can be viewed in `about:tracing` or DevTools. 

Some of those implementations: 
* https://github.com/paulirish/rum-trace/blob/main/src/trace/trace.js
* https://github.com/GoogleChrome/lighthouse/blob/main/core/test/create-test-trace.js
* https://github.com/GoogleChrome/lighthouse/blob/main/core/lib/lantern-trace-saver.js
* https://github.com/GoogleChrome/lighthouse/blob/main/core/lib/timing-trace-saver.js
* https://github.com/GoogleChrome/lighthouse/blob/c9584689210c4fff8398e7a124f0819a5d91a4e8/core/lib/tracehouse/cpu-profile-model.js#L116-L134
* https://github.com/GoogleChrome/lighthouse/blob/98eebdaf6daa82957cadd057b16ce680af226bc3/lighthouse-core/lib/traces/pwmetrics-events.js#L137-L164
* Some of the above are local here in `./third_party`
* https://github.com/paulirish/rum-trace

[`how to make a sweet combo trace that's viewable in devtools.md`](https://gist.github.com/paulirish/792fdf4baaa4acc1b563d177e1ae569d) (2018, probably outdated)

## revision numbers for CDT frontend appspot

See [github.com/paulirish/trace.cafe/blob/9aee52…/src/app.js#L9-L19](https://github.com/paulirish/trace.cafe/blob/9aee52bd11b0f61e31d1278da0fe0006ec0019ce/src/app.js#L9-L19)


## Types

* https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/types/TraceEvents.ts hard to beat
* https://github.com/GoogleChrome/lighthouse/blob/7d80178c37a1b600ea8f092fc0b098029799a659/types/artifacts.d.ts#L945-L1048 loosey goosey (also local here in `./types/chromium-trace.d.ts`)
* https://github.com/connorjclark/chrome-trace-events-tsc brute force approach.
* https://github.com/TracerBench/tracerbench/blob/master/packages/trace-event/src/types.ts nice. also tracerbench is pretty great, in general.

Ephemeral Zenith Whispering Cascade
