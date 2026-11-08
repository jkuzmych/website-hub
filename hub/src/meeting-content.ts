import type { Meeting } from './types';
import { todayIn } from './dates';

export const FILE_LIMIT = 8 * 1024 * 1024;
export const FILE_PART = 1024 * 1024;
export const MEETING_FILE_BUDGET = 64 * FILE_PART;
export const TOTAL_FILE_BUDGET = 256 * FILE_PART;

export function meetingTiming(m: Pick<Meeting, 'date' | 'time' | 'end_time'>, timeZone: string, now = new Date()) {
	const date = todayIn(timeZone, now);
	const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
	const started = date > m.date || (date === m.date && time >= m.time);
	const ended = date > m.date || (date === m.date && !!m.end_time && time >= m.end_time);
	return { started, ended };
}

// Adapted from the tracker. Validate the name and file signature independently of the browser MIME type.
export function meetingFileType(name: string, bytes: ArrayBuffer): string | null {
	const data = new Uint8Array(bytes);
	const ext = name.split('.').pop()?.toLowerCase();
	const head = data.subarray(0, 32);
	const signature = String.fromCharCode(...head);
	if (!name || name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(name) || !data.length || data.length > FILE_LIMIT) return null;
	if (ext === 'txt') {
		try {
			new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data);
			return data.includes(0) ? null : 'text/plain';
		} catch {
			return null;
		}
	}
	if (ext === 'pdf' && signature.startsWith('%PDF-')) return 'application/pdf';
	if (ext === 'docx' && signature.startsWith('PK\x03\x04')) {
		const directory = new TextDecoder().decode(data);
		if (!directory.includes('[Content_Types].xml') || !directory.includes('word/document.xml')) return null;
		return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	}
	if (ext === 'png' && signature.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
	if ((ext === 'jpg' || ext === 'jpeg') && head[0] === 255 && head[1] === 216 && head[2] === 255) return 'image/jpeg';
	if (ext === 'gif' && /^GIF8[79]a/.test(signature)) return 'image/gif';
	if (ext === 'webp' && signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP') return 'image/webp';
	if (ext === 'wav' && signature.startsWith('RIFF') && signature.slice(8, 12) === 'WAVE') return 'audio/wav';
	if (ext === 'mp3' && (signature.startsWith('ID3') || (head[0] === 255 && (head[1] & 224) === 224))) return 'audio/mpeg';
	if (ext === 'ogg' && signature.startsWith('OggS') && /OpusHead|vorbis/.test(String.fromCharCode(...data.subarray(0, 512)))) return 'audio/ogg';
	if (ext === 'flac' && signature.startsWith('fLaC')) return 'audio/flac';
	if (ext === 'm4a' && signature.slice(4, 8) === 'ftyp' && ['M4A ', 'M4B '].includes(signature.slice(8, 12))) return 'audio/mp4';
	return null;
}
