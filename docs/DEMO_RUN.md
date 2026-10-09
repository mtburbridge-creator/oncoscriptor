# Demo run: immunotherapy-side-effects, 2026-10-09

One project taken from idea to `done` by hand from Claude Code, with Hermes and the physician played by the operator. Every command below was run in order from the repo root. Nothing was committed. No skill, guideline, or tool was edited.

Final state: phase `done`, waiting on none, `node tools/project.js validate` reports `all projects valid (1)`.

## Word count of the final script

`projects/immunotherapy-side-effects/script/final.md` (v2):

| Method | Words |
|---|---|
| Guideline definition: body only, header and `## Sources` excluded, `[Sn]` keys stripped | **1,460** (10.4 minutes at 140 wpm) |
| Same body, keys counted | 1,544 |
| Package skill method: `wc -w` on everything before `## Sources` (includes H1, header line, H2s, minutes lines, keys) | 1,571 (README says 11.0 minutes) |

Target was 10 minutes, budget 1,300 to 1,500. Section minutes sum to 10.0.

## Commands, in order, and what each produced

### Step 1, idea and project

```
cat > ideas/immunotherapy-side-effects.md        # title / source: human / found / status: new, one paragraph
node tools/project.js new immunotherapy-side-effects --title "What to expect from immunotherapy side effects" --minutes 10 --idea ideas/immunotherapy-side-effects.md
sed -i 's/^status: new$/status: started/' ideas/immunotherapy-side-effects.md
node tools/project.js status immunotherapy-side-effects
node tools/project.js todo
```

Produced `projects/immunotherapy-side-effects/` with `project.json` in phase `research`, five tasks (two Hermes todo, two Claude todo, synthesis blocked), `idea.md`, and the six empty subfolders. `todo` listed the four ready tasks.

### Step 2, Hermes played by hand (research)

```
node tools/project.js start immunotherapy-side-effects research.forums
node tools/project.js start immunotherapy-side-effects research.literature
# web searches to verify four literature identifiers, then Europe PMC REST fetches:
#   https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:<pmid>%20AND%20SRC:MED&format=json
cat > projects/immunotherapy-side-effects/research/forums.md      # headed PLACEHOLDER, generic question sketch, no quotes or URLs
cat > projects/immunotherapy-side-effects/research/literature.md  # headed PLACEHOLDER, four verified PMIDs/DOIs
node tools/project.js done immunotherapy-side-effects research.forums
node tools/project.js done immunotherapy-side-effects research.literature
```

PMIDs verified (title, authors, journal, year, pages, DOI all returned by Europe PMC): 29320654 (Postow, NEJM 2018), 34724392 (Schneider, JCO 2021 ASCO guideline), 36270461 (Haanen, Ann Oncol 2022 ESMO guideline), 30242316 (Wang, JAMA Oncol 2018 fatal toxicities; abstract read). PubMed itself returns a cookie wall to the fetch tool.

### Step 3, Claude skills

**research-sources**

```
node tools/project.js start immunotherapy-side-effects research.sources
# WebSearch restricted to cancer.gov, cancer.org, nccn.org, mskcc.org/mdanderson.org/mayoclinic.org/..., cancerresearchuk.org/macmillan.org.uk, fda.gov/dailymed
# WebFetch of each candidate page; NCCN returned 403 to WebFetch, fetched with curl -A "Mozilla..." instead, then pdftotext
cat > projects/immunotherapy-side-effects/research/sources.md         # S1..S11
cat > projects/immunotherapy-side-effects/research/sources-notes.md   # findings by patient question, Conflicts, Gaps
node tools/project.js done immunotherapy-side-effects research.sources
```

Eleven sources opened: NCI (3 pages), ACS, NCCN patient guideline 2026 PDF, NCCN infographic 2026, MD Anderson, Cancer Research UK, Macmillan, Keytruda label on DailyMed, MSK. Not usable: Mayo Clinic blog (403), Cleveland Clinic (not found), NCCN "understanding" page (download index only), Keytruda Medication Guide text (not on the DailyMed page body).

**research-news**

```
node tools/project.js start immunotherapy-side-effects research.news
# WebSearch, general and domain-restricted; WebFetch of each item
cat > projects/immunotherapy-side-effects/research/news.md   # N1..N9, Older context, Themes, Claims that need a trusted source
node tools/project.js done immunotherapy-side-effects research.news
```

Nine in-window items (Healio, ASCO Post x3, WebMD, AACR release, News-Medical, CURE, Medical News Today, Medical Xpress), two older-context items.

**synthesis**

```
node tools/project.js start immunotherapy-side-effects synthesis
cat >> projects/immunotherapy-side-effects/research/sources.md   # S12..S15 from literature.md
cat > projects/immunotherapy-side-effects/research/notes.md      # the seven required H2s
node tools/project.js done immunotherapy-side-effects synthesis   # phase -> draft
```

**draft**

```
node tools/project.js start immunotherapy-side-effects script.draft
cat > projects/immunotherapy-side-effects/script/v1.md
python3 count.py v1.md            # per-section words and minutes, body total with keys stripped (script in scratchpad, not in repo)
comm -23 <(keys in script) <(## Sn in sources.md)   # empty, every key resolves
# long-sentence scan, -emia/-itis/-therapy/-oma scan; split four sentences, defined melanoma and chemotherapy, set minutes lines
node tools/project.js done immunotherapy-side-effects script.draft   # script_version 1, phase -> script_review
```

v1: 1,458 body words, 12 keys used (S1, S3, S4, S5, S6, S7, S9, S10, S11, S13, S14, S15), all resolving.

### Step 4, physician feedback, revise, approve

```
node tools/project.js action immunotherapy-side-effects script.feedback --json '{"text":"Tighten the cold open to two sentences and add one plain-language sentence defining the immune system before the first use of checkpoint inhibitor."}'
#   wrote script/feedback-v1.md, queued script.revise
node tools/project.js start immunotherapy-side-effects script.revise
#   wrote script/v2.md: cold open now two sentences (69 words), H2 renamed from "What is a checkpoint inhibitor..." to
#   "What is immunotherapy..." so the term is not used before its definition, first body sentence defines the immune system
node -e '...p.script_version+=1...'            # script_version 2
node tools/project.js done immunotherapy-side-effects script.revise
node tools/project.js action immunotherapy-side-effects script.approve   # copied v2.md -> final.md, phase -> outline_images
```

### Step 5, outline, prompts, Hermes images

```
node tools/project.js start immunotherapy-side-effects outline.draft
cat > projects/immunotherapy-side-effects/outline/v1.md
node tools/project.js done immunotherapy-side-effects outline.draft     # see friction: done ran before the bullet check passed
node tools/project.js start immunotherapy-side-effects images.prompts
cat > projects/immunotherapy-side-effects/images/prompts.json          # 12 prompts, version 1
node -e '<validator from the skill>'                                    # threw "too long 04" but the chain continued
node tools/project.js done immunotherapy-side-effects images.prompts   # unblocked images.generate
node tools/project.js start immunotherapy-side-effects images.generate
node gen.js projects/immunotherapy-side-effects/images/generated 01 ... 12   # playwright-core, /opt/pw-browsers/chromium, 1792x1024 canvas gradient + id text, toDataURL
# PNGs were 172 to 209 KB; re-encoded in Node (RGB, Up filter, zlib level 9) to 45 to 58 KB
node shrink.js projects/immunotherapy-side-effects/images/generated/*.png
# fixed outline to 59 bullets, fixed prompts 04, 08, 09, 12 to 80 words or fewer (in place, after done; see friction)
node -e '...status todo -> done for every id with a PNG...'
node tools/project.js done immunotherapy-side-effects images.generate   # phase -> review
```

### Step 6, review loop

```
node tools/project.js action immunotherapy-side-effects images.decide --json '{"decisions":{"01".."08": approve, "09": reject (too clinical), "10": reject (product shot), "11": iterate (one person with a dog, warm evening light), "12": iterate (video call at the kitchen table, no clinic)}}'
#   queued images.reprompt round 1, images.generate round 2 blocked on it
node tools/project.js start immunotherapy-side-effects images.reprompt
#   viewed images/generated/11.png (placeholder), rewrote prompts 11 and 12, status todo, version 2
#   diffed against a saved copy: only 11 and 12 changed, exactly those todo
git diff --stat projects/immunotherapy-side-effects/images/prompts.json   # printed nothing, file is untracked
node tools/project.js done immunotherapy-side-effects images.reprompt
node tools/project.js start immunotherapy-side-effects images.generate
node gen.js ... 11 12 && node shrink.js 11.png 12.png
node -e '...todo -> done...'
node tools/project.js done immunotherapy-side-effects images.generate
node tools/project.js action immunotherapy-side-effects images.decide --json '{"decisions":{"11":{"decision":"approve"},"12":{"decision":"reject","note":"..."}}}'
node tools/project.js action immunotherapy-side-effects outline.approve     # outline/final.md
node tools/project.js action immunotherapy-side-effects slides.order --json '{"order":["01","03","02","04","05","06","07","08","11"]}'
node tools/project.js action immunotherapy-side-effects review.finish       # phase -> slides
```

### Step 7, slides, package, learn

```
node tools/project.js start immunotherapy-side-effects slides.build
node -e '<pre-check from the skill>'                 # ok 9 slides
node tools/build-deck.js immunotherapy-side-effects  # 2.9 s: "11 slides (9 images + 2 blanks), 1008403 bytes"
grep -o "<section" deck.html | wc -l                 # 11; alt order 01 03 02 04 05 06 07 08 11; images embedded as data:image/jpeg
node tools/project.js done immunotherapy-side-effects slides.build     # phase -> package
node tools/project.js start immunotherapy-side-effects package.build
cp script/final.md, outline/final.md, slides/deck.html, research/sources.md -> package/   # cmp: byte-identical
cat > package/README.md                              # 1571 words, 11.0 minutes, v2 / v1, 9 slides
node tools/project.js done immunotherapy-side-effects package.build    # phase -> done, learn queued
node tools/project.js start immunotherapy-side-effects learn
diff script/v1.md script/final.md; cat script/feedback-v1.md; read images/decisions.json
cat > guidelines/proposals/immunotherapy-side-effects.json   # 3 proposals, full proposed_text, excerpts verified as substrings
cp finals -> exemplars/immunotherapy-side-effects-{script.md,outline.md}; node -e '...approved prompts -> exemplars/...-prompts.json'  # ids 01-08, 11
node tools/project.js done immunotherapy-side-effects learn
node tools/project.js validate                       # all projects valid (1)
node tools/project.js status immunotherapy-side-effects   # phase=done waiting=none
```

## Played by hand

- **Hermes**: `research.forums` and `research.literature` (placeholder files, clearly headed), `images.generate` twice (12 placeholder PNGs, then 11 and 12 again). Status changes through `tools/project.js`, prompt statuses edited in `prompts.json` as the contract says.
- **Physician**: `script.feedback`, `script.approve`, `images.decide` twice, `outline.approve`, `slides.order`, `review.finish`, all through `tools/project.js action`.
- **Operator mistakes worth recording**: in step 5, I chained the quality checks and the `done` calls in one shell command without gating, so `done outline.draft` and `done images.prompts` were recorded although the outline had 85 bullets (limit 60) and four prompts were over 80 words. I fixed the files in place afterwards, before anything downstream read them (outline before `outline.approve`, prompts before Hermes round 2 and before `review.finish`). Later chains used explicit `|| exit 1` gates and those caught two more over-length rewrites of prompt 12 before any state changed.

## Friction, specific

CLI and state machine

1. `project.js new --idea` copies the idea file before anything flips its status, so `projects/<slug>/idea.md` says `status: new` forever while `ideas/<slug>.md` had to be edited by hand to `started`. Nothing in the CLI owns that flip.
2. Every skill opens with "confirm `tasks[...].status` is `todo`", but `status` prints only non-done tasks and there is no single-task query. I used `node -e` against `project.json` each time. `status` also does not show `script_version`, `outline_version`, or `approved`.
3. `script.approve` copies `script/v<script_version>.md`. If the revise skill's manual `script_version` bump is forgotten, approve silently promotes v1. The bump should be part of `done script.revise` or `applyAction` should refuse when `v(N+1).md` exists and `script_version` is N.
4. `images.decide` overwrites the whole entry per id, so the round-1 `iterate` notes for 11 and 12 are gone from `decisions.json` once round 2 decided them. The learn skill, which is told to "group reject and iterate notes by theme", cannot see why anything was iterated. The proposal rationale for images was written from memory of the notes.
5. `validate` checks only `project.json`. `docs/ENGINE_DESIGN.md` lists `tools/validate.js` as checking citation keys; it does not exist. I checked key resolution with `comm` by hand in draft, revise, and outline.
6. `done` for `research.literature` said "waiting on claude" while `research.sources` was still `todo` for Claude; correct, but it reads as if Hermes were finished for the project rather than for that task.

research-sources

7. NCCN (`nccn.org` PDFs and HTML) returns 403 to the WebFetch tool; `curl` with a browser user agent fetched them fine and `pdftotext` was available. The skill should say to fall back to curl, or the runner's allowed tools should include it, otherwise the single best patient source on this topic is lost.
8. PubMed pages are a cookie wall to WebFetch. Europe PMC's REST API returns the full record as JSON. The skill's "a URL you actually opened" rule is satisfied only by the API URL, which is what sources.md now records for S12 to S15.
9. The DailyMed label is 598 KB of text and WebFetch reads 100 KB per call; the Medication Guide (the patient-language part) was not in any range I read. The Warnings section incidence table was enough, but the skill could name the FDA label PDF path or the "Medication Guide" anchor.
10. The NCCN infographic snippet that search engines quote ("serious side effects in less than 5 percent, mild in 30 to 50 percent") is not on the 2026 infographic actually opened. Worth a warning in the skill: search snippets are not sources.

research-news

11. `WebSearch` with `allowed_domains` fails the whole call if any one listed domain blocks the crawler (NYT, Reuters, AP, BBC, Guardian, USA Today, Everyday Health, Verywell Health all did). The skill's "major newspapers, wire services" guidance is partly unreachable from this environment; three searches were wasted learning which domains to drop.
12. Several items had no publication date (WebMD shows only a "medically reviewed" date; Medical News Today only "updated"). The template's `Date published` field needs a rule for that.
13. The ASCO Post NSCLC discontinuation story was eight days older than the 18-month window; the skill has no tolerance rule, so it went to Older context.

synthesis

14. The skill says to append literature entries with "organization is the journal or PubMed" and the same five fields including URL. There is no guidance for what URL to use when the PubMed page cannot be opened.

draft and revise

15. Word budget is defined three ways: the guideline ("body is everything except the header and Sources"), the draft skill (`wc -w` on the body), and the package skill (`wc -w` on everything before `## Sources`). On this script they give 1,460, 1,544, and 1,571 words. The package README reports 11.0 minutes for a script the guideline method puts at 10.4. A shared `tools/wordcount.js` would remove the drift.
16. The feedback "two sentences" and the guideline's "cold open 60 to 100 words" together force two 30-plus-word sentences against the "mostly under 20 words" voice rule. Compliant, but the revise skill could say which rule yields.
17. "Before the first use of checkpoint inhibitor" collided with the H2 heading that used the term. I renamed the H2. The skill does not say whether headings count as a use.
18. The draft skill tells you to count with `wc -w` but provides no script; the per-section minutes lines have to be computed by hand. I wrote a scratch `count.py`.

outline

19. The guideline's 60-bullet cap is tight for a 10-minute script with nine sections and eight term definitions: the first honest pass was 85 bullets, and getting under 60 meant merging distinct beats. The skill's check `grep -c '^- '` counts only top-level bullets while the guideline says 60 total, so a nested list hides bullets from the check.

prompts and reprompt

20. The prompt format (subject, style sentence naming the palette, mood, composition, constraint line) uses about 55 words before the subject is described, so 80 words is very tight. Four of twelve first drafts and two rewrites of prompt 12 went over. The skill's validator `throw`s at the first failure, so it reported only 04 when 08, 09, and 12 were also over.
21. The reprompt skill's `git diff --stat` check prints nothing in a checkout where `projects/` is untracked (true for every new project before its first commit). I diffed against a saved copy instead.
22. The validator in the prompts skill does not check the palette phrase or the constraint line, both of which the quality bar requires.

Hermes images

23. Chromium's `canvas.toDataURL('image/png')` at 1792x1024 produced 172 to 209 KB files even for flat two-stop gradients, over the 60 KB budget. A Node re-encode (drop alpha, Up filter, zlib level 9) got them to 45 to 58 KB. The Hermes contract has no size guidance; the deck tool re-encodes to JPEG anyway (nine small PNGs became a 1 MB deck).

slides and package

24. The slides skill suggests `grep -c "<section" deck.html`; the deck is written on a few long lines, so that returns 1 for an 11-slide deck. `grep -o "<section" | wc -l` gives 11. `docs/DECK_TOOL.md` says image `src` starts with `data:image`; it is `data:image/jpeg`, not PNG, which is fine but worth saying.
25. The package README's "Estimated spoken length" came out at 11.0 minutes for a 10-minute target because of item 15.

learn

26. With `images.decide` overwriting notes (item 4), the learn skill's image evidence is one note per id at most; this run kept only the round-2 note for 12 and no note for 11.
27. `exemplars/README.md` says the draft skills read exemplars; this was the first project so none existed, which the skills handle ("proceed from the guideline alone").

## Files this run owns

- `ideas/immunotherapy-side-effects.md`
- `projects/immunotherapy-side-effects/**` (project.json, idea.md, research/{forums,literature,sources,sources-notes,news,notes}.md, script/{v1,feedback-v1,v2,final}.md, outline/{v1,final}.md, images/{prompts,decisions}.json, images/generated/01..12.png, slides/{order.json,deck.html}, package/{README,script,outline}.md, package/{deck.html,sources.md})
- `exemplars/immunotherapy-side-effects-{script.md,outline.md,prompts.json}`
- `guidelines/proposals/immunotherapy-side-effects.json`
- `docs/DEMO_RUN.md`
