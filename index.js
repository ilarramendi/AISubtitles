#!/usr/bin/env node
import process from 'node:process';
import {glob} from 'glob';
import {batchTranslations, checkBatchStatus, pendingJobs, translatePath} from './functions.js';

const paths = glob.sync(process.argv[2]).filter(path => path.match(/\.(mkv|mp4)$/)).sort();
if (paths.length === 0) {
	console.error('No files found for pattern', process.argv[2]);
}
const batch = process.argv.includes('--batch');
const wait = process.argv.includes('--wait');

async function start() {
	if (batch) await checkBatchStatus();
	console.log('Running for', paths.length, 'files');
	for (const [index, path] of paths.entries()) {
		await translatePath(path, index, paths.length);
	}
	if (batch) await batchTranslations();
	const jobs = pendingJobs();
	if (jobs.length === 0) {
		console.log('Done!');
		return;
	}
	if (wait) {
		const requests = jobs.map(j => j.requests.length).reduce((a, b) => a + b, 0);
		const tryingIn = 1000 * requests * 5;
		console.log(`${jobs.length} jobs still pending, with ${requests} pending requests, checking batch status : ${(tryingIn / 60000).toFixed(1)}m`);
		await new Promise(resolve => setTimeout(resolve, tryingIn));
		return start();
	}
	console.log('Jobs still pending, run the command again in a few minutes to check the status or use --wait');
}
await start();


