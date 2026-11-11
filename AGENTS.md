# Tileflow demos contributor guidance

## Pull requests

- Open pull requests as drafts while the change itself is unfinished, and say in a `## Draft until`
  section of the description what remains (work in its scope, or an open maintainer decision that
  would change the code). Mark one ready for review when it is complete and can be merged as it is,
  even if it waits for other work. A conflict with another open pull request, or a consequence
  maintainers should know (changed baselines, a slower default), never keeps it in draft; the
  description states the consequence.
- Do not push to a pull request after marking it ready; convert it back to draft first
  (`gh pr ready --undo`).
- Maintainers merge ready pull requests together in batches. Do not merge `main` into a ready pull
  request to keep it up to date, and do not enable auto-merge on it.
- A dependency never keeps a complete pull request in draft. State each in the description, one
  per line: `Depends on: tileflow/<repo>#<number>` (ready or draft, in any repository, including
  the pull request it is stacked on), or `Depends on: <release, deploy or data>`. Maintainers hold
  it until they land, and land a stack in order.
- When it edits the same code as another open pull request (check with
  `git merge-tree --write-tree --name-only HEAD <their head>`), list each in a `## Conflicts`
  section of the description, one per line: `tileflow/<repo>#<number>: <files>; <how to resolve>`.
  Maintainers resolve conflicts when they batch; do not merge `main` or the other branch to resolve
  them. Editing the description after ready is allowed; it is not a push.
