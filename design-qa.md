# Design QA — Structure analytics

- Source visual truth:
  - `/Users/tammat/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/5279CC53-92BC-487C-94D9-E068191C3B2C/PHOTO-2026-07-29-10-23-37.jpg`
  - `/Users/tammat/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/200E035B-4B2C-40DC-945E-3100F7D688F2/PHOTO-2026-07-29-10-24-09.jpg`
- Implementation screenshot:
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-implementation-v1.png`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-implementation-v2.jpg`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-help-column-v3.jpg`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-plan-score-v4.jpg`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-workload-tbu-v5.jpg`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-workload-diagram-v6.jpg`
- Combined comparison:
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-comparison-v1.png`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-comparison-v2.jpg`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-help-column-comparison-v3.jpg`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-plan-score-comparison-v4.jpg`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-workload-tbu-comparison-v5.jpg`
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-workload-diagram-comparison-v6.jpg`
- Viewport: 1280 × 720 CSS px, device scale 1
- Source pixels: 927 × 437 and 902 × 531
- Implementation pixels: 1280 × 1107 full-page capture
- State: all-time period, Structure tab, first two department cards expanded during interaction test

## Full-view comparison

The implementation preserves the reference hierarchy: proportional department
distribution, overdue horizontal bars, and compact expandable department rows.
It intentionally uses the existing dashboard width, Montserrat typography,
navigation, summary cards, and IC Group tokens rather than the narrower
standalone reference canvas.

## Focused comparison

The department-card region was inspected separately because it contains the
smallest typography and densest alignment. Employee columns, progress bars,
scores, and disclosure behavior remain readable and aligned at the target TV
width. No additional focused crop was required.

## Required fidelity surfaces

- Fonts and typography: existing Montserrat hierarchy retained; weights and
  small labels match the density of the reference.
- Spacing and layout rhythm: section order, gaps, radii, and compact rows match;
  the implementation expands to the dashboard's wider TV canvas by design.
- Colors and tokens: blue/gray/purple/green/orange distribution palette, red
  overdue bars, and semantic health badges match the source intent.
- Image quality and assets: the reference contains no required raster assets;
  charts and data components render natively from live values.
- Copy and content: headings, formula explanation, task counts, overdue days,
  employee names, and scores are present and driven by the selected period.

## Interaction and console checks

- Structure is the last visible navigation tab.
- Clicking a collapsed department opens its employee detail.
- Two department cards can remain open simultaneously.
- Clicking an employee opens that employee's task list; the live check exposed
  69 task rows with Bitrix links, statuses, and deadlines.
- `Помогает` is aligned as a dedicated employee-table column; clicking Данара
  still opens 23 helper-task rows.
- Each employee renders aligned `Все` and `По плану` score bars; the second bar
  is filtered to project 51 and uses a distinct blue token. A missing project
  score renders as `—`.
- The workload chart shows filtered-period tasks per full department roster,
  with a red TBU mean marker. At the current-week state, AУ is `45 / 7 = 6.4`
  and TBU is `3.8`.
- Structure typography was increased across section titles, charts, department
  headers, employee rows, score labels, and task details for TV readability.
- Workload is now an actual categorical line diagram: blue department points
  and connecting line, red horizontal TBU mean, axis, labels, and formulas.
- Long employee task lists scroll inside a 320px-high nested card, keeping the
  department overview compact.
- No browser console errors were reported.

## Findings

- No actionable P0, P1, or P2 mismatch.
- P3: very small departments can produce narrow segments in the proportional
  bar; the count remains visible, but the label may be abbreviated on smaller
  screens.

## Comparison history

- Pass 1: no P0/P1/P2 findings; no corrective iteration required.
- Pass 2: aligned the sections with the dashboard card system and verified the
  new employee disclosure state; no P0/P1/P2 findings.
- Pass 3: moved helper counts from inline name badges into a dedicated column
  and verified row/header alignment plus the retained disclosure interaction;
  no P0/P1/P2 findings.
- Pass 4: added the project-51 `По плану` score bar and verified the two-line
  score layout at the TV viewport; no P0/P1/P2 findings.
- Pass 5: added the workload/TBU diagram and enlarged the Structure typography;
  verified the current-week state and full-roster denominators. No P0/P1/P2
  findings.
- Pass 6: replaced the workload bars with a line diagram and horizontal TBU
  reference. Verified four department points, four formulas, and the TBU 3.8
  annotation. No P0/P1/P2 findings.

final result: passed
