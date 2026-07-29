# Design QA — Structure analytics

- Source visual truth:
  - `/Users/tammat/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/5279CC53-92BC-487C-94D9-E068191C3B2C/PHOTO-2026-07-29-10-23-37.jpg`
  - `/Users/tammat/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/200E035B-4B2C-40DC-945E-3100F7D688F2/PHOTO-2026-07-29-10-24-09.jpg`
- Implementation screenshot:
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-implementation-v1.png`
- Combined comparison:
  - `/Users/tammat/Documents/DashboardAPU/output/design-qa/structure-comparison-v1.png`
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
- No browser console errors were reported.

## Findings

- No actionable P0, P1, or P2 mismatch.
- P3: very small departments can produce narrow segments in the proportional
  bar; the count remains visible, but the label may be abbreviated on smaller
  screens.

## Comparison history

- Pass 1: no P0/P1/P2 findings; no corrective iteration required.

final result: passed
