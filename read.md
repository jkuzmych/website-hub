# Changes since this project was cloned

This describes the local website repository compared with clone baseline `39f1c69` (November 8, 2026). Most local changes are in the member Hub; the public SvelteKit site remains a separate project. An upstream merge also brought in Badger Bot and earlier Hub changes.

## Meeting agenda and follow-up

- Meetings now have an Agenda view with numbered agenda items, durations, inline speaker notes and private attachments. Meeting participants can contribute within the applicable access and editing rules. Existing meeting notes and agenda text remain available.
- Meeting pages separate preparation from follow-up, support attributed meeting summaries, and offer Here or Partial check-in while eligible. Attachments and linked materials remain subject to meeting access rules.
- Meeting discovery includes team and date filters. Existing attendance and QR-form workflows remain supported.

## Teams and subteams

- Team pages now bring together descriptions, resource links, member rosters, weekly availability and shared task boards. Authorized editors can manage team settings and delegate page administration.
- Subteams have their own cards and pages, descriptions, rosters and filtered boards. Authorized editors can create and manage them and add team members.
- Shared board cards can be assigned to people and subteams, with one shared status across the board and other task views. Members can claim eligible unassigned work; assignment and management remain role-sensitive. Task views and completion controls were also updated.

## Other changes

- Local demo seeding adds fictional members, teams, tasks and meetings for development. Hub migrations `0011` through `0019` add the supporting availability, meeting content, team board and related data structures; apply migrations in order for a new environment.
- The merged upstream history adds Badger Bot and updates existing Hub task and meeting workflows. See the individual project READMEs for setup and further details.

## Verification

On November 15, 2026, the Hub test suite passed 36 tests, including local Worker/D1 integration coverage for agendas, teams, subteams and permissions; Hub TypeScript checking passed. The public site passed Svelte checking and the placeholder check. These checks do not establish that any live deployment has been updated.
