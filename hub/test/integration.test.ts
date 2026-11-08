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
	const request = async (path: string, member?: number, body?: URLSearchParams | FormData) => {
		const req = new Request(origin + path, {
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
		const signedIn = await request('/verify', undefined, new URLSearchParams({ email: 'cy@example.test', code, next: '/teams' }));
		assert.equal(signedIn.headers.get('location'), '/teams');
		assert.match(signedIn.headers.get('set-cookie')!, /hub_session=/);
		const teams = await html('/teams', 4);
		assert.match(teams, /href="\/teams\/10">Product/);
		assert.match(teams, /href="\/teams\/11">Finance/);
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

	await t.test('agenda, speaker notes and private attachments preserve existing meeting records', async () => {
		assert.match(await html('/meetings/1', 3), /Existing agenda.*Existing notes.*Existing feedback/s);
		assert.match(await html('/f/synthetic-public-form'), /Existing feedback/);
		assert.match((await post('/meetings/1/agenda', 3, { title: 'Demo', notes: 'Speaker notes content' })).headers.get('location')!, /ok=created/);
		assert.match(await html('/meetings/1', 2), /Demo.*Speaker notes content/s);
		assert.equal((await post('/meetings/1/agenda/1/notes', 5, { notes: 'forged', version: '1' })).status, 404);
		assert.match((await post('/meetings/3/agenda', 3, { title: 'Past' })).headers.get('location')!, /error=forbidden/);
		await post('/meetings/1/agenda', 2, { title: 'Second' });
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
		assert.match(await html('/meetings/1', 3), /Existing notes.*Speaker notes content.*demo\.txt/s);
		assert.equal((await post(href + '/remove', 3, {})).status, 302);
		assert.equal((await request(href, 3)).status, 404);
		assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM meeting_attachment_chunks').first())?.n, 2);
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
