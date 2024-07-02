import process from 'node:process';
import fs from 'node:fs';
import {glob} from 'glob';
import {encoding_for_model} from "tiktoken";
import dotenv from 'dotenv';
import OpenAI from "openai";
import os from 'node:os';
import path from 'node:path';

dotenv.config();

const maxTries = 5;
const openai = new OpenAI();


const {OPENAI_API_KEY, TARGET_LANGUAGE, LANGUAGE_SHORT,MAX_TOKENS, AI_MODEL, EXTRA_SPECIFICATION} = process.env;
const cachePath = path.join(import.meta.dirname, 'cache.json');
const batch = process.argv.includes('--batch');
const debug = process.argv.includes('--debug')
const toBatch = [];
let jobs = [];

if (fs.existsSync(cachePath)) {
	jobs = JSON.parse(fs.readFileSync(cachePath).toString());
}

if (!OPENAI_API_KEY) {
	console.error('OPENAI_API_KEY is not set');
	process.exit(1);
}

const paths = glob.sync(process.argv[2]).filter(path => path.endsWith('.srt'));

if (batch) {
	console.log('Checking batch status before starting');
	for (const job of [...jobs]) {
		if (job.finished) continue
		const batch = await openai.batches.retrieve(job.id);
		if (batch.status === 'completed') {
			const content = await openai.files.content(batch.output_file_id);
			const messages = (await content.text()).split('\n').filter(Boolean).map(s => JSON.parse(s));
			for (const [i, message] of messages.entries()) {
				job.requests[i].result = message.response.body.choices[0].message.content
			}
			job.finished = true;
		} else if (batch.status === 'failed') {
			console.log('Batch failed', job.id);
			jobs = jobs.filter(j => j.id !== job.id);
		} else {
			console.log('Batch not completed:', job.id. batch?.status ?? 'Not created yet');
		}
	}
	fs.writeFileSync(cachePath, JSON.stringify(jobs, null, 2));
}

console.log(paths)
for (const path of paths) {
	await translatePath(path).catch(e => {
		console.error(e);
		process.exit(1);
	});
}

if (batch && toBatch.length > 0) {
	console.log('Batching', toBatch.length, 'requests');
	const jsonl = path.join(os.tmpdir(), 'openai-batch.jsonl');
	fs.writeFileSync(jsonl, toBatch.map(b => JSON.stringify(b)).join('\n'));
	const file = await openai.files.create({
		file: fs.createReadStream(jsonl),
		purpose: "batch",
	});
	const batch = await openai.batches.create({
		input_file_id: file.id,
		endpoint: "/v1/chat/completions",
		completion_window: "24h"
	});
	jobs.push({
		...batch,
		requests: toBatch.map(b => ({
			content: b.body.messages[1].content,
			id: batch.id,
			body: undefined,
		}))
	});
	fs.writeFileSync(cachePath, JSON.stringify(jobs, null, 2));
	console.log('Successfully batched', toBatch.length, 'requests, run the command again in a few minutes to check the status');
}


if (paths.length === 0) {
	console.error('No files found for pattern', process.argv[2]);
}

function groupSegmentsByTokenLength(segments, length) {
	const groups = [];
	let currentGroup = [];
	let currentGroupTokenCount = 0;
	const encoder = encoding_for_model(AI_MODEL);

	function numTokens(text) {
		const tokens = encoder.encode(text);
		return tokens.length;
	}

	for (const segment of segments) {
		const segmentTokenCount = numTokens(segment.content);

		if (currentGroupTokenCount + segmentTokenCount <= length) {
			currentGroup.push(segment);
			currentGroupTokenCount += segmentTokenCount + 1; // include size of the "|" delimeter
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

async function getTranslation(text) {
	const message = {
		messages: [
			{ role: "system", content: `You are an experienced semantic translator. Follow the instructions carefully. Translate this to ${TARGET_LANGUAGE}. ALWAYS return the SAME number of points. NEVER skip any point. NEVER combine points, this is specially for the subtitles.${EXTRA_SPECIFICATION ? ` ${EXTRA_SPECIFICATION}` : ''}.` },
			{ role: "user", content: text }
		],
		model: AI_MODEL
	}
	if (batch) {
		const job = jobs.find(j => j.requests.find(r => r.content === text))
		if (job) {
			if (job.finished) {
				return job.requests.find(r => r.content === text).result;
			}
			return false;
		}
		toBatch.push({
			custom_id: (Math.random() * 1000000000).toFixed(0),
			method: 'POST',
			url: '/v1/chat/completions',
			body: message
		});
		return false;
	}
	const completion = await openai.chat.completions.create(message);
	
	const choice = completion.choices[0];
	if (choice.finish_reason !== 'stop') {
		throw new Error('Failed to translate, translation stopped: ' + choice.finish_reason);
	}

	return choice.message.content;
}

async function translate(group, number) {
	const text = group.map(m => m.content).map((s, i) => `${i + 1}. ${s}`).join('\n')
	
	const translated = await getTranslation(text);
	if (!translated) {
		return false;
	}

 	const originalSplit = text.split('\n').map(s => s.replace(/^(\d+)\. /, ''));
	const split = translated.split('\n').map(s => s.trim().replace(/^(\d+)\. /, ''));
	if (split.at(-1) === '') {
		split.pop();
	}
	const max = Math.max(split.length, originalSplit.length);
	if (debug) {
		for (let i = 0; i < max; i++) {
			console.log((originalSplit[i]?.slice(0, 50) ?? '').padEnd(50, ' ') + ' | ' + (split[i]?.slice(0, 50) ?? '').padEnd(50, ' '))
		}
	}
	if (split.length !== originalSplit.length) {
		if (batch) {
			const job = jobs.find(j => j.requests.find(r => r.content === text));
			job.requests = job.requests.filter(r => r.content !== text);
			if (job.requests.length === 0) jobs = jobs.filter(j => j.id !== job.id);
			fs.writeFileSync(cachePath, JSON.stringify(jobs, null, 2));
		}
		if (number >= maxTries) {
			// Used for non-batch mode
			throw new Error('Failed to translate, translation length mismatch, received ' + split.length + ' segments, expected ' + originalSplit.length);
		} else {
			console.log('Translation length missmatch, trying again...');
		}

		return translate(group, number + 1);
	}

	for (const [i, groupMatch] of group.entries()) {
		groupMatch.translatedContent = split[i];
	}
}

async function translatePath(path) {
	const split = path.split('/');
	split.pop();
	const existingFiles = glob.sync(split.join('/').replaceAll(/([[\]])/g, '\\$1') + `/*.srt`);
	for (const existingFile of existingFiles) {
		if (existingFile.endsWith(`.${TARGET_LANGUAGE} (AI).srt`)) {
			if (debug) console.warn('Skipping, already translated:', path);
			return;
		}
		if (!process.argv.includes('--ignore-existing-translation')) {
			if (existingFile.endsWith(`.${LANGUAGE_SHORT}.srt`) || existingFile.endsWith(`.${TARGET_LANGUAGE}.srt`)) {
				if (debug) console.warn('Skipping, existing translation:', path);
				return;
			}
		}

	}
	if (!batch) console.log('Started translation of', path);
	const content = fs.readFileSync(path).toString();
	const matches = [];
	for (const match of content.matchAll(/(\d+\r?\n.* --> .*\r?\n)((?:.+\r?\n)+)/g)) {
		matches.push({
			header: match[1],
			content: match[2].slice(0, -1).replace(/\n/g, ' '),
		});
	}
	if (matches.length === 0) {
		console.warn('No matches found in', path);
		return;
	}
	const groups = groupSegmentsByTokenLength(matches, MAX_TOKENS);
	const globalStart = performance.now();
	for (let i = 0; i < groups.length; i += 10) {
		await Promise.all(groups.slice(i, i + 10).map(group => translate(group, 0)));
	}
	if (matches.every(m => m.translatedContent)) {
		fs.writeFileSync(
			path.replace(/(?:\.en(?:-[a-z]+)?)?\.srt$/, `.${TARGET_LANGUAGE} (AI).srt`),
			matches.map(m => m.header + m.translatedContent).join('\n\n')
		);
		if (batch) {
			console.log('Successfully translated file:', path, 'in', ((performance.now() - globalStart) / 1000).toFixed(2), 'seconds');
		} else{
			console.log('Successfully translated in', ((performance.now() - globalStart) / 1000).toFixed(2), 'seconds');
		}
	}
}

