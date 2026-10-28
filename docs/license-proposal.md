# Licence statement proposal (partly decided; not applied)

The repository root contains `LICENSE.txt`, a zlib-style licence with the 2018 notice of the original GLMaze authors. No copyright
holder has been chosen for the newly written browser reconstruction, so nothing about the licence has been changed.

Proposed wording for a `web/LICENSE-NOTE.md` or a README paragraph:

> The browser reconstruction in `web/` (source code, procedurally generated textures and sprites, tests and documentation) is
> newly written for this project as a behavioural reconstruction. It is intended to be distributed under the same terms as the root
> `LICENSE.txt`, whose original notice (Copyright (c) 2018 ultitech) is preserved unchanged and applies to the original GLMaze
> work. Copyright in the newly written browser material is held by **[OWNER TO CHOOSE]**. No Microsoft code, images, meshes or
> sounds are included, and no ownership of Microsoft material is claimed.

## Decision record

| Decision | Status |
| --- | --- |
| Use the root licence's zlib-style terms for the browser work in `web/` and its documentation | **Decided yes**, by the project owner on 2026-10-27 |
| Copyright holder for the newly written browser material | **Pending.** The owner chose to defer on 2026-10-27; no name has been invented and `[OWNER TO CHOOSE]` stays in the proposed wording |
| Applying the statement (a `web/LICENSE-NOTE.md` or a README paragraph) | **Not applied** until the holder name is supplied |

Until the holder name is supplied the documentation only says that the browser code is original, that no Microsoft material is included,
and that the repository carries the root `LICENSE.txt`. To finish: give the name to put in place of **[OWNER TO CHOOSE]**, then replace the
placeholder in the wording above, add it as `web/LICENSE-NOTE.md`, and tick the licence line in `docs/release-checklist.md`.
