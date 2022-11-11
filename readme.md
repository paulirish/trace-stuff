
* extraction:
   -  cpu profile from trace

* synthesis
   - network req with timing details (from resource timing)
   - cpuprofile (from js self profile)
   - everything else in rumtrace



trace synth shit:

* rum-trace/src/trace.js
* https://github.com/GoogleChrome/lighthouse/blob/main/lighthouse-core/lib/lantern-trace-saver.js
* https://github.com/GoogleChrome/lighthouse/blob/main/core/lib/timing-trace-saver.js
* https://github.com/GoogleChrome/lighthouse/blob/0fb3206b748dd694f4d1e29802287799bbf03ac1/lighthouse-core/lib/tracehouse/cpu-profile-model.js#L117-L135
* https://github.com/GoogleChrome/lighthouse/blob/98eebdaf6daa82957cadd057b16ce680af226bc3/lighthouse-core/lib/traces/pwmetrics-events.js#L137-L164



use net-export to find real appspot URLS.

https://chrome-devtools-frontend.appspot.com/serve_rev/@3d5948960d62418160796d5831a4d2d7d6c90fa8/inspector.html?remoteVersion=107.0.5304.91&remoteFrontend=true
and devtools_app.html .. worker_app. node... ndb.

dont know about the other non-serve_rev endpoints tho

