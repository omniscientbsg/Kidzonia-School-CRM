# Home snapshot rules

Home (brief 7.3) shows a snapshot that fits the person. It is chosen from permissions and reach
(`snapshotSections` in `packages/shared/src/home.ts`), never from a role's name, so a custom role
gets a sensible Home. Each row below has a test in `packages/shared/test/home.test.ts`; change the
rule and the table together.

"Wide reach" means Tasks reach is _school_ or _all_. "Manages people" means Owner, Users → Edit or
Schools → Edit. Scope is counted after the school switcher.

| #   | Rule                                                                                           | Shows                                  | Example role                   |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------ |
| 1   | Scope covers more than one school, wide reach, manages people                                  | Your schools (lowest first)            | Owner                          |
| 2   | Wide reach, can assign, has live tasks reaching more than one school, and rule 1 doesn't apply | Tasks you've set, by school            | Department head                |
| 3   | Rule 1 plus people reporting to them with school reach                                         | Your schools, then Your team today     | Franchise owner                |
| 4   | People report to them and Tasks reach is team                                                  | Your team today                        | Principal                      |
| 5   | Nothing above applies                                                                          | Today, with a progress bar             | Teacher                        |
| 6   | Wide reach, sets tasks across schools, doesn't manage people, has a team                       | Tasks you've set, then Your team today | A custom "area manager"        |
| 7   | Own reach but people report to them ("sees their team" automatic role on)                      | Your team today                        | A teacher who leads assistants |
| 8   | School switcher narrowed to one school                                                         | Rule 1 no longer applies (one school)  | Owner looking at Kondapur      |

Team is shown when people report to the person and their Tasks reach is team or school, or when
reach is narrower and the "Sees their team's tasks" automatic role is on. Owners (reach all) see
schools, not a team table.
