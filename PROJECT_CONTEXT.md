# Agentic AI UW website project context

Read the baseline and application map first in a new session. Load the sections that match your task. For integration work, also read the standalone tracker context and the comparison below. Use source to confirm behavior and the linked READMEs for setup. Record source revisions and verified deployments separately.

## Hub team boards and meeting records

The integration lives in the existing Hub Worker. D1 migrations 0011 through 0013 add availability, meeting records and team boards. The Hub remains the account and sign-in authority. Apply migrations before serving this source. The source change has been exercised against disposable D1.

- Signed-in members can open all team pages and read all tasks. Members can move cards they are assigned to directly or through a subteam and can claim unassigned cards on their own teams. Execs can move any card. Execs and team leads retain authority to assign other people on their teams. Execs can delegate team page settings and subteam management without granting account, task assignment or global admin rights.
- Team pages show the main description, resource links, expandable rosters with weekly availability, and Kanban boards. A shared card can target several people and several subteams on one team. Each subteam tab shows cards assigned to it. The main board, Tasks, My work and person pages link to the same card and status. Individual assignments created through the original task flow retain their separate records and reminders. The daily reminder run deduplicates shared-card recipients across direct and subteam membership.
- Hub meeting access applies to agenda items, speaker notes and downloads. Meeting editors can manage them. Before the meeting ends, ordinary viewers can add agenda items and edit their own items and notes. Removing an agenda item retains its notes and attachments on the meeting. Existing Markdown fields, reminders and public QR forms continue through their original routes.
- Eligible members can check in as Here or Partial during the meeting. If a meeting has no end time, check-in closes at the end of its Central Time date. An editor or QR attendance mark takes precedence. Attendance history only includes meetings the viewer can read and uses the Hub's expected roster for each meeting.
- Attachments use authenticated D1 reads and a transactional write in 1 MiB chunks. Files are capped at 8 MiB each, 64 MiB per meeting and 256 MiB overall, including recoverable removals. The metadata retains the original meeting and agenda IDs after removal. The standalone tracker used a larger per-file limit on PostgreSQL. D1's [row and storage limits](https://developers.cloudflare.com/d1/platform/limits/) govern this adaptation.

Implementation entry points include [team pages](hub/src/routes/team-pages.tsx), [shared card routes](hub/src/routes/board-tasks.tsx), [meeting content routes](hub/src/routes/meeting-content.tsx), [attendance](hub/src/routes/meetings.tsx), [reminders](hub/src/reminders.ts) and the [local Worker integration test](hub/test/integration.test.ts).

## Source baseline before the integration

- `39f1c698938a479b49bb4e35844a9934a1b26d70` (November 6, 2026) is the source baseline for this context. The Hub now uses one people picker for tasks and meetings. Joint meetings use `meeting_teams` (migration 0009), while `meeting_skips` (0010) records deselected team members for the expected roster and notifications. The primary `meetings.team_id` still supports event ownership and action item defaults. Meeting creation can send a BCC announcement. Task creation prefers the first selected team each assignee belongs to, with fallback rules in the task route.
- `906a54e` put the public website and the Hub in one repository. They have separate manifests, lockfiles, build commands and deployment targets. This context describes the local checkout. The running revision, applied remote migrations and email setup have not been verified.

## Purpose and stack

| Path from this repo root | Role | Documented host | Stack |
| --- | --- | --- | --- |
| [`website/`](website/README.md) | Public club information, project and team descriptions, events, partnerships and joining | `agenticaiuw.com` | Static SvelteKit with Svelte 5, TypeScript, Tailwind, Vite, GSAP, Spline and Three.js on Cloudflare Pages |
| [`hub/`](hub/README.md) | Member operations, including tasks, meetings, attendance and forms | `hub.agenticaiuw.com` | Hono with server-rendered JSX, static JS/CSS, Cloudflare Workers, D1 and Wrangler |

## Public website

- Public pages are Home, Teams, Events, Partners, Join and FAQ. Join directs visitors to board members' office hours and Discord. Partners uses an email link. The footer's Member Hub link points to the Cloudflare Hub.
- Edit shared copy, links, roster and FAQs in [`src/lib/content.ts`](website/src/lib/content.ts). The Hivemind narrative lives in [`src/lib/hivemind.ts`](website/src/lib/hivemind.ts) and [`HivemindOverview.svelte`](website/src/lib/components/HivemindOverview.svelte). Treat the wristband, cross-device recovery and context permissions as proposed product capabilities. Semester goals are targets.
- [`src/app.css`](website/src/app.css) holds shared theme tokens and [`src/app.html`](website/src/app.html) initializes the theme before paint. Preserve both themes, keyboard access, mobile content and reduced-motion behavior.
- The Teams orbit uses the local Spline scene at widths of 780px and up and a list below that threshold. [`SubteamOrbit.svelte`](website/src/lib/components/SubteamOrbit.svelte) owns interaction and [`subteamRobot.ts`](website/src/lib/animation/subteamRobot.ts) owns the pose and renderer. Preserve the scene and matching local WASM files with the locked runtime. Recheck the robot when replacing the scene or upgrading Spline because its controller uses private runtime interfaces.

### Public route and content map

| URL | Where behavior lives | Contract to preserve |
| --- | --- | --- |
| `/` | [`+page.svelte`](website/src/routes/+page.svelte), [`Hub.svelte`](website/src/lib/components/Hub.svelte) | Public home with club positioning, animated agent graph, press feature, founding board and organization metadata. The component named `Hub.svelte` belongs to the homepage. |
| `/teams/` | [Teams route](website/src/routes/teams/+page.svelte), [`Work.svelte`](website/src/lib/sections/Work.svelte) | Hivemind overview, semester targets and seven public subteams. `#subteams` is on the rendered wrapper on desktop and mobile. Public team descriptions are authored in source. |
| `/events/` | [`Events.svelte`](website/src/lib/sections/Events.svelte), [`content.ts`](website/src/lib/content.ts) | Authored public event list. The prerendered upcoming/past split updates at browser mount using Chicago dates and an event's end date when supplied. This is separate from Hub meetings and events. |
| `/partners/`, `/join/`, `/faq/` | [Partners](website/src/routes/partners/+page.svelte), [Join](website/src/routes/join/+page.svelte), [FAQ](website/src/routes/faq/+page.svelte) | Partnership email link, per-lead booking links and Discord, and FAQ content with structured metadata. |
| `/sitemap.xml`, `/llms.txt`, `/robots.txt` | [Sitemap route](website/src/routes/sitemap.xml/+server.ts), [plain-text route](website/src/routes/llms.txt/+server.ts), [robots file](website/static/robots.txt) | Public crawl and discovery surfaces. The generated text briefing includes the Member Hub link. Review these surfaces if domains, routes or published content change. |

- [The root layout](website/src/routes/+layout.svelte) owns navigation, footer, canonical links and motion initialization. [`+layout.ts`](website/src/routes/+layout.ts) sets prerendering and trailing slashes. [`seo.ts`](website/src/lib/seo.ts) and [`Meta.svelte`](website/src/lib/components/Meta.svelte) supply canonical-domain constants, structured data and social previews. Legacy paths `/premise` and `/why-now` redirect home, `/who-fits` to Join, `/work` to Teams and `/contact` to Partners.
- The public site has no member session or runtime database dependency. Its Member Hub handoff is a normal external link from the footer and is also represented in the public text briefing. Changing that destination is a separate product decision from joining the Git histories.
- The public theme defaults dark and persists under the `theme` local-storage key. GSAP motion and WebGL decorations are scoped to the public site. The robot's documented sequence is a six-second opening, a 1.4-second settle, then a five-second team dwell. Reduced motion skips the opening and autoplay. Use [ROBOT-MOTION.md](website/ROBOT-MOTION.md) for the rig and renderer details.

## Member Hub

- [`src/index.tsx`](hub/src/index.tsx) registers auth and public form routes before the active-member gate. [`src/auth.ts`](hub/src/auth.ts) handles roster-based email codes, hashed sessions and signed task completion links. The `hub_session` cookie spans `agenticaiuw.com` subdomains in production. Review dependent apps before changing its scope or sign-in redirects.
- [`src/perm.ts`](hub/src/perm.ts) and the route handlers define the actual permissions. Execs and team leads can assign work and schedule meetings, with different team scopes. Task access can come from management, assignment or project membership. Meeting access can come from management, event visibility, invitation, attendance or project membership. Preserve server-side checks for reads and writes.
- Individual task records have one assignee per row. Meetings and events support agendas, notes, attendance, action items, recurring series and QR-accessible forms. The public `/f/:token` routes collect responses without a member session. Form management, response lists and CSV exports have separate server-side access checks.
- [`src/schedule.ts`](hub/src/schedule.ts) computes reminder timing, [`src/reminders.ts`](hub/src/reminders.ts) selects recipients and sends notifications, and [`src/mail.ts`](hub/src/mail.ts) handles SMTP and the email log. The Worker cron wakes hourly and uses club-local Central Time for daily and urgent task reminders, the Monday exec digest and meeting reminders. Use `DEV_MODE` with fake recipients for local mail flows because it logs email contents, including sign-in codes.

### Hub entry points and authorization

| Surface | Source | Existing behavior |
| --- | --- | --- |
| `/login`, `/verify`, `/logout` | [Auth routes](hub/src/routes/auth.tsx), [auth helpers](hub/src/auth.ts) | Six-digit, single-use email codes expire after ten minutes. Issuance and attempts are bounded. Active roster members can sign in. Configured bootstrap emails can create exec entries. Sessions last 60 days and D1 stores token hashes. |
| `/done` | [Auth routes](hub/src/routes/auth.tsx) | A signed link is bound to the task, assignee and expiry. GET shows confirmation. POST rechecks the token and current assignee before closing an open task. Existing emails contain URLs generated from `APP_URL`. |
| `/`, `/tasks`, `/tasks/:id` | [Home](hub/src/routes/home.tsx), [Tasks](hub/src/routes/tasks.tsx) | Member dashboard, task list, create/edit, status and comments. Members can assign work to themselves. Execs and leads can assign to others subject to route checks. Assignee or manager can complete. One row per assignee means shared progress derives from multiple records. |
| `/meetings`, `/meetings/:id` | [Meetings](hub/src/routes/meetings.tsx) | Team meetings, club events, recurring series, notes, attendance and action items. Editors include execs, creator and leads of participating teams. Invitations and attendance affect visibility. Events are visible to signed-in members. |
| `/f/:token`, `/meetings/:id/form/*` | [Forms](hub/src/routes/forms.tsx) | Public form GET and POST use a token. A form can be closed. The public view exposes the meeting title and date. It takes a name and email, upserts by form/email, and marks an active matched roster member present if attendance is unset. That email match carries no proof of identity. Projector screen, response count, results and CSV require meeting edit rights. |
| `/people`, `/teams`, `/email` | [People and teams](hub/src/routes/people.tsx), [Exec email](hub/src/routes/admin.tsx) | Roster and team operations, role and lead management, and exec-only email log and send controls. Team leadership is separate from exec status. |

- [`src/db.ts`](hub/src/db.ts) implements list visibility and expected-attendee queries. [`src/perm.ts`](hub/src/perm.ts) checks individual records. Review both when porting access. In particular, `meeting_skips` filters the expected roster and notifications. It does not revoke the project-membership visibility path. Club event notifications can reach the active roster.
- The Hub serves server-rendered pages via [`src/views/layout.tsx`](hub/src/views/layout.tsx). Shared controls live in [`src/views/ui.tsx`](hub/src/views/ui.tsx), with browser behavior in [`public/app.js`](hub/public/app.js) and styling in [`public/styles.css`](hub/public/styles.css). Its forms use same-site posts. Global middleware rejects mismatched Origin or cross-site fetch metadata for mutations when those headers are supplied, and sets no-store and frame-denial headers.
- The Hub shares `hub_session` across the club's domain and explicitly allows return destinations for `game.agenticaiuw.com/host` and `feedback.agenticaiuw.com/panel`. Source establishes this contract. Confirm which apps actually depend on it before changing login or retiring the Worker.

### Hub data and side effects

| Records | Model in the reviewed migrations | What needs a decision if moved |
| --- | --- | --- |
| Members and teams | Integer IDs, case-insensitive unique roster email, `exec` or `member`, active state, team kind, and a lead flag per membership. | How identities are matched and approved, which team memberships and leads carry forward, and who can view historical records. |
| Tasks and history | Integer task IDs, one required assignee and due date, optional assigner/team/meeting, `open`, `done` or `dropped`, `group_id` for related copies, comments and activity. | Whether grouped tasks remain separate, how statuses translate, and how attribution, due dates, meeting links and reminder state carry over. |
| Meetings and attendance | Integer meeting IDs, club-local date and time fields, primary and joint teams, series, agenda and notes text, invite and skip rows, and attendance statuses `present`, `late`, `excused`, `absent`. | Handling missing times, recurrence, time zone conversion, role-based visibility, expected versus recorded attendance and history. |
| Forms and responses | One form per meeting, unique public token, questions and answers stored as JSON text, one response per email per form, optional roster link. | Old QR URLs, public submission behavior, token handling, response privacy, historical snapshots and attendance side effects. |
| Sessions, login codes, mail and scheduler state | Hashed session tokens, keyed code hashes, `email_log`, `meta`, and reminder markers on tasks and meetings. | Preserve audit and notification behavior while issuing credentials in the destination system. Decide which scheduler owns delivery before moving work. |

- Migration order in [`hub/migrations/`](hub/migrations/) runs from the initial schema in 0001, through code auth in 0002, events and grouping in 0003, end times in 0004, meeting reminders in 0005, urgency in 0006, forms in 0007, invites and titles in 0008, joint teams in 0009 and skips in 0010. Verify the remote migration ledger separately. The historical import referenced in the Hub README is private and ignored.
- Ordinary task reminders run at 9 AM Central with due-date, overdue and escalation rules. The Monday exec digest runs during the same hour. Urgent reminders are checked hourly with a two-hour minimum and an overnight quiet period. Meeting reminder timing varies with meeting start and event kind. A scheduled meeting is claimed before sending to guard against duplicate sends from overlapping runs. Task assignment and optional meeting creation also send mail from request handlers. Preserve sender ownership and deduplication behavior during any cutover.
- [`wrangler.jsonc`](hub/wrangler.jsonc) declares the Worker entry point, `public/` static assets, `DB` binding, migration directory, `APP_URL`, Chicago time zone and hourly cron. `APP_SECRET` keys login-code hashes and signed completion links. `SMTP_PASSWORD` enables actual SMTP delivery. Use local-only values in ignored development configuration and keep real credentials out of logs.

## Development, verification and deployment

- **Public site** (from `website/`). Use Node 24 LTS and `npm ci`. Run `npm run dev` for local work, `npm run check`, `npm run check:placeholders` and `npm run build` for verification, and `npm run preview -- --host localhost` for built output. Check affected routes and links in the browser. For motion or layout work, cover narrow screens, the 780px breakpoint, both themes and reduced motion as applicable.
- **Hub** (from `hub/`). Run `npm ci`, `npm run db:migrate:local`, `npm run dev`, `npm test` and `npm run typecheck`. The tracked tests cover reminder rules, dates and time zones, Markdown and email copy. Exercise affected Worker routes against local D1 for changes to auth, permissions, migrations, recipients or forms. Use synthetic data.
- **Public deployment** serves only `website/build/` from the domain root over HTTPS. [`vite.config.ts`](website/vite.config.ts) configures the static adapter. Preserve directory indexes, hashed `_app` assets, fonts, models, WASM and Cloudflare [redirects](website/static/_redirects) and [headers](website/static/_headers). Keep the canonical site, sitemap and `llms.txt` aligned with route changes.
- **Hub deployment** is configured in [`wrangler.jsonc`](hub/wrangler.jsonc). Remote `npm run db:migrate` changes D1 and `npm run deploy` publishes the Worker. Check the target, applied migrations and recovery plan before an approved release. Verify the deployed revision and access boundaries afterward. Confirm SMTP and DNS setup separately if needed. The Hub README's setup checklist is historical evidence of what was pending at writing.
- Keep credentials, live roster and club records, private imports, tokens, logs and backups out of source and public artifacts. Use local fixtures for development. Get the user's explicit approval for production changes, publishing or real outbound messages. Test forms, invitations and reminders locally without contacting people or writing to live services.

## Boundary with the separate HiveMind tracker

The Hivemind project described on the public site, the Cloudflare Hub in this repo and the standalone `hivemind-tracker` app are three distinct things. The two trackers overlap in tasks, meetings and people, but the Hub uses D1 and roster email-code sessions. The standalone tracker uses React, Express and PostgreSQL with its own accounts, authorization and deployment. Its context is [`../hivemind-tracker/PROJECT_CONTEXT.md`](../hivemind-tracker/PROJECT_CONTEXT.md) in the sibling checkout.

### Integration map before the feature port

Comparison uses tracker source baseline `e2ad5430f47c410f5509211fb544a458ae455ab9` and the website baseline above. The tracker context includes a record of verified releases. A checkout HEAD is not an installed app revision.

| Boundary | Website repository | Standalone tracker | Implication |
| --- | --- | --- | --- |
| Public entry and routes | Public site owns `/` and `/teams/` on the club domain. Hub owns `/`, `/tasks`, `/meetings`, `/people`, `/teams` and `/login` on its subdomain. | Express serves an allowlisted React shell on overlapping paths. The client and API use root-relative URLs. Its brand links back to the public club site. | Separate origins avoid route and asset collisions. A same-host path move would require explicit routing, asset, API and auth work. |
| Accounts and authorization | D1 roster, email-code sign-in, exec/member and team lead roles, shared club-domain cookie. | PostgreSQL UUID users, password/passkey sign-in, independent verification, approval and setup gates, an immutable superadmin and granular capability overrides. | Map identities and approve rights explicitly. The Hub exec role does not imply tracker administration. The tracker derives the WebAuthn relying-party ID from its configured origin, so a hostname change needs a passkey migration or re-enrollment plan. |
| Task meaning | One record per assignee, required due date, three statuses, optional grouping and meeting provenance. | Text task IDs, Implementation/Research sections, six statuses, separate readiness and priority, lead/contributors, prerequisites and subteams. | Use explicit status and assignment mapping. A group of independently completable Hub rows cannot be collapsed into one tracker task without a workflow decision. |
| Meeting meaning | Integer IDs, team and event visibility, series, invitations, skips, reminders, public QR forms and meeting action items. | UUID meetings, timestamped start/end, protected meeting content, versioned agenda, notes, files, offline transcripts and attendance. | Preserve each side's visibility and attendance semantics. Moving Hub meetings would require rules for recurrence, forms, recipients and public links. |
| Operations | Cloudflare Pages and Worker/D1, with scheduled mail and SMTP. | Linux systemd and Caddy, PostgreSQL, Resend for auth, maintenance gateway for disruptive releases and native transcription tooling. | Keep build and release boundaries separate for an initial source integration. Switching hosting requires a separate operational plan. |

Key tracker source references are [app routing and permissions](../hivemind-tracker/server/app.ts), [runtime routes](../hivemind-tracker/server/main.ts), [Better Auth](../hivemind-tracker/server/betterAuth.ts), [database definitions](../hivemind-tracker/server/db.ts), [task statuses](../hivemind-tracker/shared/domain.ts) and [meeting schema](../hivemind-tracker/server/meetingSchema.ts).

### Planning sequence for later work

1. **Decide the intended outcome.** A single codebase, a single member entry point and a single member application are separate deliverables. Identify which one is required and which Hub features are in active use. Preserve a source-of-truth owner per workflow.
2. **If the goal is a single codebase, preserve history and import the tracker into its own directory.** Keep all three application directories, lockfiles, build roots and deployment targets independent. Verify each baseline and the resulting source trees in an isolated integration checkout. Review absolute build paths, ignore rules and release scripts before connecting deployments to the combined tree.
3. **If the goal is easier navigation, decide the member destinations.** The public site can direct members to the right tool while keeping existing domains, cookies, passkeys, bookmarks, QR links and emailed links. Preserve workflows that still depend on the Hub.
4. **If the goal is one member app, inventory live use before choosing a target.** Check deployment revisions, applied migrations, counts and references, dependent apps and active schedules with approved read-only access. Use aggregate counts and synthetic samples for planning. Assign explicit dispositions for forms and responses, club events, joint meetings, attendance, task groups, reminders and dependent sign-in.
5. **Rehearse any migration before a cutover.** Define source-scoped ID mappings and row-level authorization checks. Test imports for repeatability, compare counts and references, verify old links and notification deduplication, and demonstrate a recoverable rollback. Decide how late writes would be handled and which system owns writes and mail at each step.

The Hub is the destination for the selected features documented above. Production deployment state, tracker data migration and service retirement were outside this source integration.

## References

- [Repository README](README.md), [public website README](website/README.md) and [Hub README](hub/README.md) cover local setup and deployment.
- [WEBSITE-UPDATES.md](website/WEBSITE-UPDATES.md) records September design and content history. Its old routes, Join flow and contact form describe earlier versions. Use the current routes and content for implementation.
- [ROBOT-MOTION.md](website/ROBOT-MOTION.md) records robot design and historical verification. Its old `/work/#subteams` preview route is now `/teams/#subteams`.
- [HIVEMIND-RESEARCH.md](website/HIVEMIND-RESEARCH.md) records the dated research and acceptance criteria behind the planned Continue and Control features.
