#!/usr/bin/env node
import process from "node:process";
import { glob } from "glob";
import {
	batchTranslations,
	checkBatchStatus,
	pendingJobs,
	translatePath,
} from "./functions.js";

const pattern = process.argv[2]?.endsWith("/")
	? `${process.argv[2]}/**/*`
	: process.argv[2];
if (!pattern) {
	console.error("No pattern provided");
	process.exit(1);
}
const paths = glob
	.sync(pattern)
	.filter((path) => path.match(/\.(mkv|mp4)$/))
	.sort();

if (paths.length === 0) {
	console.error("No files found for pattern", process.argv[2]);
}
async function start(isFirstRun) {
	const jobCompleted = await checkBatchStatus();
	if (jobCompleted || isFirstRun) {
		console.log("Running for", paths.length, "files");
		for (const [index, path] of paths.entries()) {
			await translatePath(path, index, paths.length);
		}
	}
	const addedJobs = await batchTranslations();
	const jobs = pendingJobs();
	if (jobs.length === 0) {
		console.log("Done!");
		return;
	}
	const requests = jobs.map((j) => j.requests.length).sort((a, b) => a - b)[0];
	if (addedJobs || isFirstRun) {
		console.log(
			`${jobs.length} jobs still pending, with ${requests} requests, checking again in: 1m`,
		);
	}
	await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
	return start();
}
await start(true);
