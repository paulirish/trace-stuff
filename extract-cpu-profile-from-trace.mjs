
import fs from 'fs';
// fs.readFileSync('./jansatta-profile-report.json')
import trace from './jansatta-profile-report.json' assert { type: 'json' }


console.log(trace.length);