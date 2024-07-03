#!/usr/bin/env node
import process from 'node:process';
import {glob} from 'glob';
import {batchTranslations, checkBatchStatus, pendingJobs, translatePath} from './functions.js';

const pattern = process.argv[2]?.endsWith('/') ? process.argv[2]  +  '**/*' : process.argv[2];
if (!pattern) {
	console.error('No pattern provided');
	process.exit(1);
}
const paths = glob.sync(pattern).filter(path => path.match(/\.(mkv|mp4)$/)).sort();
if (paths.length === 0) {
	console.error('No files found for pattern', process.argv[2]);
}
const batch = process.argv.includes('--batch');

async function start() {
	if (batch) await checkBatchStatus();
	console.log('Running for', paths.length, 'files');
	for (const [index, path] of paths.entries()) {
		await translatePath(path, index, paths.length);
	}
	if (batch) await batchTranslations();
	else return;
	const jobs = pendingJobs();
	if (jobs.length === 0) {
		console.log('Done!');
		return;
	}
	const requests = jobs.map(j => j.requests.length).sort((a, b) => b - a)[0];
	const tryingIn = Math.min(1000 * (requests * 10 + 60), 60000); // 10 seconds per request + 60 base, max 60 minutes
	console.log(`${jobs.length} jobs still pending, with ${requests} requests, checking batch status: ${(tryingIn / 60000).toFixed(1)}m`);
	await new Promise(resolve => setTimeout(resolve, tryingIn));
	return start();
}
await start();


