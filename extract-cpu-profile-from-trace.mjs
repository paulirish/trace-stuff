// Extract .cpuprofile from a trace.
//
// run like:
//     node extract-cpu-profile-from-trace.mjs ~/Downloads/Profile-20200214T165958.json
// it'll create 1 or more .cpuprofiles next to the trace


import fs from 'fs';
import path from 'node:path';
import {strict as assert} from 'assert';
import {saveCpuProfile, loadTraceEventsFromFile} from './trace-file-utils.mjs';


// A saved .cpuprofile from JS Profiler panel matches `Profiler.Profile` exactly.
// https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile

// node.hitCount and node.children are populated in Profiler.stop's payload (and when saved from Jsprofiler pane), 
// but not when it comes in a trace. This is weird yes.
// CPUProfileDataModel.translateProfileTree() calculates these, according to nancyly@'s tech talk. sweet!

// See also go/cpu-profiler-notes which has plenty more stuff like this.


export function extractCPUProfileData(events) {

    // Cat = `disabled-by-default-v8.cpu_profiler`
    const metaEvts = events.filter(e => e.cat === '__metadata');

    events = events.filter(e => e.cat.includes('v8.cpu_profiler'));


    console.log(events.length);
    // At this point e.name is either 'ProfileChunk' or 'Profile';
    // ProfileChunk events can be on a diff thread id than the header. but the header is canonical.
    const profileHeadEvts = events.filter(e => e.name === 'Profile');
    // What pid's do we have?
    const pidtids = profileHeadEvts.reduce((prev, curr) => prev.add(`p${curr.pid}t${curr.tid}`), new Set())

    // See also `extractCpuProfile` in CDT's TimelineModel
    return Array.from(pidtids).map(async pidtid => {
        const pid = parseInt(pidtid.split('t')[0].replace('p', ''), 10);
        const tid = parseInt(pidtid.split('t')[1], 10);
        const threadName = metaEvts.find(e => e.pid === pid && e.tid === tid)?.args.name;
        console.log(`Looking at: "pid":${pid},"tid":${tid},  …  ${threadName}`);

        const profileHeadEvt = profileHeadEvts.find(e => e.pid === pid && e.tid === tid);
        // id's like 0x2. Match on id and also pid.
        const chunkEvts = events.filter(e => e.name === 'ProfileChunk' && e.id === profileHeadEvt.id && e.pid && profileHeadEvt.pid); 

        if (!profileHeadEvt) {
            return console.error('missing profile header evt.... probably resolvable but not now');
        }
        if (!chunkEvts.length){
            return console.error(`No chunk events for ${pidtid}!`);
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

        // CPU profile generator makes chunks every 100 samples.. which seems really low IMO. 
        //     https://source.chromium.org/chromium/chromium/src/+/main:v8/src/profiler/profile-generator.cc;l=650-654;drc=4106e2406bd1b7219657a730bc389eb3a4629daa
        chunkEvts.forEach(chunk => {
            const chunkData = chunk.args.data.cpuProfile;
            profile.nodes.push(... chunkData.nodes || []);
            profile.samples.push(... chunkData.samples || []);
            // profile.lines is apparently also a thing (later me. whatttttttttt?) but i dont see that it does anything.. so ignoring for now.
            // todo delete this comment


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

        return {
            pid,
            tid,
            id: profileHeadEvt.id,
            headTs: profileHeadEvt.ts,
            profile,
            threadName,
        }
    });
}



// CLI direct invocation?
if (import.meta.url.endsWith(process?.argv[1])) {
  cli();
}

async function cli() {
  const filename = path.resolve(process.cwd(), process.argv[2]);

  const traceEvents = loadTraceEventsFromFile(filename);
  const cpuProfileData = await Promise.all(extractCPUProfileData(traceEvents));

  cpuProfileData.forEach(async ({pid, tid, profile, threadName}) => {
    // Uncomment to manually "crop" the cpu profile. (probably dont want this....)
    // profile.samples = profile.samples.slice(0, 50_000);
    // profile.timeDeltas = profile.timeDeltas.slice(0, 50_000);

    console.log('counts:', profile.nodes.length, profile.samples.length, profile.timeDeltas.length)

    const cpuFilename = `${filename}-pid-${pid}-tid-${tid}-${threadName}.cpuprofile`;


    // format it and save
    await saveCpuProfile(profile, cpuFilename);

    const readRes = fs.readFileSync(cpuFilename, 'utf-8');
    console.log(`written ${readRes.length.toLocaleString()} bytes to: ${cpuFilename}`);
  });

}
