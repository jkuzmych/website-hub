// Fictional fixtures only. Always executes against Wrangler's LOCAL database.
// Additive and repeatable: existing records and edits are never overwritten.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = [];
const member = (email) => `(SELECT id FROM members WHERE email = ${q(email)})`;
const team = (name) => `(SELECT id FROM teams WHERE name = ${q(name)})`;
const users = [
  ['Alex Demo', 'exec@example.test', 'exec', 'Demo executive', 8],
  ['Jordan Demo', 'lead@example.test', 'member', 'Demo team lead', 6],
  ['Sam Demo', 'member@example.test', 'member', 'Demo developer', 4],
  ['Taylor Demo', 'research@example.test', 'member', 'Demo researcher', 5],
  ['Casey Demo', 'design@example.test', 'member', 'Demo designer', 3],
  ['Morgan Demo', 'new@example.test', 'member', 'Demo new member', 2],
  ['Riley Demo', 'lead2@example.test', 'member', 'Demo research lead', 7],
  ['Avery Demo', 'member2@example.test', 'member', 'Demo developer', 4],
];
for (const [name, email, role, title, hours] of users) {
  sql.push(`INSERT INTO members(name,email,role,title,available_hours) SELECT ${q(name)},${q(email)},${q(role)},${q(title)},${hours} WHERE NOT EXISTS(SELECT 1 FROM members WHERE email=${q(email)});`);
}
const teams = ['Demo - Product Engineering', 'Demo - Research'];
for (const name of teams) {
  sql.push(`INSERT INTO teams(name,kind,description) SELECT ${q(name)},'project','Fictional local demo data. Safe to edit while exploring the app.' WHERE NOT EXISTS(SELECT 1 FROM teams WHERE name=${q(name)});`);
  for (const [, email] of users) {
    const lead = email === (name === teams[0] ? 'lead@example.test' : 'lead2@example.test');
    sql.push(`INSERT OR IGNORE INTO team_members(team_id,member_id,is_lead) VALUES(${team(name)},${member(email)},${lead ? 1 : 0});`);
  }
}
const subteams = [['Frontend', teams[0]], ['Backend', teams[0]], ['Evaluation', teams[1]]];
for (const [name, parent] of subteams) {
  sql.push(`INSERT OR IGNORE INTO subteams(team_id,name,description) VALUES(${team(parent)},${q(name)},'Demo subteam for local testing');`);
  for (const email of ['member@example.test', 'design@example.test', 'research@example.test']) {
    sql.push(`INSERT OR IGNORE INTO subteam_members(subteam_id,team_id,member_id) SELECT id,team_id,${member(email)} FROM subteams WHERE team_id=${team(parent)} AND name=${q(name)};`);
  }
}
const titles = ['Build sign-in screen', 'Review task board design', 'Connect task API', 'Improve mobile navigation', 'Document onboarding', 'Test keyboard navigation', 'Compare retrieval methods', 'Prepare evaluation dataset', 'Review experiment results', 'Write research summary', 'Plan next sprint', 'Explore accessibility options'];
for (let i = 0; i < titles.length; i++) {
  const id = `local-demo-${String(i + 1).padStart(2, '0')}`;
  const parent = teams[i < 6 ? 0 : 1];
  const status = ['open', 'in_progress', 'done', 'open'][i % 4];
  const offset = [-3, -1, 0, 2, 5, 9][i % 6];
  sql.push(`INSERT OR IGNORE INTO board_tasks(id,team_id,created_by,title,details,due_date,status) VALUES(${q(id)},${team(parent)},${member('exec@example.test')},${q(titles[i])},'Fictional demo card. Try assigning people, moving status, and adding comments.',date('now','${offset} days'),${q(status)});`);
  if (i % 4 !== 3) {
    const email = users[2 + (i % 4)][1];
    sql.push(`INSERT OR IGNORE INTO board_task_people(task_id,team_id,member_id) VALUES(${q(id)},${team(parent)},${member(email)});`);
  }
  if (i % 3 === 0) {
    const sub = i < 6 ? 'Frontend' : 'Evaluation';
    sql.push(`INSERT OR IGNORE INTO board_task_subteams(task_id,team_id,subteam_id) SELECT ${q(id)},team_id,id FROM subteams WHERE team_id=${team(parent)} AND name=${q(sub)};`);
  }
  if (i < 6) {
    const title = `Demo - Follow up ${i + 1}`;
    sql.push(`INSERT INTO tasks(title,details,assignee_id,assigned_by,team_id,due_date,status) SELECT ${q(title)},'Fictional individual assignment',${member(users[i + 2][1])},${member('exec@example.test')},${team(parent)},date('now','${offset} days'),'open' WHERE NOT EXISTS(SELECT 1 FROM tasks WHERE title=${q(title)} AND team_id=${team(parent)});`);
  }
}
for (const [index, offset] of [-7, 0, 3].entries()) {
  const title = ['Demo - Previous sprint review', 'Demo - Team working session', 'Demo - Upcoming planning'][index];
  sql.push(`INSERT INTO meetings(team_id,title,date,time,end_time,location,agenda,notes,created_by) SELECT ${team(teams[0])},${q(title)},date('now','${offset} days'),'14:00','15:00','Demo meeting room','','',${member('exec@example.test')} WHERE NOT EXISTS(SELECT 1 FROM meetings WHERE title=${q(title)} AND team_id=${team(teams[0])});`);
  sql.push(`INSERT OR IGNORE INTO meeting_teams(meeting_id,team_id) SELECT id,team_id FROM meetings WHERE title=${q(title)} AND team_id=${team(teams[0])};`);
  if (index === 0) {
    for (const [i, [, email]] of users.entries()) {
      sql.push(`INSERT OR IGNORE INTO attendance(meeting_id,member_id,status) SELECT id,${member(email)},${q(['present', 'late', 'absent', 'excused'][i % 4])} FROM meetings WHERE title=${q(title)} AND team_id=${team(teams[0])};`);
    }
  }
}
mkdirSync('.wrangler/demo', { recursive: true });
writeFileSync('.wrangler/demo/seed.sql', sql.join('\n'));
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'd1', 'execute', 'agenticaiuw-hub', '--local', '--file', '.wrangler/demo/seed.sql'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (!process.exitCode) console.log('Demo data ready. Sign in locally as exec@example.test, lead@example.test, or member@example.test.');
