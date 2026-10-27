# fixtures/demo-pages — bundled fake sample pages

These images are **public-domain historical ledger pages**, used as stand-in
"realistic handwriting" demo pages so Page Ledger can be tried without any
real customer data.

## Source + license (required credit)

All three pages are scans of the **Isaac T. Biles Grog Shop Ledger** (1860s,
North Carolina, USA):

- Source: Digital Public Library of America — item `a86afc96786939fe86606db855da299c`
  https://dp.la/item/a86afc96786939fe86606db855da299c
- Contributed by **Stanly County Museum**, via the North Carolina Digital
  Heritage Center (record: https://lib.digitalnc.org/record/21541).
- On Wikimedia Commons as
  `Isaac T. Biles Grog Shop Ledger - DPLA - a86afc96786939fe86606db855da299c`
  (pages 33, 51 and 88).
- **License: Public domain** (no attribution legally required; this file
  credits it anyway as good practice).

## Files

- `page1.jpg` — the default sample page (two customer accounts with date rows,
  a payment line `Cr. By Cash`, one crossed-out line and faded patches).
  The mock extraction fixture `fixtures/spike/page1.json` is written to match
  this page so the review table makes sense next to it.
- `page2.jpg`, `page3.jpg` — extra handwriting pages, now each wired to its
  own invented fixture (`fixtures/spike/page2.json`, `page3.json`): page 2
  shows a struck line + an unreadable margin line + a payment line; page 3
  shows a smudged amount left blank, a payment settled by work, and a
  follow-up token (`{{TODAY+5}}`).
- `page1-thumb.jpg` / `page2-thumb.jpg` / `page3-thumb.jpg` — small (340 px)
  home-screen thumbnails for the sample cards; 18–24 KB each.

## Why historical pages?

Project rule 7: never commit real customer data or real photos of real
customers. These scans are ~150 years old, published by a museum,
public domain, and contain no personal data by today's standards - they are
fake* demo data in the only sense that matters for a hackathon:
not anyone's private information.

*The handwriting is real; all amounts, phones and follow-ups shown in the
app fixtures are invented to fit the demo script.
