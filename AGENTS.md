# Tileflow demos contributor guidance

## Pull requests

- Open pull requests as drafts while work is in progress. Mark one ready for review only when it
  is complete and can be merged as it is.
- Do not push to a pull request after marking it ready; convert it back to draft first
  (`gh pr ready --undo`).
- Maintainers merge ready pull requests together in batches. Do not merge `main` into a ready pull
  request to keep it up to date, and do not enable auto-merge on it.
- State dependencies on other pull requests in the description, one per line:
  `Depends on: tileflow/<repo>#<number>`.
