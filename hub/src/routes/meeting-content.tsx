import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { all, first, run } from '../db';
import { id, readForm, str } from '../form';
import { FILE_LIMIT, FILE_PART, MEETING_FILE_BUDGET, TOTAL_FILE_BUDGET, meetingFileType, meetingTiming } from '../meeting-content';
import { canEditMeeting } from '../perm';
import type { AppEnv, MeetingRow, Viewer } from '../types';
import { Field, Markdown, PostButton } from '../views/ui';
import { loadMeeting } from './meeting-access';

type Agenda = { id: number; title: string; duration_minutes: number; author_id: number | null; author_name: string; position: number; version: number; removed: number; body: string | null; note_version: number | null };
type Attachment = { id: string; agenda_id: number | null; author_id: number | null; name: string; media_type: string; size: number };
type Content = { agenda: Agenda[]; files: Attachment[] };
type Props = { m: MeetingRow; viewer: Viewer; content: Content; zone: string };

export const meetingContentRoutes = new Hono<AppEnv>();

export async function meetingContent(db: D1Database, meetingId: number): Promise<Content> {
	const [agenda, files] = await Promise.all([
		all<Agenda>(db, `SELECT a.*, n.body, n.version AS note_version FROM meeting_agenda a
		 LEFT JOIN meeting_speaker_notes n ON n.agenda_id = a.id
		 WHERE a.meeting_id = ? ORDER BY a.position, a.id`, meetingId),
		all<Attachment>(db, 'SELECT id, agenda_id, author_id, name, media_type, size FROM meeting_attachments WHERE meeting_id = ? AND removed = 0 ORDER BY rowid', meetingId)
	]);
	return { agenda, files };
}

function canWrite(m: MeetingRow, viewer: Viewer, zone: string, author: number | null) {
	return canEditMeeting(viewer, m) || (author === viewer.id && !meetingTiming(m, zone).ended);
}

function FileList({ m, files, writable }: { m: MeetingRow; files: Attachment[]; writable: (file: Attachment) => boolean }) {
	return (
		<ul class="att-list">
			{files.map((file) => {
				const path = `/meetings/${m.id}/files/${file.id}`;
				return (
					<li>
						<a href={path}>{file.name}</a>
						{file.media_type.startsWith('audio/') && <audio controls preload="none" src={`${path}?play=1`} />}
						{writable(file) && <PostButton action={`${path}/remove`} label="Remove" cls="btn small danger" confirm={`Remove ${file.name}?`} />}
					</li>
				);
			})}
		</ul>
	);
}

function Upload({ root, agenda }: { root: string; agenda?: number }) {
	return (
		<form class="inline-tools" method="post" enctype="multipart/form-data" action={`${root}/files`}>
			{agenda !== undefined && <input type="hidden" name="agenda" value={agenda} />}
			<input type="file" name="file" aria-label="Attachment" required />
			<button class="btn small">Upload file</button>
		</form>
	);
}

export function MeetingAgenda({ m, viewer, content, zone }: Props) {
	const root = `/meetings/${m.id}`;
	const agenda = content.agenda.filter((a) => !a.removed);
	const ended = meetingTiming(m, zone).ended;
	const editor = canEditMeeting(viewer, m);
	return (
		<section class="card meeting-agenda" aria-labelledby="agenda">
			<div class="agenda-heading">
				<h2 class="section-title" id="agenda">Agenda</h2>
				{!ended && <button type="button" class="icon-btn agenda-add-button" aria-label="Add agenda item"
					title="Add agenda item" aria-haspopup="dialog" aria-controls="add-agenda-dialog" data-members-dialog="add-agenda-dialog">
					<span aria-hidden="true">+</span>
				</button>}
			</div>
			<Markdown text={m.agenda} empty={agenda.length ? undefined : 'No agenda recorded.'} />
			{agenda.length > 0 && <ol class="stack agenda-items">
				{agenda.map((item, i) => {
					const path = `${root}/agenda/${item.id}`;
					const writable = canWrite(m, viewer, zone, item.author_id);
					const files = content.files.filter((f) => f.agenda_id === item.id);
					return (
						<li>
							<button type="button" class="agenda-row" aria-haspopup="dialog" aria-controls={`agenda-item-${item.id}`}
								data-members-dialog={`agenda-item-${item.id}`}>
								<span class="agenda-row-main">
									<strong class="agenda-item-title" title={item.title}>{item.title}</strong>
									{files.length > 0 && <span class="agenda-attachment" aria-label={`${files.length} attached ${files.length === 1 ? 'file' : 'files'}`} title={files.map((f) => f.name).join(', ')}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m21 11-8 8a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8-8" /></svg>
										{files.length}
									</span>}
									<span class="agenda-duration">~{item.duration_minutes} min</span>
								</span>
								<span class="agenda-author">{item.author_name}</span>
							</button>
							<dialog id={`agenda-item-${item.id}`} class="members-dialog" aria-labelledby={`agenda-item-${item.id}-title`}>
								<div class="members-dialog-content stack">
									<header><h2 id={`agenda-item-${item.id}-title`}>{item.title}</h2><form method="dialog"><button class="btn small">Close</button></form></header>
									<p class="hint">{item.author_name} · ~{item.duration_minutes} min</p>
							<details>
								<summary class="link-btn">{item.body ? "Speaker notes" : "Add speaker notes"}{files.length ? ` ? ${files.length} ${files.length === 1 ? "file" : "files"}` : ""}</summary>
								{writable ? (
									<form class="stack" method="post" action={`${path}/notes`}>
										<input type="hidden" name="version" value={item.note_version ?? 0} />
										<Field label="Speaker notes"><textarea name="notes" maxlength={10000} rows={3}>{item.body ?? ''}</textarea></Field>
										<div><button class="btn small">Save notes</button></div>
									</form>
								) : <Markdown text={item.body ?? ''} empty="No speaker notes." />}
								<FileList m={m} files={files} writable={() => writable} />
								{writable && <Upload root={root} agenda={item.id} />}
							</details>
							{writable && <details>
								<summary class="link-btn">Edit agenda item</summary>
								<form class="inline-tools" method="post" action={path}>
									<input type="hidden" name="version" value={item.version} />
									<input name="title" maxlength={200} required value={item.title} aria-label="Agenda item title" />
									<Field label="How long (minutes)"><input type="number" name="duration_minutes" required min={1} max={1440} step={1} value={item.duration_minutes} /></Field>
									<button class="btn small">Save</button>
								</form>
								<div class="inline-tools">
									{editor && i > 0 && <PostButton action={`${path}/up`} label="Move up" cls="btn small" name="version" value={String(item.version)} />}
									<PostButton action={`${path}/remove`} label="Remove item" cls="btn small danger" name="version" value={String(item.version)} confirm="Remove this agenda item? Its notes and files will stay with the meeting." />
								</div>
							</details>}
								</div>
							</dialog>
						</li>
					);
				})}
			</ol>}
			{!ended && <dialog id="add-agenda-dialog" class="members-dialog" aria-labelledby="add-agenda-title">
				<div class="members-dialog-content stack">
					<header>
						<h2 id="add-agenda-title">Add agenda item</h2>
						<form method="dialog"><button class="btn small">Close</button></form>
					</header>
				<form class="stack" method="post" enctype="multipart/form-data" action={`${root}/agenda`}>
					<Field label="Agenda item"><input name="title" maxlength={200} required /></Field>
					<Field label="How long (minutes)"><input type="number" name="duration_minutes" required min={1} max={1440} step={1} value={2} /></Field>
					<Field label="Speaker notes"><textarea name="notes" maxlength={10000} rows={2}></textarea></Field>
					<Field label="Attachment (optional)" hint="PDF, Word, PowerPoint, Excel, text, images or audio. Up to 8 MiB.">
						<input type="file" name="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.gif,.webp,.wav,.mp3,.ogg,.flac,.m4a" />
					</Field>
					<div><button class="btn small primary">Add item</button></div>
				</form>
				</div>
			</dialog>}
		</section>
	);
}

export function MeetingFiles({ m, viewer, content, zone }: Props) {
	const byId = new Map(content.agenda.map((item) => [item.id, item]));
	return (
		<section id="files">
			{content.agenda.filter((item) => item.removed && item.body).map((item) => (
				<div class="card"><strong>{item.title}</strong><Markdown text={item.body ?? ''} /></div>
			))}
			<FileList m={m} files={content.files} writable={(file) => canWrite(m, viewer, zone, file.agenda_id === null ? file.author_id : byId.get(file.agenda_id)?.author_id ?? null)} />
			{canWrite(m, viewer, zone, viewer.id) && <Upload root={`/meetings/${m.id}`} />}
		</section>
	);
}

meetingContentRoutes.post('/meetings/:id/agenda', bodyLimit({ maxSize: FILE_LIMIT + 65536 }), async (c) => {
	const v = c.get('viewer');
	const m = await loadMeeting(c, v, c.req.param('id'));
	if (!m) return c.notFound();
	const form = await readForm(c);
	const title = str(form.title, 200);
	const durationText = str(form.duration_minutes);
	const duration = Number(durationText);
	const notes = str(form.notes, 10000);
	const path = `/meetings/${m.id}`;
	if (!title) return c.redirect(`${path}?error=missing#agenda`);
	if (meetingTiming(m, c.env.TIMEZONE).ended) return c.redirect(`${path}?error=forbidden#agenda`);
	if (!/^\d+$/.test(durationText) || !Number.isInteger(duration) || duration < 1 || duration > 1440) return c.redirect(`${path}?error=duration#agenda`);
	const db = c.env.DB;
	const file = form.file;
	// Browsers submit an empty, unnamed File when the optional field is unused.
	if (file && !(typeof file !== 'string' && !Array.isArray(file) && !file.name && !file.size)) {
		if (typeof file === 'string' || Array.isArray(file) || !file.size || file.size > FILE_LIMIT) {
			return c.redirect(`${path}?error=file#agenda`);
		}
		const bytes = await file.arrayBuffer();
		const type = meetingFileType(file.name, bytes);
		if (!type) return c.redirect(`${path}?error=file#agenda`);
		const fileId = crypto.randomUUID();
		// One transaction saves the file, agenda and notes together. A full storage
		// budget creates none of them, so retrying cannot leave a partial agenda.
		const writes = [
			db.prepare(`INSERT INTO meeting_attachments (id, meeting_id, original_meeting_id, author_id, name, media_type, size)
			 SELECT ?1, ?2, ?2, ?3, ?4, ?5, ?6
			 WHERE (SELECT COALESCE(SUM(size), 0) FROM meeting_attachments WHERE meeting_id = ?2) + ?6 <= ?7
			 AND (SELECT COALESCE(SUM(size), 0) FROM meeting_attachments) + ?6 <= ?8`)
				.bind(fileId, m.id, v.id, file.name, type, bytes.byteLength, MEETING_FILE_BUDGET, TOTAL_FILE_BUDGET),
			db.prepare(`INSERT INTO meeting_agenda (meeting_id, author_id, author_name, title, position, duration_minutes)
			 SELECT ?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(position), 0) + 1 FROM meeting_agenda WHERE meeting_id = ?1), ?6
			 WHERE EXISTS (SELECT 1 FROM meeting_attachments WHERE id = ?5)`)
				.bind(m.id, v.id, v.name, title, fileId, duration),
			db.prepare('UPDATE meeting_attachments SET agenda_id = last_insert_rowid(), original_agenda_id = last_insert_rowid() WHERE id = ?')
				.bind(fileId)
		];
		if (notes) writes.push(db.prepare(`INSERT INTO meeting_speaker_notes (meeting_id, agenda_id, body)
		 SELECT meeting_id, agenda_id, ? FROM meeting_attachments WHERE id = ?`).bind(notes, fileId));
		for (let offset = 0; offset < bytes.byteLength; offset += FILE_PART) {
			writes.push(db.prepare(`INSERT INTO meeting_attachment_chunks (file_id, part, data)
			 SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM meeting_attachments WHERE id = ?1)`)
				.bind(fileId, offset / FILE_PART, bytes.slice(offset, offset + FILE_PART)));
		}
		const [saved] = await db.batch(writes);
		return c.redirect(`${path}?${saved.meta.changes ? 'ok=created' : 'error=file-space'}#agenda`);
	}
	const insert = db.prepare(`INSERT INTO meeting_agenda (meeting_id, author_id, author_name, title, position, duration_minutes)
	 SELECT ?1, ?2, ?3, ?4, COALESCE(MAX(position), 0) + 1, ?5 FROM meeting_agenda WHERE meeting_id = ?1`)
		.bind(m.id, v.id, v.name, title, duration);
	if (notes) {
		await db.batch([insert, db.prepare('INSERT INTO meeting_speaker_notes (meeting_id, agenda_id, body) VALUES (?, last_insert_rowid(), ?)').bind(m.id, notes)]);
	} else {
		await insert.run();
	}
	return c.redirect(`${path}?ok=created#agenda`);
});

meetingContentRoutes.post('/meetings/:id/agenda/:item/:operation?', async (c) => {
	const v = c.get('viewer');
	const m = await loadMeeting(c, v, c.req.param('id'));
	if (!m) return c.notFound();
	const db = c.env.DB;
	const item = await first<Agenda>(db, 'SELECT * FROM meeting_agenda WHERE meeting_id = ? AND id = ? AND removed = 0', m.id, id(c.req.param('item')));
	if (!item || !canWrite(m, v, c.env.TIMEZONE, item.author_id)) return c.notFound();
	const form = await readForm(c);
	const path = `/meetings/${m.id}`;
	const version = Number(str(form.version));
	const operation = c.req.param('operation');
	let result;
	if (operation === 'notes') {
		const notes = str(form.notes, 10000);
		if (version === 0 && !notes) return c.redirect(`${path}#agenda`);
		result = version === 0
			? await run(db, `INSERT INTO meeting_speaker_notes (meeting_id, agenda_id, body)
			 SELECT meeting_id, id, ? FROM meeting_agenda WHERE id = ? AND removed = 0
			 ON CONFLICT(agenda_id) DO NOTHING`, notes, item.id)
			: notes
				? await run(db, `UPDATE meeting_speaker_notes SET body = ?, version = version + 1
				 WHERE agenda_id = ? AND version = ? AND EXISTS (SELECT 1 FROM meeting_agenda WHERE id = ? AND removed = 0)`, notes, item.id, version, item.id)
				: await run(db, `DELETE FROM meeting_speaker_notes WHERE agenda_id = ? AND version = ?
				 AND EXISTS (SELECT 1 FROM meeting_agenda WHERE id = ? AND removed = 0)`, item.id, version, item.id);
	} else if (operation === 'up') {
		if (!canEditMeeting(v, m)) return c.notFound();
		// Both positions change in one statement. The selected item's version gates the swap.
		result = await run(db, `WITH pair AS MATERIALIZED (
		 SELECT a.id AS current, a.position AS current_pos, b.id AS previous, b.position AS previous_pos
		 FROM meeting_agenda a JOIN meeting_agenda b ON b.id = (
			SELECT id FROM meeting_agenda WHERE meeting_id = a.meeting_id AND removed = 0
			AND position < a.position ORDER BY position DESC LIMIT 1
		 ) WHERE a.id = ? AND a.version = ? AND a.removed = 0
		) UPDATE meeting_agenda SET position = CASE WHEN id = (SELECT current FROM pair)
		 THEN (SELECT previous_pos FROM pair) ELSE (SELECT current_pos FROM pair) END, version = version + 1
		 WHERE id IN (SELECT current FROM pair UNION ALL SELECT previous FROM pair)`, item.id, version);
	} else if (operation === 'remove') {
		result = await run(db, 'UPDATE meeting_agenda SET removed = 1, version = version + 1 WHERE id = ? AND version = ? AND removed = 0', item.id, version);
	} else if (!operation) {
		const title = str(form.title, 200);
		const durationText = str(form.duration_minutes);
		const duration = Number(durationText);
		if (!title) return c.redirect(`${path}?error=missing#agenda`);
		if (!/^\d+$/.test(durationText) || !Number.isInteger(duration) || duration < 1 || duration > 1440) return c.redirect(`${path}?error=duration#agenda`);
		result = await run(db, 'UPDATE meeting_agenda SET title = ?, duration_minutes = ?, version = version + 1 WHERE id = ? AND version = ? AND removed = 0', title, duration, item.id, version);
	} else {
		return c.notFound();
	}
	return c.redirect(`${path}?${result.meta.changes ? 'ok=saved' : 'error=stale'}#agenda`);
});

meetingContentRoutes.post('/meetings/:id/files', bodyLimit({ maxSize: FILE_LIMIT + 65536 }), async (c) => {
	const v = c.get('viewer');
	const m = await loadMeeting(c, v, c.req.param('id'));
	if (!m) return c.notFound();
	const form = await readForm(c);
	const db = c.env.DB;
	const agenda = id(form.agenda);
	const item = agenda === null ? null : await first<Agenda>(db, 'SELECT * FROM meeting_agenda WHERE id = ? AND meeting_id = ? AND removed = 0', agenda, m.id);
	if (agenda !== null && !item) return c.notFound();
	if (!canWrite(m, v, c.env.TIMEZONE, item ? item.author_id : v.id)) return c.notFound();
	const path = `/meetings/${m.id}`;
	const file = form.file;
	if (!file || typeof file === 'string' || Array.isArray(file) || file.size > FILE_LIMIT || !file.size) {
		return c.redirect(`${path}?error=file#files`);
	}
	const bytes = await file.arrayBuffer();
	const type = meetingFileType(file.name, bytes);
	if (!type) return c.redirect(`${path}?error=file#files`);
	const fileId = crypto.randomUUID();
	const insert = db.prepare(`INSERT INTO meeting_attachments (id, meeting_id, agenda_id, original_meeting_id, original_agenda_id, author_id, name, media_type, size)
	 SELECT ?1, ?2, ?3, ?2, ?3, ?4, ?5, ?6, ?7 WHERE (?3 IS NULL OR EXISTS (
	 SELECT 1 FROM meeting_agenda WHERE id = ?3 AND meeting_id = ?2 AND removed = 0))
	 AND (SELECT COALESCE(SUM(size), 0) FROM meeting_attachments WHERE meeting_id = ?2) + ?7 <= ?8
	 AND (SELECT COALESCE(SUM(size), 0) FROM meeting_attachments) + ?7 <= ?9`)
		.bind(fileId, m.id, agenda, v.id, file.name, type, bytes.byteLength, MEETING_FILE_BUDGET, TOTAL_FILE_BUDGET);
	const writes = [insert];
	for (let offset = 0; offset < bytes.byteLength; offset += FILE_PART) {
		writes.push(db.prepare(`INSERT INTO meeting_attachment_chunks (file_id, part, data)
		 SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM meeting_attachments WHERE id = ?1)`)
			.bind(fileId, offset / FILE_PART, bytes.slice(offset, offset + FILE_PART)));
	}
	const [result] = await db.batch(writes);
	if (result.meta.changes) return c.redirect(`${path}?ok=saved#files`);
	const stale = agenda !== null && !await first(db, 'SELECT 1 FROM meeting_agenda WHERE id = ? AND meeting_id = ? AND removed = 0', agenda, m.id);
	return c.redirect(`${path}?error=${stale ? 'stale' : 'file-space'}#files`);
});

meetingContentRoutes.get('/meetings/:id/files/:file', async (c) => {
	const m = await loadMeeting(c, c.get('viewer'), c.req.param('id'));
	if (!m) return c.notFound();
	const db = c.env.DB;
	const file = await first<Attachment>(db, 'SELECT * FROM meeting_attachments WHERE meeting_id = ? AND id = ? AND removed = 0', m.id, c.req.param('file'));
	if (!file) return c.notFound();
	const chunks = await all<{ data: number[] }>(db, 'SELECT data FROM meeting_attachment_chunks WHERE file_id = ? ORDER BY part', file.id);
	const bytes = new Uint8Array(file.size);
	let offset = 0;
	for (const { data } of chunks) {
		bytes.set(data, offset);
		offset += data.length;
	}
	if (offset !== file.size) return c.text('File unavailable.', 500);
	const inline = c.req.query('play') === '1' && file.media_type.startsWith('audio/');
	const filename = encodeURIComponent(file.name).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16));
	return c.body(bytes.buffer, 200, {
		'Content-Type': file.media_type,
		'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`,
		'Content-Security-Policy': "sandbox; default-src 'none'"
	});
});

meetingContentRoutes.post('/meetings/:id/files/:file/remove', async (c) => {
	const v = c.get('viewer');
	const m = await loadMeeting(c, v, c.req.param('id'));
	if (!m) return c.notFound();
	const db = c.env.DB;
	const file = await first<Attachment & { agenda_author: number | null }>(db, `SELECT f.*, a.author_id AS agenda_author
	 FROM meeting_attachments f LEFT JOIN meeting_agenda a ON a.id = f.agenda_id
	 WHERE f.meeting_id = ? AND f.id = ? AND f.removed = 0`, m.id, c.req.param('file'));
	if (!file || !canWrite(m, v, c.env.TIMEZONE, file.agenda_id === null ? file.author_id : file.agenda_author)) return c.notFound();
	await run(db, 'UPDATE meeting_attachments SET removed = 1 WHERE id = ?', file.id);
	return c.redirect(`/meetings/${m.id}?ok=saved#files`);
});
