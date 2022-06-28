
import fs from 'fs';
// fs.readFileSync('./jansatta-profile-report.json')
import trace from './scroll-tl-viewer.json' assert { type: 'json' }


// A saved .cpuprofile from JS Profiler panel matches `Profiler.Profile` exactly.
// https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile

let events = trace.traceEvents || trace;

console.assert(Array.isArray(events) && events.length);

// disabled-by-default-v8.cpu_profiler
events = events.filter(e => e.cat.includes('v8.cpu_profiler'));


// What pid's do we have?
const pids = events.reduce((prev, curr) => prev.add(curr.pid), new Set())

// See also `extractCpuProfile` in CDT's TimelineModel
pids.forEach(pid => {
    console.log(`Looking at pid ${pid}`);
    const profileEvts = events.filter(e => e.pid === pid);

    // e.name of 'ProfileChunk' or 'Profile';
    const profileEvt = profileEvts.find(e => e.name === 'Profile');
    const chunkEvts = profileEvts.filter(e => e.name === 'ProfileChunk');
    console.assert(profileEvt);
    console.assert(chunkEvts.length);

    /** {Crdp.Profiler.Profile} */
    const profile = {
        nodes: [],
        startTime: -1,
        endTime: -1,
        samples: [],
        timeDeltas: [],
        ...profileEvt.args.data
    };

    chunkEvts.forEach(chunk => {
        const chunkData = chunk.args.data.cpuProfile;
        profile.nodes.push(... chunkData.nodes || []);
        profile.samples.push(... chunkData.samples || []);
        // Why is timeDeltas not in .args.data.cpuProfile???? beats me.
        profile.timeDeltas.push(...  chunk.args.data.timeDeltas || []);
        // shrug. https://source.chromium.org/chromium/chromium/src/+/main:v8/src/profiler/profile-generator.cc;l=755;bpv=0;bpt=1
        profile.endTime = chunkData.endTime || profile.endTime;
    });
    
    if (profile.endTime === -1){
        profile.endTime = profile.timeDeltas.reduce((x, y) => x + y, profile.startTime);
    }

    // console.log({profile});
    fs.writeFileSync(`scroll-tl-viewer-${pid}.cpuprofile`, JSON.stringify(profile));
});

