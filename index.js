#!/usr/bin/env node
import process from "node:process";
import { glob } from "glob";

import {
	batchTranslations,
	checkBatchStatus,
	pendingJobs,
	template,
	translatePath,
} from "./functions.js";

const pattern = process.argv[2]?.endsWith("/")
	? `${process.argv[2]}/{*,**/*}`
	: process.argv[2];

if (!pattern) {
	console.error("No pattern provided");
	process.exit(1);
}
const paths = glob
	.sync(pattern.replaceAll("[", "\\[").replaceAll("]", "\\]"))
	.filter((path) => path.match(/\.(mkv|mp4)$/))
	.sort();

if (paths.length === 0) {
	console.error("No files found for pattern", process.argv[2]);
}
console.log("Running for", paths.length, "files");
async function start(isFirstRun) {
	const jobCompleted = await checkBatchStatus();
	if (jobCompleted || isFirstRun) {
		for (const path of paths) {
			await translatePath(path);
		}
		await batchTranslations();
	}
	const jobs = pendingJobs();
	if (jobs.length === 0) {
		console.log("Done!");
		return;
	}
	console.log(
		`${jobs.length} jobs still pending, with ${jobs.reduce(
			(a, b) => a + b.requests.length,
			0,
		)} requests, checking again in 30s`,
	);
	await new Promise((resolve) => setTimeout(resolve, 30 * 1000));
	return start();
}
await start(true);
