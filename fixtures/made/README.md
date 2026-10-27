# fixtures/made/ — sample pages made for this demo

Four realistic Indian small-business notebook pages, drawn for the demo
(scripts/render-samples.html: canvas → JPEG, handwriting fonts, ruled
paper, slight rotation, mixed English/Hindi/Malayalam). All names, phone
numbers, shops and amounts are invented (project rule 7):

| id      | business         | what the page shows                                        |
| ------- | ---------------- | ---------------------------------------------------------- |
| dental  | Smile Care Clinic| ortho follow-ups, one Cr. By Cash payment, a struck line, a smudged amount, a "शुक्रवार को आएँगे" promise |
| garage  | Sagar Auto Garage| vehicle jobs, dues, "कल पिकअप", one struck line, one smudge  |
| kirana  | Kunjamma Stores  | credit khata with Malayalam items, one paid line, "വെള്ളിയാഴ്ച വരും" |
| tuition | Guru Tuition     | monthly fees, one full payment received, one struck line    |

Files per page:

- `<id>.jpg` — the full "photo" (1000×1414). `boxes-<id>.json` — where every
  visible line sits (normalized 0–1000), used by the demo fixtures.
- `<id>-thumb.jpg` — the small card thumbnail.
- `<id>.json` — the extraction fixture served in mock mode.

## Where the readings come from (honesty, rules 5 + 7)

- Today each fixture is a **demo read** that matches the drawn page exactly —
  struck line flagged, smudged amount left null with `amount unreadable`,
  promise dates as `{{TODAY±n}}` tokens.
- When you have Meta API credits, run **`scripts/record-fixtures.js`** over
  this folder once: it sends each real JPEG through the same live
  `extractPage()` pipeline the app uses and saves the model's validated output
  back here (verbatim — the ONLY rewrite is `follow_up_date` → `{{TODAY±n}}`
  tokens relative to the recording date, so replays stay believable).
- After that run, `js/recorded-fixtures.js` carries the date + real token
  cost and the sample cards say **"Real reading recorded <date>"** — only
  after the recording actually happened.

## Credits

Pages generated in-project (no stock, no third-party assets) with the
handwriting fonts Kalam (Hindi), Caveat (English) and Noto Sans Malayalam
(Google Fonts, OFL), rendered once by scripts/render-samples.html. The
"old-style ledger" sample is a real 1860s public-domain museum scan
(credited in fixtures/demo-pages/README.md).
