# Intake accuracy

**Status: the accuracy measurement has not been run, so there are no PDF accuracy numbers yet.** No letter PDFs were downloaded, because the city's site asks automated clients not to fetch them. That needs the project owner's decision.

## The decision needed

`https://web.seattle.gov/robots.txt` says:

```
User-agent: *
Disallow: /dpd/edms/
```

Every letter link in the dataset is on that path (`/dpd/edms/GetDocument?id=...`). The site didn't return an error, because no PDF was requested. The only requests made to the site were for `robots.txt`. The brief said to stop and report if the site blocks access, and this rule covers the exact files in question, so I treated it as a block.

The options, none of which has been taken:

1. **Ask the city.** Ask Seattle's open data team or SDCI for permission or a bulk export. This is the cleanest route, but the slowest.
2. **Approve the slow download.** The city publishes these links in its open dataset, and the script fetches about 100 files, one at a time, at least 1.2 seconds apart. Run it with `--robots-approved`. This goes against the site's stated rule, so it's the owner's call.
3. **Download by hand.** A person saves each file as `.cache/intake-sample/files/<doc id>.bin`, then runs the script with `--no-download`. `--sample-only` lists the doc ids.

Once the files are in place, this command prints every table this report is missing:

```
npx tsx demo/measure-intake.ts --details
```

## What has real numbers

### The sample (fixed, not yet downloaded)

Seed `redline-intake-1` draws 104 letters with 429 true comments from the 6,296 letters in the cached dataset. The 40 letters in the frozen eval are excluded.

| | |
|---|---|
| Split | 59 tuning (191 comments), 45 held out (238 comments) |
| Review types | Zoning 19, Drainage 14, Ordinance Structural 12, Energy 10, Tree 9, Addressing 6, ECA GeoTech 6, MHA 4, and 2 each from 12 others |
| Document titles | 100 "Correction Letter", 4 other (marked-up plan sets) |

Each review type gets a share in proportion to its size, with a minimum of 2 for any type with at least 5 letters. Small types are therefore slightly over-represented. 40% of each type is held out. Individual held-out letters are never printed, so rules can't be written against them.

### Personal details, on all 26,236 dataset comments

From `npx tsx demo/measure-personal.ts`. This is real city text, but it is the dataset's copy of the comments, not text read from PDFs.

| Comments containing | Before | After |
|---|---|---|
| Email address | 943 | 0 |
| Phone number | 82 | 0 |
| `Author:` field | 36 | 0 |
| `Reviewer: <name>` | 5 | 0 |
| Name labelled elsewhere in the same letter | 41 | 0 |
| An ending like `Drainage (16)` or a reviewer's name with a count | 6,894 | 320 |

These counts use the same kinds of pattern as the stripper, so they show that it works on those forms. They don't show that no names remain.

- **Known gap:** a name in ordinary prose, with no label and no "contact" or "call" before it, stays in the text.
- **Over-stripping checks:** I read the 45 most common of the 67 distinct endings removed by the name rule, and all were names or headings. I also read 15 of the 372 comments that lost over 20% of their characters, and all were headings glued to short comments. The other 22 endings and 357 comments weren't read.
- **Remaining endings:** the 320 left are mostly text that doesn't fit a heading pattern. Some could be real headings.

### Limits, from the dataset

| | Letters of 6,296 |
|---|---|
| More than 40 comments, the parser's cap (233 comments in those letters) | 5 |
| More than 30,000 characters of comment text, the parser's cap | 3 |

Both caps used to cut comments silently. The user is now told. Real PDF text also includes metadata, so more letters than this will reach the character cap. How many is unmeasured.

## Not measured

| Asked for | Status |
|---|---|
| Letters with the exact comment count | Not measured |
| Comments matched by text | Not measured |
| Failures by cause | Not measured |
| Before and after numbers, tuning and held out | Not measured |
| How common scans are | Not measured |

The six earlier PDFs remain the only evidence on real files, and I didn't re-run them.

## Parser changes

There was no measurement to tune against, so these fix faults visible in the dataset's text or the code. **Their effect on real PDFs is unknown.** No rule was fitted to sample letters, so the held-out part is still clean.

- **Glued metadata:** `Author: <name> Layer: Review Comment<text>` on one line used to lose the whole comment, and now keeps the text. This form is in 36 dataset comments.
- **Clause numbers:** a last line such as `...per SMC 23.44.014.C (3)` used to be deleted as a group heading. A heading must now match one the letter itself shows.
- **Metadata lookalikes:** a long sentence starting `Space:` or `Status:` is no longer deleted as a field.
- **Glued headings:** endings like `...the plans.Drainage (16)` are removed.
- **Silent cuts:** `parseLetterDetailed` reports them, and the page shows a warning.

Left alone until there's data: letters whose numbering restarts in each section, which merge into one comment, and PDF text pieces joined without a space.

## Word files

`demo/read-docx.ts` reads `.docx` with no new dependency. It writes automatic numbering back into the text, keeps table rows on one line, and skips deleted text, headers, footers and author properties. It also caps sizes, which stops zip bombs. Older `.doc` files get an explanation.

It was tested on files built in the tests and one file made by macOS `textutil`. **It hasn't been tried on a file saved by Microsoft Word or on a real correction letter in Word.**

## Scanned PDFs

`demo/read-pdf.ts` now classifies each page. A page with under 40 characters of text counts as unreadable if images cover at least half of it or it draws at least 200 shapes.

| Result | What the user sees |
|---|---|
| Scan | An explanation, with next steps and the paste box |
| Part scan | The comments we could read, and a warning naming the scanned pages |
| Text that decodes to junk | An explanation, with next steps |
| Blank | A request to check the file |
| Scan that already has OCR text | Read normally |

It was tested on hand-built PDFs, including scans cut into strips and scans with a short stamp, and on an image-only PDF made by macOS `sips`. **The thresholds haven't been checked against real scanned letters**, and false positives and misses on real files are unknown.

## OCR recommendation

Nothing has been added. **Decide after measuring how common scans are**, because if they're rare, the current explanation may be enough. If OCR is worth adding, start with OCRmyPDF, then try Textract if its results on real scans are too poor.

| Option | Cost per page | 4-page letter | Letter leaves our servers? |
|---|---|---|---|
| [OCRmyPDF](https://ocrmypdf.readthedocs.io/en/latest/introduction.html) with Tesseract, run locally | No fee, compute only | No fee | No |
| [AWS Textract Detect Document Text](https://aws.amazon.com/textract/pricing/) | $0.0015 (US West, first 1M pages a month) | $0.006 | Yes, to AWS |
| A vision model (Haiku 4.5) | About $0.009 to $0.017 | About $0.04 to $0.07 | Yes, to the model provider |

- **Local option:** OCRmyPDF's documentation notes that one dependency, Ghostscript, is AGPLv3, so check the license before deploying it. It also adds system packages to the server.
- **Vision model estimate:** my own calculation, from the token counts and prices in `docs/pricing-and-onboarding.md` (about 1,560 image tokens in, 1,500 to 3,000 text tokens out, $1 and $5 per million). Those figures weren't rechecked.
- **Accuracy:** none of these was tested, so how well each handles stamps and handwriting is unknown. Any OCR text should still go through the existing step where the user checks the comments.

## Running it

```
npm test                                   # parser, reader and scoring tests
npx tsx demo/measure-intake.ts --sample-only
npx tsx demo/measure-intake.ts --no-download
npx tsx demo/measure-personal.ts
```

Both measurement scripts read `.cache/seattle/comments.json`, or the path given with `--comments`. Downloads and per-letter results stay in `.cache/`, which git ignores. `--details` writes letter text there too, for tuning letters only.

**How a letter is scored:** both sides are compared as words. A comment is "matched" if it pairs one-to-one with a parsed comment at a Dice score of 0.8 or more. It is "found" if 80% of its words appear in some parsed comment, even one merged with others. The dataset's text comes from the city's own extraction and has its own noise, so its counts won't be perfectly true. I ran the scoring on one generated PDF to confirm it works, and that result was discarded.
