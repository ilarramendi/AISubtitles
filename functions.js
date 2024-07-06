import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import colors from "colors";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";
import { glob } from "glob";
import OpenAI from "openai";
import http from "http"

import { encoding_for_model } from "tiktoken";

const { green, yellow, white, red, blue } = colors;

dotenv.config({ path: path.join(os.homedir(), ".subs-ai.env") });

let { TARGET_LANGUAGE, TARGET_LANGUAGE_ALIAS, MAX_TOKENS, AI_MODEL, EXTRA_SPECIFICATION, OPENAI_API_KEY } = process.env;

const debug = process.argv.includes("--debug");
const useLocalServer = process.argv.includes("--local");

const englishAlias = ["en", "eng", "english"];
const textSubtitleFormats = ["srt", "ass", "webvtt", "subrip", "ttml", "vtt", "mov_text"];

const cachePath = path.join(import.meta.dirname, "cache.json");
const translationsCachePath = path.join(import.meta.dirname, "translations.json");
const errorCachePath = path.join(import.meta.dirname, "errors.json");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const toBatch = [];
let jobs = [];
let translations = {};
let errorCount = {};
const executionCache = {};

if (fs.existsSync(cachePath)) {
	jobs = JSON.parse(fs.readFileSync(cachePath).toString());
}
if (fs.existsSync(translationsCachePath)) {
	translations = JSON.parse(fs.readFileSync(translationsCachePath).toString());
}
if (fs.existsSync(errorCachePath)) {
	errorCount = JSON.parse(fs.readFileSync(errorCachePath).toString());
}

TARGET_LANGUAGE_ALIAS = TARGET_LANGUAGE_ALIAS.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

const prompt = `You are an experienced semantic translator.
Follow the instructions carefully.
You will receive user messages containing part of a subtitle SRT file formatted like this:

\`\`\`
1. Message 1
2. Message 2
...
N. Message N
\`\`\`

You should respond in the same format and with the same number of points but translated to Spanish.

- ALWAYS remove non-text content from the subtitles, like HTML tags, or anything that is not readable by a human.
- ALWAYS return the SAME number of points.
- NEVER skip any point.
- NEVER combine points.
- ALWAYS remove branding, ads or urls that are not related to the content.

You are translating a subtitle, so remember each point is something said in a timestamp and cannot be split or merged with other points. To improve how natural translations sound, you can make it not as literal. Each point is related and in order; you can use the context to make a better translation.

Remember not to merge points; the last point should be exactly the same number as the input. If the input's last number is 7, the output you generate should also end with 7.

Content starts here:

${EXTRA_SPECIFICATION}`;

function groupSegmentsByTokenLength(segments, length) {
	const groups = [];
	let currentGroup = [];
	const encoder = encoding_for_model(AI_MODEL);
	let currentGroupTokenCount = numTokens(prompt);

	function numTokens(text) {
		const tokens = encoder.encode(text);
		return tokens.length;
	}

	for (const segment of segments) {
		const segmentTokenCount = numTokens(segment.content);

		if (currentGroupTokenCount + segmentTokenCount <= length) {
			currentGroup.push(segment);
			currentGroupTokenCount += segmentTokenCount + 5; // include size of the "\nNN. " delimeter
		} else {
			groups.push(currentGroup);
			currentGroup = [segment];
			currentGroupTokenCount = segmentTokenCount;
		}
	}

	if (currentGroup.length > 0) {
		groups.push(currentGroup);
	}

	encoder.free(); // clear encoder from memory
	return groups;
}

/**
 * Translates a single string of text using the OpenAI API
 * @param text {string} - The text to translate
 * @returns {Promise<string|false>} - The translated text or false if the translation is in progress
 */
async function getTranslation(text) {
	const message = {
		messages: [
			{
				role: "system",
				content: prompt,
			},
			{ role: "user", content: text },
		],
		model: AI_MODEL,
		temperature: 0.2,
		top_p: 1,
		n: 1,
		presence_penalty: 0,
		frequency_penalty: 0,
	};
	// Return existing translation if it exists
	if (translations[text]) {
		return translations[text];
	}
	// Return false if the translation is already in the queue
	if (jobs.some((j) => j.requests.find((r) => r.content === text))) {
		return false;
	}
	toBatch.push({
		custom_id: (Math.random() * 1000000000).toFixed(0),
		method: "POST",
		url: "/v1/chat/completions",
		body: message,
	});
	// Return false if the translation is already in the queue
	return false;
}

/**
 * Generate a string with highlighted data
 * @param {string|any} string_ - Formatted as: "Hello {{0}}!", if a non string is passed the stringified value is returned, and data is ignored
 * @param {...any} data
 * @returns {string} - With the previous example and data ["pepe"] it would return: "Hello pepe!"
 */
export function template(string_, ...data) {
	let maxIndex = -1;
	if (typeof string_ !== "string") return JSON.stringify(string_);
	return string_.replaceAll(/{{(\d+)}}/g, (match, number) => {
		const number_ = Number.parseInt(number);
		if (number_ >= 0 && number_ < data.length) {
			if (number_ > maxIndex) maxIndex = number_;
			if (Array.isArray(data[number_])) {
				return data[number_].length > 0 ? data[number_].map((d) => white(d)).join(", ") : white("[]");
			}

			if (typeof data[number_] === "object") {
				return white(JSON.stringify(data[number_], undefined, 2));
			}

			return white(data[number_]);
		}

		return match;
	});
}

/**
 *
 * @param inputVideo
 * @returns {Promise<{file: string, translated: boolean}>}
 */
function ffmpegSubtitles(inputVideo) {
	return new Promise((resolve, reject) => {
		ffmpeg.ffprobe(inputVideo, async (err, metadata) => {
			if (err) {
				return reject(err);
			}

			const fileName = mapFileName(inputVideo.split("/").pop());
			const subtitleStreams = metadata.streams.filter(
				(stream) =>
					stream.codec_type === "subtitle" &&
					textSubtitleFormats.includes(stream.codec_name.toLowerCase()) &&
					!stream.disposition.forced,
			);

			if (subtitleStreams.length === 0) {
				return resolve({});
			}
			const englishSub = subtitleStreams.find((s) => englishAlias.includes(s.tags.language.toLowerCase()));
			const translation = subtitleStreams.find((stream) => TARGET_LANGUAGE_ALIAS.includes(stream.tags.language));
			const outputFile = inputVideo.replace(/\.(mkv|mp4)$/, ".en.srt");
			if (translation) {
				console.log(blue(template("Extracting embedded subtitles for target language: {{0}}", fileName)));
				// Extract translated subtitles too
				return await new Promise((resolve2, reject2) => {
					const translatedOutput = outputFile.replace(".en.srt", `.${TARGET_LANGUAGE_ALIAS[0]}.srt`);
					ffmpeg(inputVideo)
						.output(translatedOutput)
						.noVideo()
						.noAudio()
						.outputOptions([`-map 0:${translation.index}`, "-c:s srt"])
						.on("end", () => {
							const content = fs.readFileSync(translatedOutput).toString();
							let result = "";
							for (const match of content.matchAll(/(\d+\r?\n.* --> .*\r?\n)((?:.+\r?\n)+)/g)) {
								const content =
									[...match[2].matchAll(/>([^<]+)</g)].map((m) => m[1].trim()).join(" ") || match[2].trim(); // Transform ass to srt
								result += `${match[1]}${content.replaceAll(/\r?\n/g, " ").replaceAll(/{[^}]+}/g, "")}\n\n`;
							}
							fs.writeFileSync(outputFile, result);
							resolve({ translated: true });
							resolve2();
						})
						.on("error", (err) => {
							reject2(err);
						})
						.run();
				});
			}
			if (!englishSub) {
				const englishSubs = metadata.streams.filter(
					(s) => s.codec_type === "subtitle" && englishAlias.includes(s.tags.language.toLowerCase()),
				);
				if (englishSubs.length > 0) {
					console.log(red(template("\"Found subs but in incorrect format or strict: {{0}}", englishSubs)));
				}
				return resolve({ translated: false });
			}
			console.log(green(template("Extracting embedded subs for translation: {{0}}", fileName)))
			ffmpeg(inputVideo)
				.output(outputFile)
				.noVideo()
				.noAudio()
				.outputOptions([`-map 0:${englishSub.index}`, "-c:s srt"])
				.on("end", () => {
					resolve({ file: outputFile, translated: false });
				})
				.on("error", (err) => {
					reject(err);
				})
				.run();
		});
	});
}

/**
 * Map a file name to a more readable one
 * @param fileName
 * @returns {string}
 */
function mapFileName(fileName) {
	let match = fileName.match(/(.*) \[/);
	if (match) {
		return match[1];
	}
	match = fileName.match(/.* \(\d{4}\)/);
	if (match) {
		return match[0];
	}
	return fileName.replace(/\.(mkv|mp4)$/, "");
}

/**
 * Get the entry matches for a SRT file
 * @param path
 * @param fileName
 * @returns {Promise<{subtitlePath: string, matches: *[]} | false>}
 */
async function getFileMatches(path, fileName) {
	const existingFiles = glob.sync(path.replace(/\.(mkv|mp4)$/, "*.srt").replaceAll(/([[\]])/g, "\\$1"));
	// Validate if it was already translated
	for (const existingFile of existingFiles) {
		if (!process.argv.includes("--ignore-existing-translation")) {
			if (
				TARGET_LANGUAGE_ALIAS.some((l) => existingFile.endsWith(`.${l}.srt`)) ||
				existingFile.endsWith(`.${TARGET_LANGUAGE}.srt`)
			) {
				if (debug) console.warn(template("Skipping, existing translation: {{0}}", fileName));
				return false;
			}
		}
	}
	const matches = [];
	let subtitlePath;
	if (executionCache[path]) {
		if (executionCache[path].canSkip) return false;
		matches.push(...executionCache[path].matches);
		subtitlePath = executionCache[path].sub;
	} else {
		// Find text subtitles
		subtitlePath = existingFiles.find((f) => f.endsWith(".en.srt"));
		if (!subtitlePath) {
			const ffmpegResult = await ffmpegSubtitles(path);
			if (ffmpegResult.translated) {
				executionCache[path] = { canSkip: true };
				return false;
			}

			subtitlePath = ffmpegResult.file;
			if (!subtitlePath) {
				console.log(yellow(template("Skipping: {{0}}, no subtitles found", fileName)));
				executionCache[path] = { canSkip: true };
				return false;
			}
		}
		const content = fs.readFileSync(subtitlePath).toString();
		for (const match of content.matchAll(/(\d+\r?\n.* --> .*\r?\n)((?:.+\r?\n)+)/g)) {
			const trimmedMatch = match[2].trim();
			let content = [...trimmedMatch.matchAll(/>([^<]+)</g)].map((m) => m[1].trim()).join(" "); // Transform ass to srt
			if (!content && !trimmedMatch.startsWith("<")) {
				content = trimmedMatch;
			}

			matches.push({
				header: match[1],
				content: content.replaceAll(/\r?\n/g, " ").replaceAll(/{[^}]+}/g, ""),
			});
		}
		executionCache[path] = {
			matches,
			sub: subtitlePath,
		};
	}
	return { matches, subtitlePath };
}

function getLocalTranslation(text) {
	const data = JSON.stringify({ text })
	const options = {
		hostname: '192.168.1.191',
		port: 45313,
		path: '/translate',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(data)
		}
	}
	return new Promise((resolve, reject) => {
		const req = http.request(options, (res) => {
			let data = '';

			res.on('data', (chunk) => {
				data += chunk;
			});

			res.on('end', () => {
				resolve(data);
			});
		});

		req.on('error', (e) => {
			reject(`Problem with request: ${e.message}`);
		});

		// Write data to request body
		req.write(data);
		req.end();
	});
}

/**
 * Translates subtitles from a given media file
 * @param path {string} - The path to the media file (mkv or mp4)
 * @returns {Promise<void>} - The number of translations left to do
 */
export async function translatePath(path) {
	const split = path.split("/");
	const fileName = mapFileName(split.pop());
	const result = await getFileMatches(path, fileName);
	if (!result) return;
	const { matches, subtitlePath } = result;
	if (useLocalServer) {
	}
	// console.log(`[${index}/${total}] Started translation of: ${fileName}`);
	const groups = groupSegmentsByTokenLength(matches, MAX_TOKENS);
	const allTranslations = [];
	for (const group of groups) {
		try {
			if (useLocalServer) {
				console.log("Getting server translation...");
				const start = performance.now();
				const response = await getLocalTranslation(matches.map((m) => m.content).join("\n"))
				console.log(response)
				console.log(((performance.now() - start) / 60e3).toFixed(2));
				console.log("Done, waiting 10s for next request");
				await new Promise((resolve) => setTimeout(resolve, 10000));
				return;
			}
			const response = await getTranslation(group.map((s, i) => `${i + 1}. ${s.content}`).join("\n"));
			if (!response) continue; // If we have no translation means its batched, so we try again later
			allTranslations.push(response);
		} catch (e) {
			console.log(red(template('Error during translation of: {{0}}', fileName)));
			console.log(e)
			return;
		}
	}

	if (allTranslations.length === groups.length) {
		fs.writeFileSync(
			subtitlePath.replace(".en.srt", `.${TARGET_LANGUAGE_ALIAS[0]}.srt`),
			allTranslations
				.flat()
				.map((m, i) => matches[i].header + m)
				.join("\n\n"),
		);
		console.log(green("Successfully translated: ") + fileName);
	}
}

/**
 * Batches translation requests in queue
 * @returns {Promise<boolean>} - If a job was added
 */
export async function batchTranslations() {
	if (toBatch.length > 0) {
		console.log("Batching", toBatch.length, "requests");
		for (let i = 0; i < toBatch.length; i += 50) {
			const group = toBatch.slice(i, i + 50);
			const jsonl = path.join(os.tmpdir(), "openai-batch.jsonl");
			fs.writeFileSync(jsonl, group.map((b) => JSON.stringify(b)).join("\n"));
			const file = await openai.files.create({
				file: fs.createReadStream(jsonl),
				purpose: "batch",
			});
			const batch = await openai.batches.create({
				input_file_id: file.id,
				endpoint: "/v1/chat/completions",
				completion_window: "24h",
			});
			jobs.push({
				...batch,
				requests: group.map((b) => ({
					content: b.body.messages[1].content,
					id: batch.id,
				})),
			});
			fs.writeFileSync(cachePath, JSON.stringify(jobs));
		}
	}
	const addedJobs = toBatch.length > 0;
	toBatch.splice(0, toBatch.length);
	return addedJobs;
}

/**
 * Checks the status of the batch requests, downloads finished batches
 * @returns {Promise<boolean>} - If a job was completed
 */
export async function checkBatchStatus() {
	if (pendingJobs().length === 0) {
		console.log("No pending jobs");
		return false;
	}
	let jobCompleted = false;
	for (const job of [...jobs]) {
		if (job.finished) continue;
		const batch = await openai.batches.retrieve(job.id);
		if (batch.status === "completed") {
			if (!batch.output_file_id) {
				const errorFileContent = await (await openai.files.content(batch.error_file_id)).text();
				jobs = jobs.filter((j) => j.id !== job.id);
				for (const line of errorFileContent.split("\n").filter(Boolean)) {
					const content = JSON.parse(line);
					if (content?.response?.body?.error?.message.includes("You exceeded your current quota")) {
						console.error(
							"Quota exceeded. Check your usage in: https://platform.openai.com/usage or https://platform.openai.com/organization/usage",
						);
						fs.writeFileSync(cachePath, JSON.stringify(jobs));
						process.exit(1);
					} else {
						console.error(content?.response?.body?.error?.message ?? content);
					}
				}
				continue;
			}
			const content = await openai.files.content(batch.output_file_id);

			const messages = (await content.text()) // Parse JSONL
				.split("\n")
				.filter(Boolean)
				.map((s) => JSON.parse(s));
			let successCount = 0;
			for (const [i, message] of messages.entries()) {
				const split = message.response.body.choices[0].message.content
					.split("\n")
					.map((s) => s.trim().replace(/^(\d+)\. /, ""));
				const originalSplit = job.requests[i].content.split("\n");

				// Translation length mismatch
				if (split.length !== originalSplit.length) {
					errorCount[job.requests[i].content] = (errorCount[job.requests[i].content] ?? 0) + 1;
					if (errorCount[job.requests[i].content] > 20) {
					}
					continue;
				}

				if (errorCount[job.requests[i].content] && errorCount[job.requests[i].content] > 10) {
					console.warn('Translation failed a lot of times, saving to "most-errored.jsonl"');
					const mostErrored = fs.existsSync("most-errored.jsonl")
						? fs.readFileSync("most-errored.jsonl").toString().split("\n")
						: [];
					mostErrored.push(
						JSON.stringify({
							messages: [
								{
									role: "system",
									content: prompt,
								},
								{ role: "user", content: job.requests[i].content },
								{
									role: "assistant",
									content: message.response.body.choices[0].message.content,
								},
							],
						}),
					);
					fs.writeFileSync("most-errored.jsonl", mostErrored.join("\n"));
				}
				if (debug) {
					console.log("Segment translated successfully");
				}
				translations[job.requests[i].content] = split;
				successCount++;
			}
			jobs = jobs.filter((j) => j.id !== job.id);
			console.log(green(template("Job: {{0}} completed: {{1}}/{{2}}", job.id, successCount, job.requests.length)));
			jobCompleted = true;
		} else if (batch.status === "failed") {
			console.error(template("Job failed: {{0}}", job.id));
			jobs = jobs.filter((j) => j.id !== job.id);
		}
	}
	fs.writeFileSync(cachePath, JSON.stringify(jobs));
	fs.writeFileSync(translationsCachePath, JSON.stringify(translations));
	fs.writeFileSync(errorCachePath, JSON.stringify(errorCount));
	return jobCompleted;
}

export function pendingJobs() {
	return jobs.filter((j) => !j.finished);
}
