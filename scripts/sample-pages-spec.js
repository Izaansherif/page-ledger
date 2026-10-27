// scripts/sample-pages-spec.js
// ============================================================================
// THE sample-page content spec. Two consumers, one source of truth:
//   1. scripts/render-samples.html draws these pages onto canvas (JPEGs land
//      in fixtures/made/, bboxes land in fixtures/made/boxes-<id>.json)
//   2. the hand-written extraction fixtures (fixtures/made/*.json) must match
//      this text EXACTLY - rule 5: the reading never invents, the check step
//      compares lines against the photo.
//
// All names/phones are made up for the demo (rule 7). Phones use the clearly
// fictional block 98765 000xx / 95610 00xxx (10 digits, drawn without the +91
// prefix the way Indian notebooks usually write them). Dates use {{TODAY+n}}
// tokens that ai.js resolves against the request base date in mock mode; the
// live recording run (scripts/record-fixtures.js) replaces fixtures with the
// real model output, computed against that run's BASE_DATE.
//
// Row kinds:
//   entry  - a normal customer line
//   paid   - a "Cr. By Cash" payment line (amount_paid)
//   struck - crossed out on the page (struck_out true; excluded from totals)
//   smudged- unreadable amount: blank in the fixture + "amount unreadable"
//   promise- carries a follow-up promise (text + resolved date token)
// ============================================================================

export const MADE_PAGES = [
  {
    id: "dental",
    label: "Dental clinic",
    blurb: "ortho follow-ups, one payment today",
    sub: "Ortho follow-ups · ₹",
    title: { en: "Smile Care Clinic - ortho notes" },
    subtitle: { en: "braces week", hi: "ब्रेसेस सप्ताह" },
    paper: "#fbf7ec",
    account: "No. 7, Rose Lane (near bus stand)",
    lines: [
      { kind: "entry", n: "Ravi K.", ph: "98765 00021", work: { en: "arch wire change" }, amt: "₹300", conf: { name: 0.9, phone: 0.85, amount_due: 0.88 } },
      { kind: "entry", n: "Priya S.", work: { en: "elastics pack" }, amt: "₹150", conf: { name: 0.88, amount_due: 0.84 } },
      { kind: "entry", n: "Jamil A.", ph: "98765 00033", work: { en: "bonding", hi: "बाईं तरफ" }, amt: "₹650", conf: { name: 0.87, phone: 0.82, amount_due: 0.86 } },
      { kind: "paid", n: "Cr. By Cash", work: { en: "counter sale" }, amt: "₹500", conf: { amount_paid: 0.92 } },
      { kind: "struck", n: "Sanju G.", work: { en: "wax strips" }, amt: "₹100", conf: { name: 0.8, amount_due: 0.75 } },
      { kind: "smudged", n: "Manu R.", work: { en: "retainer set" }, amt: null, conf: { name: 0.86, amount_due: null } },
      { kind: "promise", n: "Aishu P.", work: { en: "collection", hi: "वसूली" }, amt: "₹400", note: { en: "promise:" }, say: { hi: "शुक्रवार को आएँगे" }, followText: "aayenge Thursday", followDays: 3, conf: { name: 0.89, amount_due: 0.8, follow_up_date: 0.55 } },
    ],
  },
  {
    id: "garage",
    label: "Garage",
    blurb: "vehicles, dues, a promise to collect",
    sub: "Two-wheeler & car · ₹",
    title: { en: "Sagar Auto Garage" },
    subtitle: { en: "work done", hi: "गैराज हिसाब" },
    paper: "#f8f4e8",
    account: "Bore Well Rd · open till 9",
    lines: [
      { kind: "entry", n: "B. Harish", veh: "Activa 6E", work: { en: "silencer fit" }, amt: "₹400", ph: "95610 00112", conf: { name: 0.88, phone: 0.8, amount_due: 0.87 } },
      { kind: "entry", n: "Bolero", work: { en: "clutch plate + fitting" }, amt: "₹1,200", note: { hi: "कल पिकअप" }, conf: { name: 0.7, amount_due: 0.83 } },
      { kind: "paid", n: "Cr. By Cash", work: { en: "Harish paid now" }, amt: "₹250", conf: { amount_paid: 0.9 } },
      { kind: "struck", n: "Raza", work: { en: "tyre puncture" }, amt: "₹80", conf: { name: 0.78, amount_due: 0.7 } },
      { kind: "promise", n: "Splendor", work: { en: "brake shoes" }, amt: "₹350", note: { en: "balance:" }, say: { hi: "शुक्रवार को आएँगे" }, followText: "balance Thursday ko", followDays: 3, conf: { name: 0.8, amount_due: 0.85, follow_up_date: 0.55 } },
      { kind: "smudged", n: "Pulsar", work: { hi: "पेट्रोल नली" }, amt: null, conf: { name: 0.74, amount_due: null } },
    ],
  },
  {
    id: "kirana",
    label: "Kirana credit",
    blurb: "khata entries, one paid, one coming Friday",
    sub: "Pookkattu Rd · credit khata",
    title: { en: "Kunjamma Stores" },
    subtitle: { en: "credit khata", ml: "കടം ബുക്ക്" },
    paper: "#fdf9ef",
    account: "Pookkattu Rd · open till 9.30",
    lines: [
      { kind: "entry", n: "Meera Chechi", work: { ml: "അരി 5kg, പാൽ" }, amt: "₹120", conf: { name: 0.85, amount_due: 0.82 } },
      { kind: "entry", n: "Anandettan", ph: "94470 00090", work: { en: "sugar 1kg", ml: "മുളക്" }, amt: "₹45", conf: { name: 0.84, phone: 0.78, amount_due: 0.8 } },
      { kind: "paid", n: "Cr. By Cash", work: { en: "Meera paid" }, amt: "₹200", conf: { amount_paid: 0.91 } },
      { kind: "struck", n: "Unni", work: { en: "bread", ml: "ബിസ്കറ്റ്" }, amt: "₹30", conf: { name: 0.76, amount_due: 0.72 } },
      { kind: "smudged", n: "Shibu", work: { ml: "സോപ്പ്, ഓയിൽ" }, amt: null, conf: { name: 0.77, amount_due: null } },
      { kind: "promise", n: "Anandettan", work: { ml: "ബാക്കി ₹350" }, note: { en: "says:" }, say: { ml: "വെള്ളിയാഴ്ച വരും" }, followText: "varum Friday", followDays: 2, conf: { name: 0.84, amount_due: 0.79, follow_up_date: 0.5 } },
    ],
  },
  {
    id: "tuition",
    label: "Tuition fees",
    blurb: "monthly fees, one full payment received",
    sub: "Class 8 batch · ₹",
    title: { en: "Guru Tuition Classes" },
    subtitle: { en: "fees book", hi: "फीस बही" },
    paper: "#faf6ea",
    account: "Evening batch 5-7pm",
    lines: [
      { kind: "entry", n: "Deepa Nair", work: { en: "Oct fees" }, amt: "₹500", conf: { name: 0.9, amount_due: 0.9 } },
      { kind: "entry", n: "Aditya K.", ph: "98470 00201", work: { en: "Oct + Nov fees" }, amt: "₹900", note: { hi: "फीस बाकी" }, conf: { name: 0.86, phone: 0.8, amount_due: 0.85 } },
      { kind: "struck", n: "Vineeth", work: { en: "Oct fees" }, amt: "₹500", conf: { name: 0.79, amount_due: 0.74 } },
      { kind: "paid", n: "Cr. By Cash", work: { en: "Deepa paid full" }, amt: "₹500", conf: { amount_paid: 0.93 } },
      { kind: "smudged", n: "Arun M.", work: { en: "Oct fees, test batch" }, amt: null, conf: { name: 0.8, amount_due: null } },
      { kind: "promise", n: "Irfan S.", work: { en: "test batch" }, amt: "₹400", note: { en: "promise:" }, say: { hi: "सोमवार को आएँगे" }, followText: "aayenge Monday", followDays: 4, conf: { name: 0.85, amount_due: 0.81, follow_up_date: 0.5 } },
    ],
  },
];

// The 1860s public-domain scans stay as a credited fifth option.
export const OLD_PAGE = { id: "spike/page1", image: "/fixtures/demo-pages/page1.jpg", label: "Old-style ledger", blurb: "1860s museum scan · credited" };

export const DEFAULT_PAGE = "made/dental";
