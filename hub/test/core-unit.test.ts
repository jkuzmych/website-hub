import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { id, isEmail, isHttpUrl, list, str, withNotice } from '../src/form.ts';
import { addDays, daysBetween, dueLabel, formatTimeRange, isDate, isTime } from '../src/dates.ts';

// Bundle modules with extensionless Worker imports in memory; no files or services are needed.
async function load(path: string): Promise<any> {
	const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
	return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}

test('subteam cards link to their pages and respect archived visibility', async () => {
	const { SubteamCards } = await load('src/routes/team-pages.tsx');
	const subteams = [
		{ id: 12, team_id: 7, name: 'Design & Research', description: '', archived: 0 },
		{ id: 19, team_id: 7, name: 'Old group', description: '', archived: 1 }
	];
	const viewer = String(SubteamCards({ root: '/teams/7', subteams, members: [], subRoster: [], editable: false }));
	assert.match(viewer, /href="\/teams\/7\/subteams\/12"/);
	assert.match(viewer, /Design &amp; Research/);
	assert.doesNotMatch(viewer, /Old group|Add subteam/);
	const admin = String(SubteamCards({ root: '/teams/7', subteams, members: [], subRoster: [], editable: true }));
	assert.match(admin, /Old group/);
	assert.match(admin, /action="\/teams\/7\/subteams"/);
	assert.match(admin, /data-members-dialog="new-subteam"/);
});

test('team subteam lookup binds the requested team ID', async () => {
	const { teamSubteams } = await load('src/routes/team-pages.tsx');
	let bound: unknown;
	let query = '';
	const rows = [{ id: 31, team_id: 7, name: 'New group' }];
	const db = { prepare(sql: string) { query = sql; return { bind(value: unknown) { bound = value; return { all: async () => ({ results: rows }) }; } }; } };
	assert.deepEqual(await teamSubteams(db, 7), rows);
	assert.match(query, /WHERE team_id = \?/);
	assert.equal(bound, 7);
});

test('form parsing validates IDs, repeated values, email and URL protocols', () => {
	assert.equal(str(['  hello  ', 'ignored'], 3), 'hel');
	assert.deepEqual(list([' A ', '', 5]), ['A', '', '']);
	for (const value of ['', '0', '-1', '1.5', 'abc']) assert.equal(id(value), null);
	assert.equal(id('42'), 42);
	assert.equal(isEmail('person@example.org'), true);
	assert.equal(isEmail('a@example.org,b@example.org'), false);
	assert.equal(isHttpUrl('https://example.org/path'), true);
	assert.equal(isHttpUrl('javascript:alert(1)'), false);
	assert.equal(withNotice('/tasks?team=2&error=old', 'ok', 'saved'), '/tasks?team=2&ok=saved');
});

test('date and due-date boundaries handle leap days and invalid times', () => {
	assert.equal(isDate('2024-02-29'), true);
	assert.equal(isDate('2025-02-29'), false);
	assert.equal(isTime('23:59'), true);
	assert.equal(isTime('24:00'), false);
	assert.equal(addDays('2024-02-28', 2), '2024-03-01');
	assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
	assert.deepEqual(dueLabel('2026-01-01', '2026-01-02'), { text: '1 day overdue', tone: 'overdue' });
	assert.equal(dueLabel('2026-01-02', '2026-01-02').tone, 'today');
	assert.equal(dueLabel('2026-01-09', '2026-01-02').tone, 'later');
	assert.equal(formatTimeRange('11:30', '12:30'), '11:30 AM–12:30 PM');
});

test('meeting timing and attachment signatures reject misleading files', async () => {
	const { meetingTiming, meetingFileType, FILE_LIMIT } = await load('src/meeting-content.ts');
	const m = { date: '2026-06-01', time: '10:00', end_time: '11:00' };
	assert.deepEqual(meetingTiming(m, 'America/Chicago', new Date('2026-06-01T15:30:00Z')), { started: true, ended: false });
	assert.deepEqual(meetingTiming(m, 'America/Chicago', new Date('2026-06-01T16:00:00Z')), { started: true, ended: true });
	const bytes = (value: string) => new TextEncoder().encode(value).buffer;
	assert.equal(meetingFileType('notes.txt', bytes('hello')), 'text/plain');
	assert.equal(meetingFileType('bad.txt', new Uint8Array([255]).buffer), null);
	assert.equal(meetingFileType('image.png', bytes('<script>')), null);
	assert.equal(meetingFileType('../notes.txt', bytes('hello')), null);
	assert.equal(meetingFileType('large.txt', new Uint8Array(FILE_LIMIT + 1).buffer), null);
	assert.equal(meetingFileType('document.pdf', bytes('%PDF-1.7')), 'application/pdf');
});

test('oversized meeting uploads return a useful error for both upload forms', async () => {
	const { meetingUploadLimit } = await load('src/routes/meeting-content.tsx');
	for (const section of ['agenda', 'files']) {
		const raw = new Request('http://localhost/', { method: 'POST', body: 'x', headers: { 'content-length': String(8 * 1024 * 1024 + 65537) } });
		const context = { req: { raw, param: () => '3' }, redirect: (url: string) => url };
		const result = await meetingUploadLimit(section)(context, () => { throw new Error('oversized request passed'); });
		assert.equal(result, `/meetings/3?error=file#${section}`);
	}
});

test('task and meeting permissions distinguish members, leads and execs', async () => {
	const p = await load('src/perm.ts');
	const member = { id: 2, role: 'member', teamIds: new Set([10]), leadOf: new Set() };
	const lead = { ...member, leadOf: new Set([10]) };
	const exec = { ...member, id: 1, role: 'exec', leadOf: new Set(), teamIds: new Set() };
	const task = { assigned_by: 3, assignee_id: 4, team_id: 10, team_kind: 'project' };
	assert.equal(p.canSeeTask(member, task), true);
	assert.equal(p.canManageTask(member, task), false);
	assert.equal(p.canManageTask(lead, task), true);
	assert.equal(p.canCompleteTask(lead, task), false);
	assert.equal(p.canCompleteTask(exec, task), true);
	assert.equal(p.canSeeTask(member, { ...task, team_kind: 'exec' }), false);
	const meeting = { team_id: 10, team_name: 'Team', team_kind: 'project', teams_json: '[]', created_by: 3, kind: 'meeting' };
	assert.equal(p.canSeeMeeting(member, meeting, false), true);
	assert.equal(p.canEditMeeting(member, meeting), false);
	assert.equal(p.canEditMeeting(lead, meeting), true);
	assert.equal(p.canSeeMeeting({ ...member, teamIds: new Set() }, meeting, false), false);
	assert.equal(p.canSeeMeeting(member, { ...meeting, team_kind: 'exec' }, true), true);
});

test('login redirects and signed task links reject tampering', async () => {
	const auth = await load('src/auth.ts');
	assert.equal(auth.safeRedirect('/teams?x=1'), '/teams?x=1');
	for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example']) assert.equal(auth.safeRedirect(path), '/');
	const env = { APP_SECRET: 'test-secret' };
	const token = await auth.signDoneLink(env, 12, 34);
	assert.deepEqual(await auth.verifyDoneLink(env, token), { taskId: 12, memberId: 34 });
	assert.equal(await auth.verifyDoneLink(env, token.replace(/^12\./, '13.')), null);
	assert.equal(await auth.verifyDoneLink({ APP_SECRET: 'wrong' }, token), null);
	assert.equal(await auth.verifyDoneLink(env, '12.34.1.invalid'), null);
});
