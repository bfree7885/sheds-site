# Research Pipeline — Field Notes

This document describes the workflow for turning deer biology and wildlife research into published Field Notes briefs.

---

## Workflow

### 1. AI generates draft

An AI (or human) summarizes a research paper into the standard brief structure:

- **Title**
- **Research Summary** — Clear explanation of the scientific paper
- **Key Findings** — Bullet points summarizing results
- **Interpretation** — Biological meaning of the findings
- **Terrain Implications (Sheds Take)** — Practical terrain insights for shed hunters
- **Citation** — Full academic citation
- **Source Link** — External link to the original research paper

The draft is written using the standard article template (`drafts/TEMPLATE.html`). Replace the placeholders with real content.

### 2. Draft saved in /drafts

Save the draft as an HTML file in the **drafts** folder.

**File naming format:** `YYYY-MM-DD-topic.html`

**Example:** `2026-03-09-late-winter-habitat-compression.html`

Drafts in `/drafts` are not linked from the public site. They are for review and editing only.

### 3. Review draft

Open the draft file locally. Check:

- All sections are filled and accurate
- Citation and source link are correct
- Terrain implications are practical and clear
- Filename follows `YYYY-MM-DD-topic.html`

Edit as needed. No need to change paths — the template uses the same relative paths as published briefs.

### 4. Move to /briefs and build

To publish:

1. **Move** the draft file from `drafts/` to `briefs/`.
2. **Run the build script** to regenerate the Field Notes feed:
   ```bash
   python scripts/build_field_notes.py
   ```

The build script reads all `.html` files in `briefs/` (except `index.html`), extracts article content, sorts by date (newest first), and writes `briefs/index.html`. The Field Notes page is a single scrolling feed of full articles.

**Note:** External Source Link must point to the real research paper or report. Do not use placeholder links (e.g. Google Scholar search). If no direct source exists, omit the External Source Link section.

---

## File locations

| Location   | Purpose |
|-----------|---------|
| `drafts/` | Draft research briefs. Not public. Use `YYYY-MM-DD-topic.html` naming. |
| `briefs/` | Published brief source files. One HTML file per article. |
| `briefs/index.html` | Generated feed page (built by script). Do not edit by hand. |
| `scripts/build_field_notes.py` | Build script. Run after adding or editing briefs. |
| `drafts/TEMPLATE.html` | Reusable template for new drafts. Copy, replace placeholders, save as new draft. |
| `docs/research_pipeline.md` | This workflow document. |

---

## Template placeholders

When using `drafts/TEMPLATE.html`, replace:

- `[TITLE]` — Brief title (used in `<title>` and `<h1>`)
- `[YYYY-MM-DD]` — Publication date
- `[RESEARCH_SUMMARY]` — Paragraph(s) summarizing the paper
- `[FINDING_1]`, `[FINDING_2]`, `[FINDING_3]` — Key findings (add or remove `<li>` as needed)
- `[INTERPRETATION]` — Biological interpretation
- `[TERRAIN_IMPLICATIONS]` — Sheds Take section
- `[CITATION]` — Full citation text
- `[SOURCE_URL]` — URL of the original paper
- `[SOURCE_LINK_TEXT]` — Link label (e.g. paper title or "Read the paper")

Keep the existing CSS and layout. Do not remove or reorder the main sections.
