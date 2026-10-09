# Oncoscriptor engine design (draft 0)

Working document. Sections marked **DECIDE** need your answer before build starts.

## What the flow asks for

A pipeline that turns an oncology video idea into a reviewed package of three things.

| Deliverable | Produced by |
|---|---|
| Final script | Research, draft, physician iteration |
| Talking-points outline | Derived from the approved script |
| HTML slideshow | Approved images dropped into a template |

Three "learning" loops sit beside the pipeline. Each one updates a guideline from approved work.

| Loop | Input | Output |
|---|---|---|
| Script | Approved scripts, your edits | Script templates per video type |
| Image | Approved and rejected images and prompts | Image guidelines |
| Outline | Approved outlines, your edits | Outline guidelines |

## Stage by stage

1. **Idea repository.** Ideas arrive from you or from Hermes. Each idea has a status, a video type, and a source.
2. **Request.** You pick an idea from the repository or type a new one. This starts a video project.
3. **Research.** Scoped by video type. Pulls primary sources and produces a sources list and research notes.
4. **Draft script.** Written against the script template for that video type and the research notes.
5. **Iterate script.** You and the AI revise until you approve. Each pass is saved as a version.
6. **Image branch.** Twelve image prompts come from the approved script, guided by the image guidelines. Images are generated, shown on a review page with approve, reject, and iterate, and the approved set goes into the slideshow template.
7. **Outline branch.** A talking-points outline is derived from the approved script, guided by the outline guidelines. You iterate until satisfied.
8. **Package.** Script, outline, and slideshow are bundled for recording.

## How I read the learning loops

The boxes say "AI training." Read them as guideline refinement, not model fine-tuning. The mechanism is a diff. After you approve a script, the engine compares the first draft to the approved version, proposes amendments to the template, and you accept or reject each one. The same applies to image prompts and outlines. Approved artifacts are also kept as exemplars that the next draft can read. This gives the same effect as training, stays inspectable, and costs nothing.

## Proposed shape

The repo is the engine. Git is the shared bus between Claude and Hermes. Every stage reads and writes files in a fixed layout, so either agent can pick up where the other left off.

```
ideas/                     one markdown file per idea, frontmatter holds status, type, source
guidelines/
  script/<video-type>.md   script template per video type
  images.md
  outline.md
  slideshow.md
exemplars/                 approved scripts, outlines, prompts the drafts can read
videos/<slug>/
  idea.md
  research/sources.md      every claim traceable to a PMID, DOI, or guideline section
  research/notes.md
  script/v1.md ... final.md
  outline/final.md
  images/prompts.json      12 prompts with slide position and purpose
  images/generated/        raw output from the image model
  images/decisions.json    approve, reject, iterate per image
  images/approved/
  slideshow/index.html
  package/
templates/slideshow/       the HTML slideshow template
tools/                     review page server, package builder
.claude/skills/            one skill per stage
```

Stages become Claude Code skills you call in order.

| Skill | Does |
|---|---|
| `/idea` | Capture an idea or list open ones |
| `/research` | Research a video, write sources and notes |
| `/draft` | Write script v1 from template and notes |
| `/revise` | Apply your feedback, bump the version |
| `/outline` | Derive the talking-points outline |
| `/images` | Write the 12 prompts, hand off to the image generator |
| `/slides` | Build the slideshow from approved images |
| `/package` | Bundle the three deliverables |
| `/learn` | Diff draft against approved, propose guideline edits |

## Division of labor

| Stage | Claude | Hermes | You |
|---|---|---|---|
| Idea capture | | Scans feeds, writes idea files | Writes idea files |
| Research | Web search, PubMed, guideline sites | | Verifies sources |
| Draft and revise script | Writes | | Reviews, approves |
| Outline | Writes | | Reviews, approves |
| Image prompts | Writes | | |
| Image generation | | Runs local model or calls an API | |
| Review page | Builds the page | Serves it locally, records decisions | Clicks approve, reject, iterate |
| Slideshow | Assembles | | Reviews |
| Guideline learning | Proposes edits | | Accepts or rejects |

Hermes is placed where local compute or local hosting matters. Everything else is text work and fits Claude.

## Medical content rules to bake in

- Every factual claim in a script carries a citation key that resolves in `sources.md`.
- Research records the date it ran and the guideline versions it used.
- Audience is declared per video type. Patient-facing and clinician-facing scripts use different templates.
- No patient data enters the repo.
- You remain the approval gate at script, outline, and image stages. Nothing ships without your sign-off.

## DECIDE

1. **Video types.** List them, with audience and typical length. Candidates are trial breakdown, mechanism explainer, patient education, news commentary, board review.
2. **Script length.** Target minutes per type. Is twelve images fixed, or scaled to length?
3. **Hermes.** What framework runs it, can it run shell and git, and does it host an image model? Should it talk to the engine through git, a shared folder, or HTTP?
4. **Image generator.** Local model through Hermes, or an API such as OpenAI images, Google Imagen, or Adobe Firefly.
5. **Slideshow template.** Do you have one, or should I start from reveal.js or a custom single-file template?
6. **Citation standard.** PMID or DOI on every claim, and which guideline bodies count (NCCN, ASCO, ESMO, others).
7. **Where it runs.** Claude Code in this repo, or a standalone app with its own UI.
8. **Package format.** Folder, zip, or something a teleprompter can read.
