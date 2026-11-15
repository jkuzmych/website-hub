import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

const origin = 'https://hub.example.test';
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const due = '2099-12-31';
const roster = ['Exec', 'Ada', 'Ben', 'Cy', 'Dee'];

test('Hub integration with the migrated Worker and D1', async (t) => {
	const { outputFiles } = await build({
		stdin: {
			resolveDir: process.cwd(), loader: 'ts', contents: `
			import app from './src/index.tsx';
			import { runDailyReminders } from './src/reminders';
			export default { fetch(req, env, ctx) {
				if (new URL(req.url).pathname === '/__test-reminders') {
					return runDailyReminders(env).then((result) => Response.json(result));
				}
				return app.fetch(req, env, ctx);
			}};`
		},
		platform: 'browser', format: 'esm', bundle: true, write: false, external: ['cloudflare:*', 'node:*']
	});
	const runtime = new Miniflare(convertV4MiniflareOptions({
		defaultPersistRoot: resolve('.wrangler', 'integration-' + randomUUID()),
		workers: [{
			name: 'hub-test', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
			modules: true, script: outputFiles[0].text, d1Databases: { DB: 'hub-test' }, d1Persist: true,
			bindings: {
				APP_URL: origin, MAIL_FROM: 'club@example.test', MAIL_FROM_NAME: 'Test Club',
				APP_SECRET: 'synthetic-key', ADMIN_EMAILS: '', DEV_MODE: '1', TIMEZONE: 'America/Chicago'
			}
		}]
	}));
	t.after(() => runtime.dispose());
	const db = await runtime.getD1Database('DB', 'hub-test');
	const migrations = readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort();
	const apply = async (files: string[]) => {
		for (const file of files) {
			const sql = readFileSync(resolve('migrations', file), 'utf8');
			await db.batch(unstable_splitSqlQuery(sql).map((query) => db.prepare(query)));
		}
	};
	await apply(migrations.slice(0, 10));
	await db.batch([
		...roster.map((name, i) => db.prepare('INSERT INTO members (id, name, email, role) VALUES (?, ?, ?, ?)')
			.bind(i + 1, name, `${name.toLowerCase()}@example.test`, i === 0 ? 'exec' : 'member')),
		db.prepare("INSERT INTO teams (id, name, kind) VALUES (10, 'Product', 'project'), (11, 'Finance', 'exec')"),
		db.prepare('INSERT INTO team_members (team_id, member_id, is_lead) VALUES (10, 2, 1), (10, 3, 0), (10, 5, 0), (11, 1, 0), (11, 2, 0)'),
		db.prepare(`INSERT INTO meetings (id, team_id, title, date, time, agenda, notes, created_by) VALUES
		 (1, 10, 'Product meeting', ?, '00:00', 'Existing agenda', 'Existing notes', 1),
		 (2, 11, 'Restricted meeting', ?, '00:00', '', '', 1),
		 (3, 10, 'Old meeting', '2020-01-01', '00:00', '', '', 1)`).bind(date, date),
		db.prepare('INSERT INTO meeting_teams (meeting_id, team_id) VALUES (1, 10), (2, 11), (3, 10)'),
		db.prepare("INSERT INTO attendance (meeting_id, member_id, status) VALUES (1, 2, 'excused'), (3, 2, 'late')"),
		db.prepare("INSERT INTO tasks (id, title, team_id, meeting_id, assignee_id, assigned_by, due_date) VALUES (50, 'Old action item', 11, 2, 1, 1, ?)").bind(due),
		db.prepare("INSERT INTO forms (id, meeting_id, token, title) VALUES (1, 1, 'synthetic-public-form', 'Existing feedback')"),
		...roster.map((_, i) => db.prepare('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)')
			.bind(createHash('sha256').update(`synthetic-session-${i + 1}`).digest('base64url'), i + 1, '2099-12-31T00:00:00Z'))
	]);
	await apply(migrations.slice(10));
	const request = async (path: string, member?: number, body?: URLSearchParams | FormData, requestOrigin = origin) => {
		const req = new Request(requestOrigin + path, {
			redirect: 'manual', method: body ? 'POST' : 'GET', body,
			headers: member ? { Cookie: `hub_session=synthetic-session-${member}`, Origin: origin } : {}
		});
		return runtime.dispatchFetch(req.url, { method: req.method, redirect: req.redirect,
			headers: Object.fromEntries(req.headers), body: body ? await req.arrayBuffer() : undefined });
	};
	const post = (path: string, member: number, data: Record<string, string> | [string, string][]) =>
		request(path, member, new URLSearchParams(data));
	const html = async (path: string, member?: number) => {
		const res = await request(path, member);
		assert.equal(res.status, 200, await res.clone().text());
		return res.text();
	};

	await t.test('navigation, availability and team administration respect roles', async () => {
		assert.equal((await request('/teams')).status, 302);
		const login = await request('/login', undefined, new URLSearchParams({ email: 'cy@example.test' }));
		const code = (await login.text()).match(/your code is <strong>(\d{6})/)?.[1];
		assert.ok(code);
		// Local Wrangler can forward the request under the production hostname.
		const signedIn = await request('/verify', undefined, new URLSearchParams({ email: 'cy@example.test', code, next: '/teams' }), 'http://hub.agenticaiuw.com');
		assert.equal(signedIn.headers.get('location'), '/teams');
		const sessionCookie = signedIn.headers.get('set-cookie')!;
		assert.match(sessionCookie, /^hub_session=/);
		assert.doesNotMatch(sessionCookie, /;\s*Domain=/i);
		const teams = await html('/teams', 4);
		assert.match(teams, /href="\/teams\/10">Product/);
		assert.match(teams, /href="\/teams\/11">Finance/);
		assert.doesNotMatch(teams, />Exec Board</);
		assert.match(teams, /href="\/teams\/10">Product<\/a><\/h2><p>No exec assigned<\/p>/);
		assert.match(teams, /href="\/teams\/11">Finance<\/a><\/h2><p>Exec · <a href="\/people\/1">Exec<\/a><\/p>/);
		assert.match(teams, /data-members-dialog="team-11-members"/);
		const financeRoster = teams.match(/<dialog id="team-11-members"[^>]*>(.*?)<\/dialog>/s)?.[1] ?? '';
		assert.match(financeRoster, /href="\/people\/1">Exec<\/a>/);
		assert.match(financeRoster, /href="\/people\/2">Ada<\/a>/);
		assert.equal((await post('/teams/10/profile', 2, { description: 'forbidden' })).status, 404);
		assert.equal((await post('/teams/10/page-admins/3', 1, { enabled: '1' })).status, 302);
		assert.equal((await post('/teams/10/profile', 3, { description: 'Delegated page edit' })).status, 302);
		assert.equal((await post('/teams/11/profile', 3, { description: 'wrong team' })).status, 404);
		assert.equal((await post('/teams/10/page-admins/2', 3, { enabled: '1' })).status, 404);
		assert.match((await post('/availability', 3, { hours: '169' })).headers.get('location')!, /error=hours/);
		assert.equal((await post('/availability', 3, { hours: '12.5', member: '2' })).status, 302);
		assert.match(await html('/teams/10', 4), /Ben.*12\.5 h\/week/s);
		assert.match(await html('/', 3), /value="12\.5"/);
		assert.match((await post('/teams/10/profile', 1, { discord: 'javascript:alert(1)' })).headers.get('location')!, /error=link/);
		await post('/teams/10/profile', 1, { description: 'Main focus', github: 'https://github.example.test/product' });
		assert.match(await html('/teams/10', 4), /Main focus.*github\.example\.test/s);
		for (const name of ['Cloud', 'Research']) {
			const created = await post('/teams/10/subteams', 1, { name });
			assert.match(created.headers.get('location')!, /subteam=\d+/);
		}
		assert.match((await post('/teams/10/subteams/1', 1, [['name', 'Cloud'], ['member', '4']])).headers.get('location')!, /error=selection/);
		await post('/teams/10/subteams/1', 1, [['name', 'Cloud'], ['description', 'Cloud focus'], ['member', '2'], ['member', '3']]);
		await post('/teams/10/subteams/2', 1, [['name', 'Research'], ['member', '3'], ['member', '5']]);
		assert.match(await html('/teams/10?subteam=1', 4), /Main focus.*Cloud focus/s);
	});

	await t.test('shared cards keep one status and a deduplicated recipient set', async () => {
		const created = await post('/teams/10/board', 2, [['title', 'One shared card'], ['due', date], ['person', '2'], ['subteam', '1'], ['subteam', '2']]);
		const href = created.headers.get('location')!.split('?')[0];
		const taskId = href.split('/').at(-1)!;
		assert.match(href, /^\/board-tasks\//);
		const recipients = await db.prepare('SELECT member_id FROM board_task_recipients WHERE task_id = ? ORDER BY member_id').bind(taskId).all();
		assert.deepEqual(recipients.results.map((r) => r.member_id), [2, 3, 5]);
		const board = await html('/teams/10', 4);
		assert.equal(board.match(/One shared card/g)?.length, 1);
		assert.match(await html('/teams/10?subteam=1', 4), /One shared card/);
		assert.match(await html('/teams/10?subteam=2', 4), /One shared card/);
		assert.match(await html('/', 3), /One shared card/);
		assert.match(await html('/tasks', 4), /One shared card/);
		assert.match(await html('/people/3', 4), /One shared card/);
		assert.equal((await post(href + '/move', 4, { status: 'done', version: '1' })).status, 404);
		assert.match((await post(href + '/move', 3, { status: 'in_progress', version: '1' })).headers.get('location')!, /ok=saved/);
		assert.match((await post(href + '/move', 2, { status: 'done', version: '1' })).headers.get('location')!, /error=stale/);
		const mails = await Promise.all([request('/__test-reminders'), request('/__test-reminders')]);
		const runs = await Promise.all(mails.map((res) => res.json() as Promise<{ sent: number }>));
		assert.equal(runs.reduce((sum, run) => sum + run.sent, 0), 3);
		const rerun = await request('/__test-reminders');
		assert.equal((await rerun.json() as { sent: number }).sent, 0);
		assert.match((await post(href + '/move', 5, { status: 'done', version: '2' })).headers.get('location')!, /ok=saved/);
		assert.match(await html(href, 4), /<dt>Status<\/dt><dd>Done<\/dd>/);
		assert.match((await post(href + '/edit', 2, [['title', 'Edited card'], ['due', date], ['version', '3'], ['person', '3']])).headers.get('location')!, /ok=saved/);
		assert.match((await post(href + '/edit', 2, [['title', 'Stale edit'], ['due', date], ['version', '3'], ['person', '5']])).headers.get('location')!, /error=stale/);
		assert.equal((await db.prepare('SELECT member_id FROM board_task_recipients WHERE task_id = ?').bind(taskId).first())?.member_id, 3);
		const personal = await post('/teams/10/board', 3, { title: 'My task', due, person: '5', subteam: '2' });
		assert.match(await html(personal.headers.get('location')!, 4), /Assigned to<\/dt><dd>Ben<\/dd>/);
		const unassigned = await post('/teams/10/board', 1, { title: 'Claim this card', due });
		const claim = unassigned.headers.get('location')!.split('?')[0] + '/claim';
		assert.equal((await post(claim, 4, {})).status, 404);
		const claims = await Promise.all([post(claim, 2, {}), post(claim, 3, {})]);
		assert.equal(claims.filter((res) => res.headers.get('location')?.includes('ok=assigned-self')).length, 1);
		assert.match(await html('/tasks/50', 4), /Old action item/);
		assert.doesNotMatch(await html('/tasks/50', 4), /Restricted meeting/);
		assert.equal((await post('/tasks/50/board-move', 2, { status: 'done' })).status, 404);
		assert.equal((await request('/meetings/2', 4)).status, 404);
	});

	await t.test('meeting filters combine multiple teams and date comparisons', async () => {
		const both = await html('/meetings?team=10&team=11', 1);
		assert.match(both, /Product meeting/);
		assert.match(both, /Restricted meeting/);
		const product = await html('/meetings?team=10', 1);
		assert.match(product, /Product meeting/);
		assert.doesNotMatch(product, /Restricted meeting/);
		assert.match(await html('/meetings?date_mode=on&date=2020-01-01', 1), /Old meeting/);
		assert.doesNotMatch(await html('/meetings?date_mode=before&date=2020-01-01', 1), /Old meeting/);
		assert.doesNotMatch(await html('/meetings?date_mode=after&date=2020-01-01', 1), /Old meeting/);
		assert.match(await html('/meetings?date_mode=after&date=2020-01-01', 1), /Product meeting/);
	});

	await t.test('meeting stage tabs group preparation and follow-up with explicit selection', async () => {
		const preparation = await html('/meetings/1?view=preparation', 3);
		assert.match(preparation, /role="tablist" aria-label="Meeting stages"/);
		assert.match(preparation, /id="preparation-tab"[^>]*aria-selected="true"/);
		const prepContent = preparation.split('id="meeting-preparation"')[1].split('id="meeting-follow-up"')[0];
		assert.match(prepContent, /Existing agenda/);
		assert.match(prepContent, /Attachments/);
		assert.doesNotMatch(prepContent, /Existing notes|id="actions"/);
		const followUp = await html('/meetings/1?view=follow-up', 3);
		assert.match(followUp, /id="follow-up-tab"[^>]*aria-selected="true"/);
		assert.match(followUp, /id="meeting-preparation"[^>]*hidden/);
		const followContent = followUp.split('id="meeting-follow-up"')[1];
		assert.match(followContent, /Existing notes/);
		assert.match(followContent, /id="actions"/);
		assert.match(followContent, /Attendance/);
		assert.match(await html('/meetings/3', 3), /id="follow-up-tab"[^>]*aria-selected="true"/);
	});

	await t.test('agenda, speaker notes and private attachments preserve existing meeting records', async () => {
		const existingMeeting = await html('/meetings/1', 3);
		for (const text of ['Existing agenda', 'Existing notes', 'Existing feedback']) assert.ok(existingMeeting.includes(text));
		assert.match(await html('/f/synthetic-public-form'), /Existing feedback/);
		assert.match((await post('/meetings/1/agenda', 3, { title: 'Demo', notes: 'Speaker notes content', duration_minutes: '2' })).headers.get('location')!, /ok=created/);
		assert.match(await html('/meetings/1', 2), /Demo.*Speaker notes content/s);
		assert.equal((await post('/meetings/1/agenda/1/notes', 5, { notes: 'forged', version: '1' })).status, 404);
		assert.match((await post('/meetings/3/agenda', 3, { title: 'Past' })).headers.get('location')!, /error=forbidden/);
		await post('/meetings/1/agenda', 2, { title: 'Second', duration_minutes: '5' });
		assert.match((await post('/meetings/1/agenda/2/up', 1, { version: '1' })).headers.get('location')!, /ok=saved/);
		assert.match(await html('/meetings/1', 3), /Second.*Demo/s);
		const attachment = new FormData();
		const bytes = 'a'.repeat(1024 * 1024 + 12);
		attachment.set('agenda', '1');
		attachment.set('file', new File(['<script>unsafe</script>'], 'spoof.png', { type: 'image/png' }));
		assert.match((await request('/meetings/1/files', 3, attachment)).headers.get('location')!, /error=file/);
		attachment.set('file', new File([bytes], 'demo.txt', { type: 'text/plain' }));
		assert.match((await request('/meetings/1/files', 3, attachment)).headers.get('location')!, /ok=saved/);
		const file = await db.prepare('SELECT id FROM meeting_attachments').first<{ id: string }>();
		const href = `/meetings/1/files/${file!.id}`;
		assert.equal((await request(href, 4)).status, 404);
		assert.equal((await request(href)).status, 302);
		assert.equal((await request('/meetings/2/files/' + file!.id, 1)).status, 404);
		const download = await request(href, 3);
		assert.match(download.headers.get('content-disposition')!, /^attachment/);
		assert.equal(await download.text(), bytes);
		assert.match((await post('/meetings/1/agenda/1/remove', 3, { version: '2' })).headers.get('location')!, /ok=saved/);
		const afterRemoval = await html('/meetings/1', 3);
		for (const text of ['Existing notes', 'Speaker notes content', 'demo.txt']) assert.ok(afterRemoval.includes(text));
		assert.equal((await post(href + '/remove', 3, {})).status, 302);
		assert.equal((await request(href, 3)).status, 404);
		assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM meeting_attachment_chunks').first())?.n, 2);
	});

	await t.test('agenda duration is required, persisted and editable', async () => {
		for (const duration of ['', '0', '-1', '2.5', 'abc', '1441']) {
			assert.match((await post('/meetings/1/agenda', 3, { title: 'Invalid duration', duration_minutes: duration })).headers.get('location')!, /error=duration/);
		}
		assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM meeting_agenda WHERE title = 'Invalid duration'").first())?.n, 0);
		assert.match((await post('/meetings/1/agenda', 3, { title: 'Timed discussion', duration_minutes: '12' })).headers.get('location')!, /ok=created/);
		const item = await db.prepare("SELECT id, duration_minutes FROM meeting_agenda WHERE title = 'Timed discussion'").first<{ id: number; duration_minutes: number }>();
		assert.equal(item?.duration_minutes, 12);
		assert.match((await post(`/meetings/1/agenda/${item!.id}`, 3, { title: 'Timed discussion', duration_minutes: '4', version: '1' })).headers.get('location')!, /ok=saved/);
		assert.equal((await db.prepare('SELECT duration_minutes FROM meeting_agenda WHERE id = ?').bind(item!.id).first())?.duration_minutes, 4);
		const page = await html('/meetings/1', 3);
		assert.match(page, /agenda-duration">~4 min/);
		assert.match(page, /name="duration_minutes"[^>]*required[^>]*value="2"/);
	});

	await t.test('agenda creation saves an optional private attachment with its notes atomically', async () => {
		const form = new FormData();
		form.set('title', 'Agenda with document');
		form.set('duration_minutes', '7');
		form.set('notes', 'Notes linked to the same agenda');
		form.set('file', new File(['%PDF-1.4\nDemo document\n%%EOF'], 'slides.pdf', { type: 'application/pdf' }));
		assert.match((await request('/meetings/1/agenda', 3, form)).headers.get('location')!, /ok=created#agenda/);
		const saved = await db.prepare(`SELECT f.id, f.agenda_id, f.original_agenda_id, a.title, a.duration_minutes, n.body
		 FROM meeting_attachments f JOIN meeting_agenda a ON a.id = f.agenda_id
		 JOIN meeting_speaker_notes n ON n.agenda_id = a.id WHERE f.name = 'slides.pdf'`)
			.first<{ id: string; agenda_id: number; original_agenda_id: number; title: string; duration_minutes: number; body: string }>();
		assert.ok(saved);
		assert.equal(saved.title, 'Agenda with document');
		assert.equal(saved.duration_minutes, 7);
		assert.match(await html('/meetings/1', 3), /agenda-attachment.*agenda-duration">~7 min/s);
		assert.equal(saved.body, 'Notes linked to the same agenda');
		assert.equal(saved.agenda_id, saved.original_agenda_id);
		assert.equal(await (await request(`/meetings/1/files/${saved.id}`, 3)).text(), '%PDF-1.4\nDemo document\n%%EOF');
		assert.equal((await request(`/meetings/1/files/${saved.id}`, 4)).status, 404);
		form.set('title', 'Rejected attachment agenda');
		form.set('file', new File(['not a presentation'], 'bad.pptx'));
		assert.match((await request('/meetings/1/agenda', 3, form)).headers.get('location')!, /error=file#agenda/);
		assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM meeting_agenda WHERE title = 'Rejected attachment agenda'").first())?.n, 0);
		form.set('title', 'Empty optional attachment');
		form.set('file', new File([], ''));
		assert.match((await request('/meetings/1/agenda', 3, form)).headers.get('location')!, /ok=created#agenda/);
		const count = (await db.prepare('SELECT COUNT(*) AS n FROM meeting_agenda').first())?.n;
		// Metadata-only fixtures fill the storage budget without writing 64 MiB of bytes.
		for (let i = 0; i < 8; i++) await db.prepare(`INSERT INTO meeting_attachments
		 (id, meeting_id, original_meeting_id, author_id, name, media_type, size)
		 VALUES (?, 1, 1, 3, 'budget.txt', 'text/plain', 8388608)`).bind(`budget-${i}`).run();
		form.set('title', 'Full storage agenda');
		form.set('file', new File(['%PDF-1.4\n%%EOF'], 'full.pdf'));
		assert.match((await request('/meetings/1/agenda', 3, form)).headers.get('location')!, /error=file-space#agenda/);
		assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM meeting_agenda').first())?.n, count);
		assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM meeting_attachments WHERE name = 'full.pdf'").first())?.n, 0);
	});

	await t.test('all meeting viewers can contribute and edit attributed summaries after the meeting', async () => {
		assert.match((await post('/meetings/1/summary', 3, { body: 'Too early' })).headers.get('location')!, /error=forbidden/);
		assert.equal((await post('/meetings/3/summary', 4, { body: 'No access' })).status, 404);
		assert.equal((await request('/meetings/3/summary', undefined, new URLSearchParams({ body: 'Anonymous' }))).status, 302);
		for (const body of ['', '   ', 'x'.repeat(10001)]) {
			assert.match((await post('/meetings/3/summary', 3, { body })).headers.get('location')!, /error=summary/);
		}
		assert.match(await html('/meetings/3', 3), /aria-label="Add to meeting summary"/);
		assert.doesNotMatch(await html('/meetings/1', 3), /aria-label="Add to meeting summary"/);
		assert.match((await post('/meetings/3/summary', 3, { body: 'We agreed on the demo scope.', author_name: 'Forged author' })).headers.get('location')!, /view=follow-up&ok=created#summary/);
		const original = await db.prepare('SELECT * FROM meeting_summary_revisions WHERE meeting_id = 3').first<{ entry_id: string; version: number; body: string; author_name: string }>();
		assert.ok(original);
		assert.equal(original.author_name, 'Ben');
		const added = await html('/meetings/3', 2);
		assert.match(added, /We agreed on the demo scope/);
		assert.match(added, /Added by Ben/);
		assert.doesNotMatch(added, /Forged author/);
		assert.match((await post(`/meetings/3/summary/${original.entry_id}`, 2, { body: 'Updated with next steps.', version: '1' })).headers.get('location')!, /ok=saved/);
		assert.match((await post(`/meetings/3/summary/${original.entry_id}`, 3, { body: 'Stale overwrite', version: '1' })).headers.get('location')!, /error=stale/);
		assert.match((await post(`/meetings/1/summary/${original.entry_id}`, 3, { body: 'Wrong meeting', version: '2' })).headers.get('location')!, /error=forbidden/);
		const updated = await html('/meetings/3', 3);
		assert.match(updated, /Updated with next steps/);
		assert.match(updated, /Added by Ben/);
		assert.match(updated, /Edited by Ada/);
		assert.match(updated, /Edit history.*We agreed on the demo scope/s);
		assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM meeting_summary_revisions WHERE meeting_id = 3').first())?.n, 2);
	});

	await t.test('check-in preserves editor records and existing QR attendance', async () => {
		assert.match((await post('/meetings/1/check-in', 2, { status: 'late', member: '3' })).headers.get('location')!, /error=forbidden/);
		assert.equal((await post('/meetings/1/check-in', 4, { status: 'present' })).status, 404);
		assert.match((await post('/meetings/1/check-in', 3, { status: 'late', member: '2' })).headers.get('location')!, /ok=attendance/);
		assert.match(await html('/meetings/1', 3), /Attendance history.*Partial/s);
		await post('/meetings/1/attendance', 1, { att_3: 'absent' });
		assert.match((await post('/meetings/1/check-in', 3, { status: 'present' })).headers.get('location')!, /error=forbidden/);
		assert.equal((await request('/f/synthetic-public-form', undefined, new URLSearchParams({ name: 'Dee', email: 'dee@example.test' }))).status, 200);
		const rows = await db.prepare('SELECT member_id, status, self_report FROM attendance WHERE meeting_id = 1 ORDER BY member_id').all();
		assert.deepEqual(rows.results, [
			{ member_id: 2, status: 'excused', self_report: 0 },
			{ member_id: 3, status: 'absent', self_report: 0 },
			{ member_id: 5, status: 'present', self_report: 0 }
		]);
	});
});
