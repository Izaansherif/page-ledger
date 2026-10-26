# test-pages/

Drop your three notebook photos here, named:

- `page1.jpg`
- `page2.jpg`
- `page3.jpg`

Then run:

```
node scripts/spike-extract.js test-pages/page1.jpg --live
```

These photos never get committed (`.gitignore` blocks images in this folder).
For the judges' demo we will bundle FAKE sample pages under `fixtures/demo-pages/`
in Stage 7 instead - always fake data in the repo.
