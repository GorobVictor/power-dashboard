---
name: gen-commits
description: "Review a git working tree, split changes into coherent local commits, and write strong English commit titles and bodies using only these prefixes: feat:, ref:, fix:, test:, migration:. Use when the user asks to make commits, split changes across several commits, prepare commit messages, clean up a messy diff before committing, or otherwise requests a commit workflow. After the main commits, review AGENTS.md and README.md, update them when the committed changes require it, and create one additional local documentation commit."
---

# Generate Commits

Inspect the repository state, group related edits into clean local commit units, and create clear English commit messages that explain what changed and why. Favor precise staging and minimal commits over large mixed commits.

## Workflow

1. Inspect the working tree with `git status --short` and targeted diffs before deciding on commit boundaries.
2. Read enough code to understand intent, dependencies, and whether files belong to the same behavioral change.
3. Propose a short commit plan when the split is non-obvious, large, or risky. For each planned commit, state:
   - the goal of the commit;
   - the files or hunks it should include;
   - the proposed title and whether a body is needed.
4. Stage only one logical change at a time.
5. Create the local commit with a strong English title and a body when it adds useful context.
6. Re-check `git status --short` after each commit and continue until the requested changes are fully organized.
7. After the main commits are done, review `AGENTS.md` and `README.md`.
8. Update `AGENTS.md` and `README.md` when the committed changes make the docs stale, then create one additional local documentation commit.
9. Stop after the local commits are created. Do not push, open a PR, amend commits, or rewrite history unless the user explicitly asks.

## Grouping Rules

- Group by behavior, not by file type. Keep controller, DTO, service, and test changes together if they implement one user-visible change.
- When the overall diff is large, split it into the smallest sensible logical commits instead of bundling many concerns together.
- Separate refactors from behavior changes unless the refactor is tiny and necessary to support the feature.
- Separate formatting-only edits, renames, dependency bumps, generated files, and test-only changes unless they are inseparable from the main change.
- Do not mix unrelated bug fixes just because they are nearby in the same file.
- If one file contains multiple concerns, stage only the relevant hunks for the current commit and leave the rest for later.
- Prefer several small meaningful commits over one `misc updates` commit.
- Preserve unrelated user changes. Never silently fold them into the wrong commit.

## Commit Message Rules

- Write commit titles and bodies in English.
- Start every commit title with one of these prefixes: `feat:`, `fix:`, `ref:`, `test:`, `migration:`.
- Use `feat:` for new behavior, `fix:` for bug fixes, `ref:` for refactors or cleanup without behavior change, `test:` for test-only work, and `migration:` for Entity Framework migrations or any other schema/data/infrastructure migration changes.
- Write the text after the prefix in present simple lowercase style such as `feat: add new models` or `fix: handle null sap driver code`.
- Keep the title specific and easy to scan.
- Use a body when it helps explain motivation, side effects, migrations, follow-up work, or why the split matters.
- Avoid vague titles such as `fix: stuff`, `feat: updates`, `ref: wip`, or `test: changes`.

## Suggested Message Shape

Use this pattern by default:

```text
type: short lowercase present-simple title

Explain why the change exists in English.
Call out important implementation details or risks in English when helpful.
```

Good titles:

- `feat: add sap order import pagination guard`
- `ref: extract driver schedule mapping helper`
- `ref: refresh agents and readme after import flow update`
- `test: cover march 2026 calendar edge cases`
- `migration: add customer status seed update`

## Documentation Follow-Up Commit

- Always review `AGENTS.md` and `README.md` after the main commits.
- Update them only when the newly committed behavior, workflow, commands, architecture notes, or operational expectations make the docs inaccurate or incomplete.
- Create one extra local commit for those documentation updates when changes are needed.
- Prefer a `ref:` title for that follow-up commit unless another allowed prefix is clearly more accurate.
- Do not invent no-op documentation edits just to force an extra commit.

## Safety Checks

- Read the diff before every commit. Do not commit blindly from file names alone.
- Preserve unrelated user changes. Never rewrite, squash, amend, or discard commits unless the user explicitly asks.
- Avoid committing secrets, local config noise, or accidental generated artifacts.
- If boundaries are ambiguous, say so and show the tradeoff before committing.
- Create local commits when the user asks for commits; do not wait for extra confirmation unless the split is ambiguous or risky.
- Do not push by default. Stop after creating the local commits so the user can review them locally before any remote action.

## Response Style

When working with this skill, communicate in a compact commit-oriented format:

1. Current state: what changed and what looks separable.
2. Commit plan: proposed commits with titles and included scope.
3. Execution: created local commits in order, plus whether a docs follow-up commit was added and anything intentionally left uncommitted.

If everything clearly belongs in one commit, skip the long plan and commit directly after verifying the diff. If `AGENTS.md` and `README.md` do not need updates, say so explicitly instead of creating a fake docs commit.
