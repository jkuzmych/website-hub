# Agentic AI UW Hub

Task and meeting tracker for the club, live at https://hub.agenticaiuw.com.

- **Tasks** have one assignee and a due date. People are emailed when a task is assigned, and reminded until it's done.
- **Meetings** (exec and project) keep the agenda, notes, who attended and the action items that came out of them.
- **Forms**: a meeting can have one (feedback, say) that people open from a QR code without signing in. Show on screen puts the QR code and a live count on the projector; roster members who fill it out are checked off as there.
- **People** shows execs who has open and overdue work and each person's attendance.

Sign-in uses a six-digit email code. Signed-in roster members can see all teams and tasks. Meetings retain their existing access rules.

- Open **Teams** to see team and subteam boards, links, rosters and members' available hours. Set your hours on **My work**.
- Team board cards have a shared status and can be assigned to people, subteams, or both. Team members can claim an unassigned card. The original Tasks form still supports independent assignments. The morning reminder combines both types of work.
- Meetings support structured agenda items, speaker notes and private attachments up to 8 MiB. Members can check in as Here or Partial during eligible meetings. Meeting editors and existing QR forms retain their attendance controls.

## Reminders

Every morning at 9 AM Central, each person gets at most one email listing their tasks:

- 2 days before the due date, once
- on the due date
- every day for the first 3 days overdue, then every 3 days
- at 3 days overdue, whoever assigned the task gets one follow-up email
- Monday mornings, execs get a digest of everything overdue
- tasks marked Urgent also get reminders from 7 PM the evening they're due, then every 2 hours while overdue, except 1–8 AM

Every email has a one-click "Mark done" link. Exec → Email shows the log and can run reminders on demand.

## Setup still needed

1. **Email password.** Sign in to team@agenticaiuw.com, turn on 2-Step Verification, create an app password at https://myaccount.google.com/apppasswords, then run `npx wrangler secret put SMTP_PASSWORD` here and paste it. Until then no email goes out, including sign-in codes.
2. **SPF record**, so club mail isn't marked as spam. In Cloudflare DNS for agenticaiuw.com, add a TXT record on `@`: `v=spf1 include:_spf.google.com ~all`.
3. **First sign-in** at https://hub.agenticaiuw.com with eliu59@wisc.edu (already an exec) or team@agenticaiuw.com; both are bootstrap admins in `ADMIN_EMAILS`. Add the execs on the People page (`Name, email, exec`, one per line). Turn off the club account on its profile page so it doesn't appear in attendance.

## Development

### Local demo with fictional users

The local Worker uses a persistent SQLite database in `.wrangler/state/`, separate from production D1. To populate it with fictional users, team/subteam rosters, board cards, individual tasks, meetings and attendance:

```sh
npm run db:migrate:local
npm run db:seed:local
npm run dev:local
```

Open http://localhost:8788. Use `exec@example.test` (executive), `lead@example.test` (team lead), or `member@example.test` (ordinary member). The sign-in code appears on the next page in local mode, and all emails are logged locally. Use separate browser profiles or a private window to compare roles side by side; windows in the same profile share a login. Demo teams are prefixed `Demo -`. Seeding is additive and can be repeated without overwriting existing data or demo edits. Relative dates are set on the first seed. The seed command always targets `--local`; never load these fictional fixtures into production.

```
npm install
npm run db:migrate:local
npm run dev        # http://localhost:8787, emails are logged instead of sent
npm test
npm run typecheck
npm run deploy
```

Schema changes go in a new file in `migrations/`. Apply migrations 0011 through 0013 before serving the team board and meeting additions. `npm test` starts a loopback Worker with a disposable D1 database under `.wrangler/` and logs synthetic email locally.

`import/fall-2026-exec-history.sql` loads the fall 2026 exec meetings and attendance from the club Drive. Run it once the execs are on the roster:

```
npx wrangler d1 execute agenticaiuw-hub --remote --file import/fall-2026-exec-history.sql
```
