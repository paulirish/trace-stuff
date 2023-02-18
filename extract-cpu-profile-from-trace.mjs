// run like:
//     node extract-cpu-profile-from-trace.mjs ~/Downloads/Profile-20200214T165958.json
// it'll create 1 or more .cpuprofiles next to the trace


import fs from 'fs';
import {strict as assert} from 'assert';



const passedArg = process.argv[2];
const tracefilename = passedArg ? passedArg : './myjansatta.json';
let trace = JSON.parse(fs.readFileSync(tracefilename, 'utf-8'));
let events = trace.traceEvents || trace;
assert.ok(Array.isArray(events) && events.length);

// A saved .cpuprofile from JS Profiler panel matches `Profiler.Profile` exactly.
// https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile

// node.hitCount and node.children are populated in Profiler.stop's payload (and when saved from Jsprofiler pane), 
// but not when it comes in a trace. This is weird yes.
// CPUProfileDataModel.translateProfileTree() calculates these, according to nancyly@'s tech talk. sweet!



const metaEvts = events.filter(e => e.cat === '__metadata');

// Cat = `disabled-by-default-v8.cpu_profiler`
events = events.filter(e => e.cat.includes('v8.cpu_profiler'));


console.log(events.length);
// e.name of 'ProfileChunk' or 'Profile';
// ProfileChunk events can be on a diff thread id than the header. but the header is canonical.
const profileHeadEvts = events.filter(e => e.name === 'Profile');
// What pid's do we have?
const pidtids = profileHeadEvts.reduce((prev, curr) => prev.add(`p${curr.pid}t${curr.tid}`), new Set())

// See also `extractCpuProfile` in CDT's TimelineModel
pidtids.forEach(pidtid => {
    const pid = parseInt(pidtid.split('t')[0].replace('p', ''), 10);
    const tid = parseInt(pidtid.split('t')[1], 10);
    const threadName = metaEvts.find(e => e.pid === pid && e.tid === tid)?.args.name;
    console.log(`Looking at: "pid":${pid},"tid":${tid},  …  ${threadName}`);

    const profileHeadEvt = profileHeadEvts.find(e => e.pid === pid && e.tid === tid);

    
    // flow event connection. id's like 0x2
    // OKAY this is apparently wrong. but i dont know how these are connected. so weird.
    const chunkEvts = events.filter(e => e.name === 'ProfileChunk' && e.id === profileHeadEvt.id); 


    if (!profileHeadEvt) {
        console.error('missing profile header evt.... probably resolvable but not now');
        return;
    }
    if (!chunkEvts.length){
        console.error(`No chunk events for ${pidtid}!`);
        return;
    } 
        

    /** {Crdp.Profiler.Profile} */
    const profile = {
        nodes: [],
        startTime: -1,
        endTime: -1,
        samples: [],
        timeDeltas: [],
        ...profileHeadEvt.args.data
    };

    chunkEvts.forEach(chunk => {
        const chunkData = chunk.args.data.cpuProfile;
        profile.nodes.push(... chunkData.nodes || []);
        profile.samples.push(... chunkData.samples || []);
        // profile.lines is apparently also a thing but i dont see that it does anything.. so ignoring for now.


        // Why is timeDeltas not in .args.data.cpuProfile???? beats me.
        profile.timeDeltas.push(...  chunk.args.data.timeDeltas || []);
        // shrug. https://source.chromium.org/chromium/chromium/src/+/main:v8/src/profiler/profile-generator.cc;l=755;bpv=0;bpt=1
        profile.endTime = chunkData.endTime || profile.endTime;
    });
    
    // Stole this from timelinemodel
    if (profile.endTime === -1){
        profile.endTime = profile.timeDeltas.reduce((x, y) => x + y, profile.startTime);
    }

    // for compat with vscode's viewer. 
    for (const node of profile.nodes) {
        node.callFrame.url = node.callFrame.url || '';
    }

    const filename = `${tracefilename}-${pid}-${threadName}.cpuprofile`;
    fs.writeFileSync(filename, JSON.stringify(profile));
    console.log('written: ', filename);
});

