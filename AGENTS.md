# Tileflow demos contributor guidance

## Pull requests

- Open pull requests as drafts while work is in progress, and say in a `## Draft until` section of
  the description what is unfinished (remaining work, or a maintainer decision about this change).
  Mark one ready for review when it is complete and can be merged as it is, even if it waits for
  other work.
- Do not push to a pull request after marking it ready; convert it back to draft first
  (`gh pr ready --undo`).
- Maintainers merge ready pull requests together in batches. Do not merge `main` into a ready pull
  request to keep it up to date, and do not enable auto-merge on it.
- A dependency never keeps a complete pull request in draft. State each in the description, one
  per line: `Depends on: tileflow/<repo>#<number>` (ready or draft, in any repository, including
  the pull request it is stacked on), or `Depends on: <release, deploy or data>`. Maintainers hold
  it until they land, and land a stack in order.
