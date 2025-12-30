
import { parseTraceJsonAsStream } from './trace-file-utils.mjs';
import fs from 'fs';

async function verify() {
    console.log('Verifying...');

    // Case 1: Trace generated with newlines (like traceJsonGenerator)
    const traceGeneratorFormat = `{"traceEvents": [
  {"ts": 1, "name": "e1"},
  {"ts": 2, "name": "e2"}
],
"metadata": { "version": 2 }
}`;
    fs.writeFileSync('verify_trace_1.json', traceGeneratorFormat);

    try {
        const result1 = await parseTraceJsonAsStream('verify_trace_1.json');
        console.log('Result 1 (Newline):', result1);
        if (result1.traceEvents.length === 2 && result1.metadata.version === 2) {
            console.log('Test 1 Passed');
        } else {
            console.error('Test 1 Failed');
            process.exit(1);
        }
    } catch (e) {
        console.error('Test 1 Failed with error:', e);
        process.exit(1);
    }
    fs.unlinkSync('verify_trace_1.json');

    // Case 2: Minified trace (no newlines)
    const minifiedTrace = `{"traceEvents":[{"ts":3,"name":"e3"},{"ts":4,"name":"e4"}],"metadata":{"version":3}}`;
    fs.writeFileSync('verify_trace_2.json', minifiedTrace);

    try {
        const result2 = await parseTraceJsonAsStream('verify_trace_2.json');
        console.log('Result 2 (Minified):', result2);
        if (result2.traceEvents.length === 2 && result2.metadata.version === 3) {
            console.log('Test 2 Passed');
        } else {
            console.error('Test 2 Failed');
            process.exit(1);
        }
    } catch (e) {
        console.error('Test 2 Failed with error:', e);
        process.exit(1);
    }
    fs.unlinkSync('verify_trace_2.json');
}

verify();
