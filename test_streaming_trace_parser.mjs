
import { parseTraceJsonAsStream } from './trace-file-utils.mjs';
import fs from 'fs';
import zlib from 'zlib';
import stream from 'stream';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);

async function generateTraceFile(filename, count, mode = 'pretty', gzip = false) {
    console.log(`Generating ${filename} (${count} events, mode=${mode}, gzip=${gzip})...`);

    // Create the write stream
    const fileStream = fs.createWriteStream(filename);
    let outputStream = fileStream;
    let gzipStream = null;

    if (gzip) {
        gzipStream = zlib.createGzip();
        gzipStream.pipe(fileStream);
        outputStream = gzipStream;
    }

    const write = (chunk) => {
        return new Promise((resolve, reject) => {
            const success = outputStream.write(chunk, (err) => {
                if (err) reject(err);
                // drain handled if false?
                // actually write callback is called when flushed or buffered?
                // node docs say callback is called when data is flushed.
                else resolve();
            });
        });
    };

    // Helper to handle backpressure
    const writeWithBackpressure = async (chunk) => {
        if (!outputStream.write(chunk)) {
            await new Promise(resolve => outputStream.once('drain', resolve));
        }
    };

    await writeWithBackpressure('{"traceEvents": [');
    if (mode === 'pretty') await writeWithBackpressure('\n');

    for (let i = 0; i < count; i++) {
        const event = {
            ts: i * 1000,
            pid: 123,
            tid: 456,
            ph: 'B',
            cat: 'category',
            name: `event_${i}`,
            args: { some_arg: i }
        };

        let json = JSON.stringify(event);
        if (i < count - 1) {
            json += ',';
        }

        if (mode === 'pretty') {
            await writeWithBackpressure(`  ${json}\n`);
        } else {
            await writeWithBackpressure(json);
        }

        if (i % 10000 === 0) {
            await new Promise(r => setTimeout(r, 0));
        }
    }

    await writeWithBackpressure('],\n"metadata": { "version": "1.0", "generated": true }\n}');

    if (gzip) {
        await new Promise((resolve, reject) => {
            gzipStream.end(() => resolve());
        });
    } else {
        await new Promise((resolve, reject) => {
            fileStream.end(() => resolve());
        });
    }

    await new Promise(r => setTimeout(r, 100)); // Slight buffer
}

async function runTests() {
    const EVENT_COUNT = 100000;
    let failed = false;

    // Test 1: Large Pretty Printed
    try {
        const file1 = 'test_large_pretty.json';
        await generateTraceFile(file1, EVENT_COUNT, 'pretty', false);
        const start1 = performance.now();
        const result1 = await parseTraceJsonAsStream(file1);
        const end1 = performance.now();
        console.log(`Parsed ${file1} in ${(end1 - start1).toFixed(2)}ms`);

        if (result1.traceEvents.length !== EVENT_COUNT) {
            console.error(`FAILED: Expected ${EVENT_COUNT} events, got ${result1.traceEvents.length}`);
            failed = true;
        } else if (result1.metadata.generated !== true) {
            console.error(`FAILED: Metadata mismatch`);
            failed = true;
        } else {
            console.log('PASSED: Large Pretty Printed');
        }
        fs.unlinkSync(file1);
    } catch (e) {
        console.error('Test 1 Exception:', e);
        failed = true;
    }

    // Test 2: Large Minified
    try {
        const file2 = 'test_large_minified.json';
        await generateTraceFile(file2, EVENT_COUNT, 'minified', false);
        const start2 = performance.now();
        const result2 = await parseTraceJsonAsStream(file2);
        const end2 = performance.now();
        console.log(`Parsed ${file2} in ${(end2 - start2).toFixed(2)}ms`);

        if (result2.traceEvents.length !== EVENT_COUNT) {
            console.error(`FAILED: Expected ${EVENT_COUNT} events, got ${result2.traceEvents.length}`);
            failed = true;
        } else {
            console.log('PASSED: Large Minified');
        }
        fs.unlinkSync(file2);
    } catch (e) {
        console.error('Test 2 Exception:', e);
        failed = true;
    }

    // Test 3: Large Gzipped Pretty
    try {
        const file3 = 'test_large_pretty.json.gz';
        await generateTraceFile(file3, EVENT_COUNT, 'pretty', true);
        const start3 = performance.now();
        const result3 = await parseTraceJsonAsStream(file3);
        const end3 = performance.now();
        console.log(`Parsed ${file3} in ${(end3 - start3).toFixed(2)}ms`);

        if (result3.traceEvents.length !== EVENT_COUNT) {
            console.error(`FAILED: Expected ${EVENT_COUNT} events, got ${result3.traceEvents.length}`);
            failed = true;
        } else {
            console.log('PASSED: Large Gzipped Pretty');
        }
        fs.unlinkSync(file3);
    } catch (e) {
        console.error('Test 3 Exception:', e);
        failed = true;
    }

    // Test 4: Large Gzipped Minified
    try {
        const file4 = 'test_large_minified.json.gz';
        await generateTraceFile(file4, EVENT_COUNT, 'minified', true);
        const start4 = performance.now();
        const result4 = await parseTraceJsonAsStream(file4);
        const end4 = performance.now();
        console.log(`Parsed ${file4} in ${(end4 - start4).toFixed(2)}ms`);

        if (result4.traceEvents.length !== EVENT_COUNT) {
            console.error(`FAILED: Expected ${EVENT_COUNT} events, got ${result4.traceEvents.length}`);
            failed = true;
        } else {
            console.log('PASSED: Large Gzipped Minified');
        }
        fs.unlinkSync(file4);
    } catch (e) {
        console.error('Test 4 Exception:', e);
        failed = true;
    }

    if (failed) process.exit(1);
}

runTests();
