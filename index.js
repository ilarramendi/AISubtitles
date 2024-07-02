import process from 'node:process';
import fs from 'node:fs';
import {glob} from 'glob';
import {encoding_for_model} from "tiktoken";
import dotenv from 'dotenv';
import OpenAI from "openai";

dotenv.config();

const maxTries = 5;
const openai = new OpenAI();


const {OPENAI_API_KEY, TARGET_LANGUAGE, LANGUAGE_SHORT,MAX_TOKENS, AI_MODEL, EXTRA_SPECIFICATION} = process.env;

if (!OPENAI_API_KEY) {
	console.error('OPENAI_API_KEY is not set');
	process.exit(1);
}

const paths = glob.sync(process.argv[2]).filter(path => path.endsWith('.srt'));

for (const path of paths) {
	await translatePath(path).catch(e => {
		console.error(e);
		process.exit(1);
	});
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

async function translate(text, number) {
	if (number > maxTries) {
		throw new Error('Failed to translate, max tries exceeded');
	}
	
	const completion = await openai.chat.completions.create({
		messages: [
			{ role: "system", content: `You are an experienced semantic translator. Follow the instructions carefully. Translate this to ${TARGET_LANGUAGE}. ALWAYS return the SAME number of points. NEVER skip any point. NEVER combine point.${EXTRA_SPECIFICATION ? ` ${EXTRA_SPECIFICATION}` : ''}.` },
			{ role: "user", content: text }
		],
		model: AI_MODEL
	});
	
	const choice = completion.choices[0];
	if (choice.finish_reason !== 'stop') {
		throw new Error('Failed to translate, translation stopped: ' + choice.finish_reason);
	}

	const originalSplit = text.split('\n').map(s => s.replace(/^(\d+)\. /, ''));
	const split = choice.message.content.split('\n').map(s => s.trim().replace(/^(\d+)\. /, ''));
	if (split.at(-1) === '') {
		split.pop();
	}
	const max = Math.max(split.length, originalSplit.length);
	if (process.argv.includes('--debug')) {
		for (let i = 0; i < max; i++) {
			console.log((originalSplit[i]?.slice(0, 50) ?? '').padEnd(50, ' ') + ' | ' + (split[i]?.slice(0, 50) ?? '').padEnd(50, ' '))
		}

		if (split.length !== originalSplit.length) {
			console.error('Failed to translate, translation length mismatch, received ' + split.length + ' segments, expected ' + originalSplit.length + ' try: ' + number);
			return translate(text, number + 1);
		}
	}

	return split;
}

async function translatePath(path) {
	const split = path.split('/');
	split.pop();
	const existingFiles = glob.sync(split.join('/').replaceAll(/([[\]])/g, '\\$1') + `/*.srt`);
	for (const existingFile of existingFiles) {
		if (existingFile.endsWith(`.${TARGET_LANGUAGE} (AI).srt`)) {
			console.warn('Skipping, already translated:', path);
			return;
		}
		if (!process.argv.includes('--ignore-existing-translation')) {
			if (existingFile.endsWith(`.${LANGUAGE_SHORT}.srt`) || existingFile.endsWith(`.${TARGET_LANGUAGE}.srt`)) {
				console.warn('Skipping, existing translation:', path);
				return;
			}
		}

	}
	console.log('Started translation of', path);
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
		await Promise.all(groups.slice(i, i + 10).map(async group => {
			const start = performance.now();
			const translated = await translate(group.map(m => m.content).map((s, i) => `${i + 1}. ${s}`).join('\n'));
			if (process.argv.includes('--debug')) {
				console.log('Translated in', performance.now() - start, 'ms');
			}
			for (const [i, groupMatch] of group.entries()) {
				groupMatch.translatedContent = translated[i];
			}
		}));
	}
	
	fs.writeFileSync(
		path.replace(/(?:\.en(?:-[a-z]+)?)?\.srt$/, `.${TARGET_LANGUAGE} (AI).srt`),
		matches.map(m => m.header + m.translatedContent).join('\n\n')
	);
	console.log('Successfully translated in', ((performance.now() - globalStart) / 1000).toFixed(2), 'seconds');
}

