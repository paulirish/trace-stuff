
* extraction:
   -  cpu profile from trace

* synthesis
   - network req with timing details (from resource timing)
   - cpuprofile (from js self profile)
   - everything else in rumtrace



trace synth shit:

* https://github.com/paulirish/rum-trace/blob/main/src/trace/trace.js
* https://github.com/GoogleChrome/lighthouse/blob/main/core/test/create-test-trace.js
* https://github.com/GoogleChrome/lighthouse/blob/main/core/lib/lantern-trace-saver.js
* https://github.com/GoogleChrome/lighthouse/blob/main/core/lib/timing-trace-saver.js
* https://github.com/GoogleChrome/lighthouse/blob/c9584689210c4fff8398e7a124f0819a5d91a4e8/core/lib/tracehouse/cpu-profile-model.js#L116-L134
* https://github.com/GoogleChrome/lighthouse/blob/98eebdaf6daa82957cadd057b16ce680af226bc3/lighthouse-core/lib/traces/pwmetrics-events.js#L137-L164

## revision numbers for CDT frontend appspot

? use net-export to find real appspot URLS.

as of feb 2023, latest advice is in trace-cafe



https://chrome-devtools-frontend.appspot.com/serve_rev/@3d5948960d62418160796d5831a4d2d7d6c90fa8/inspector.html?remoteVersion=107.0.5304.91&remoteFrontend=true
and devtools_app.html .. worker_app. node... ndb.

dont know about the other non-serve_rev endpoints tho

