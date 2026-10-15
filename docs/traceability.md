# Traceability: {task}

There are two matrices. The **requirements matrix** gives each README acceptance criterion and demo line one row. The **chain matrix** follows each feature down to its release. An empty cell means something is missing.

Every artifact names its parent in its front matter, so the `developmentsupport-progress` skill can rebuild the chain matrix from the files. You fill only the first matrix by hand.

## 1. Requirements matrix (README → evidence)

| # | README criterion / demo line | Eval point | FEAT | Story (US) | Spec FR | Test case | Evidence | Demo time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AC-1 | {copied text} | {A1} | {FEAT-A04} | {A-04} | {specs/004-…/FR-002} | {A-04-TC-003} | {docs/evidence/A-04.md} | {02:15} |
| D-1 | {demo transcript line} | | | | | | | |

## 2. Chain matrix (BN → release)

| BN | VIS | FEAT | US | REQ | TASK | TC | Code (merge commit) | CR | REL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BN-{A} | VIS-{A} | FEAT-{A03} | A-03 | FR-001…FR-006 | T001–T022 | A-03-TC-001…008 | `{sha}` | CR-A03 | REL-A1 |

## 3. Gate log

| Gate | Artifact | Version | Pre-check | Decision | Date |
| --- | --- | --- | --- | --- | --- |
| G0 | docs/01-intent.md | 0.2 | PASS | Approved | {date} |
| G1 | docs/feature-list.md | | | | |
| G2 | docs/plan.md | | | | |
| Design CP | design/ | | | | |
| G3 | docs/architecture-constitution.md | | | | |
| G4–G7 | per story; see `docs/progress.md` | | | | |
| G8 | docs/release.md | | | | |
