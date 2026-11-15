import { Hono } from 'hono';
import { boardTasks } from '../board';
import { todayIn } from '../dates';
import { all, first, run, TASK_SELECT } from '../db';
import { id, isHttpUrl, list, readForm, str } from '../form';
import { isExec } from '../perm';
import type { AppEnv, Member, TaskRow, Team } from '../types';
import { Kanban } from '../views/board';
import { page } from '../views/layout';
import { Empty, Field, Markdown, MemberSelect, MembersDialog, PageHead, PostButton, Tabs } from '../views/ui';

export const teamPageRoutes = new Hono<AppEnv>();
export type Subteam = { id: number; team_id: number; name: string; description: string; archived: number };
export type RosterMember = Pick<Member, 'id' | 'name' | 'role' | 'available_hours'> & { is_lead: number; can_manage_page: number };

export function teamRoster(db: D1Database, team: number) {
	return all<RosterMember>(db, `SELECT m.id, m.name, m.role, m.available_hours, tm.is_lead, tm.can_manage_page
	 FROM team_members tm JOIN members m ON m.id = tm.member_id
	 WHERE tm.team_id = ? AND m.active = 1 ORDER BY m.name COLLATE NOCASE`, team);
}

export function teamSubteams(db: D1Database, team: number) {
	return all<Subteam>(db, 'SELECT * FROM subteams WHERE team_id = ? ORDER BY archived, name COLLATE NOCASE', team);
}

function rosterPanel(id: string, name: string, members: RosterMember[], grantPath?: string) {
	return (
		<MembersDialog id={id} name={name} count={members.length}>
			{members.length ? <ul class="team-members">{members.map((m) => (
				<li><a href={`/people/${m.id}`}>{m.name}</a> {m.is_lead ? <span class="tag lead">Lead</span> : null}
					{m.role === 'exec' && <span class="tag exec">Exec</span>}
					<span class="hint">{m.available_hours == null ? 'Hours not set' : `${m.available_hours} h/week`}</span>
					{m.can_manage_page ? <span class="tag">Page admin</span> : null}
					{grantPath && <PostButton action={`${grantPath}/${m.id}`} name="enabled" value={m.can_manage_page ? '0' : '1'}
						label={m.can_manage_page ? 'Remove page access' : 'Grant page access'} cls="btn small" />}
				</li>
			))}</ul> : <Empty>No members yet.</Empty>}
		</MembersDialog>
	);
}

async function canManagePage(db: D1Database, viewer: AppEnv['Variables']['viewer'], team: number) {
	return isExec(viewer) || !!await first(db, 'SELECT 1 FROM team_members WHERE team_id = ? AND member_id = ? AND can_manage_page = 1', team, viewer.id);
}

teamPageRoutes.get('/teams/:id', async (c) => {
	const v = c.get('viewer');
	const db = c.env.DB;
	const team = await first<Team>(db, 'SELECT * FROM teams WHERE id = ?', id(c.req.param('id')));
	if (!team) return c.notFound();
	const root = `/teams/${team.id}`;
	const subteamId = id(c.req.query('subteam'));
	const [members, subteams] = await Promise.all([teamRoster(db, team.id), teamSubteams(db, team.id)]);
	const editable = isExec(v) || members.some((m) => m.id === v.id && m.can_manage_page);
	const tabs = subteams.filter((s) => !s.archived || editable);
	const selected = tabs.find((s) => s.id === subteamId);
	if (subteamId && !selected) return c.notFound();
	const back = selected ? `${root}?subteam=${selected.id}` : root;
	const [tasks, legacy, subRoster] = await Promise.all([
		boardTasks(db, v.id, { team: team.id, subteam: selected?.id }),
		selected ? Promise.resolve([]) : all<TaskRow>(db, `${TASK_SELECT} WHERE t.team_id = ? ORDER BY t.due_date, t.id LIMIT 300`, team.id),
		selected ? all<{ member_id: number }>(db, 'SELECT member_id FROM subteam_members WHERE subteam_id = ?', selected.id) : Promise.resolve([])
	]);
	const subgroup = new Set(subRoster.map((m) => m.member_id));
	const canCreate = !team.archived && !selected?.archived && (isExec(v) || v.teamIds.has(team.id));
	const preset = selected && (isExec(v) || v.leadOf.has(team.id)) ? `?subteam=${selected.id}` : '';
	const resources = [['Discord', team.discord_url], ['Drive', team.drive_url], ['GitHub', team.github_url]].filter(([, url]) => url && isHttpUrl(url));
	return page(c, { title: team.name, active: 'teams' }, <>
		<PageHead eyebrow="Teams" title={team.name} sub={team.archived ? 'Archived' : undefined}
			actions={canCreate && <a class="btn primary" href={`${root}/board/new${preset}`}>New team task</a>} />
		<div class="stack">
			<Markdown text={team.description} empty="No team description yet." />
			{resources.length > 0 && <nav class="inline-tools" aria-label="Team links">{resources.map(([label, url]) =>
				<a class="btn small" href={url} target="_blank" rel="noopener noreferrer">{label} ↗</a>)}</nav>}
			{rosterPanel(`team-${team.id}-members`, team.name, members, isExec(v) ? `${root}/page-admins` : undefined)}
			{editable && (
				<details class="card">
					<summary class="link-btn">Team page settings</summary>
					<form class="form-grid" method="post" action={`${root}/profile`}>
						<Field label="What the team is working on" wide><textarea name="description" rows={3} maxlength={5000}>{team.description}</textarea></Field>
						<Field label="Discord"><input type="url" name="discord" value={team.discord_url ?? ''} maxlength={2048} /></Field>
						<Field label="Drive"><input type="url" name="drive" value={team.drive_url ?? ''} maxlength={2048} /></Field>
						<Field label="GitHub"><input type="url" name="github" value={team.github_url ?? ''} maxlength={2048} /></Field>
						<div class="wide"><button class="btn small primary">Save team page</button></div>
					</form>
					<form class="inline-tools" method="post" action={`${root}/subteams`}>
						<input name="name" maxlength={100} required placeholder="New subteam name" aria-label="New subteam name" />
						<button class="btn small">Create subteam</button>
					</form>
				</details>
			)}
			{tabs.length > 0 && <Tabs label="Team boards" current={selected?.id ?? null}
				options={[[null, 'All team tasks'], ...tabs.map((s): [number, string] => [s.id, s.name + (s.archived ? ' (Archived)' : '')])]}
				href={(value) => value === null ? root : `${root}?subteam=${value}`} />}
			{selected && (
				<section class="stack">
					<h2 class="section-title">{selected.name}</h2>
					<Markdown text={selected.description} empty="No subteam description yet." />
					{rosterPanel(`subteam-${selected.id}-members`, selected.name, members.filter((m) => subgroup.has(m.id)))}
					{editable && <details class="card">
						<summary class="link-btn">Subteam settings</summary>
						<form method="post" action={`${root}/subteams/${selected.id}`} class="stack">
							<Field label="Name"><input name="name" required maxlength={100} value={selected.name} /></Field>
							<Field label="What the subteam is working on"><textarea name="description" maxlength={5000} rows={3}>{selected.description}</textarea></Field>
							<label class="check"><input type="checkbox" name="archived" value="1" checked={!!selected.archived} /> Archived</label>
							<fieldset>
								<legend>Subteam members</legend>
								<div class="selection-grid">{members.map((m) => (
									<label class="check"><input type="checkbox" name="member" value={m.id} checked={subgroup.has(m.id)} /> {m.name}</label>
								))}</div>
							</fieldset>
							<div><button class="btn small primary">Save subteam</button></div>
						</form>
					</details>}
				</section>
			)}
			<h2 class="section-title">Task board</h2>
			<Kanban tasks={tasks} legacy={legacy} viewer={v} today={todayIn(c.env.TIMEZONE)} back={back} />
		</div>
	</>);
});

teamPageRoutes.post('/teams/:id/profile', async (c) => {
	const team = id(c.req.param('id'));
	if (!team || !await canManagePage(c.env.DB, c.get('viewer'), team)) return c.notFound();
	const form = await readForm(c);
	const links = [str(form.discord, 2048), str(form.drive, 2048), str(form.github, 2048)];
	const path = `/teams/${team}`;
	if (links.some((url) => url && (!isHttpUrl(url) || new URL(url).protocol !== 'https:'))) return c.redirect(`${path}?error=link`);
	await run(c.env.DB, 'UPDATE teams SET description = ?, discord_url = ?, drive_url = ?, github_url = ? WHERE id = ?', str(form.description), ...links, team);
	return c.redirect(`${path}?ok=saved`);
});

teamPageRoutes.post('/teams/:id/page-admins/:member', async (c) => {
	if (!isExec(c.get('viewer'))) return c.notFound();
	const team = id(c.req.param('id'));
	const member = id(c.req.param('member'));
	if (!team || !member) return c.notFound();
	const enabled = str((await readForm(c)).enabled);
	if (enabled !== '1' && enabled !== '0') return c.notFound();
	await run(c.env.DB, 'UPDATE team_members SET can_manage_page = ? WHERE team_id = ? AND member_id = ?', Number(enabled), team, member);
	return c.redirect(`/teams/${team}?ok=saved`);
});

teamPageRoutes.post('/teams/:id/subteams', async (c) => {
	const team = id(c.req.param('id'));
	if (!team || !await canManagePage(c.env.DB, c.get('viewer'), team)) return c.notFound();
	const form = await readForm(c);
	const name = str(form.name, 100);
	if (!name) return c.redirect(`/teams/${team}?error=missing`);
	const result = await run(c.env.DB, `INSERT INTO subteams (team_id, name)
	 SELECT id, ? FROM teams WHERE id = ? ON CONFLICT (team_id, name) DO NOTHING`, name, team);
	return c.redirect(result.meta.changes ? `/teams/${team}?subteam=${result.meta.last_row_id}&ok=created` : `/teams/${team}?error=exists`);
});

teamPageRoutes.post('/teams/:id/subteams/:subteam', async (c) => {
	const team = id(c.req.param('id'));
	const subteam = id(c.req.param('subteam'));
	const db = c.env.DB;
	if (!team || !subteam || !await canManagePage(db, c.get('viewer'), team)
		|| !await first(db, 'SELECT 1 FROM subteams WHERE id = ? AND team_id = ?', subteam, team)) return c.notFound();
	const path = `/teams/${team}?subteam=${subteam}`;
	const form = await readForm(c);
	const name = str(form.name, 100);
	if (!name) return c.redirect(`${path}&error=missing`);
	if (await first(db, 'SELECT 1 FROM subteams WHERE team_id = ? AND name = ? AND id != ?', team, name, subteam)) return c.redirect(`${path}&error=exists`);
	const members = [...new Set(list(form.member).map(id))];
	const eligible = new Set((await teamRoster(db, team)).map((m) => m.id));
	if (members.some((m) => m === null || !eligible.has(m))) return c.redirect(`${path}&error=selection`);
	await db.batch([
		db.prepare('UPDATE subteams SET name = ?, description = ?, archived = ? WHERE id = ? AND team_id = ?')
			.bind(name, str(form.description), str(form.archived) === '1' ? 1 : 0, subteam, team),
		db.prepare(`DELETE FROM subteam_members WHERE subteam_id = ?
		 AND member_id IN (SELECT id FROM members WHERE active = 1)
		 AND member_id NOT IN (SELECT value FROM json_each(?))`).bind(subteam, JSON.stringify(members)),
		db.prepare(`INSERT INTO subteam_members (subteam_id, team_id, member_id)
		 SELECT ?, ?, value FROM json_each(?) WHERE 1 ON CONFLICT (subteam_id, member_id) DO NOTHING`).bind(subteam, team, JSON.stringify(members))
	]);
	return c.redirect(`${path}&ok=saved`);
});
