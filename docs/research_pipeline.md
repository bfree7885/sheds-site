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

### 4. Move to /briefs to publish

To publish:

1. **Move** the draft file from `drafts/` to `briefs/`.
2. **Add a preview** to `briefs/index.html`:
   - Title (e.g. `<h2>…</h2>`)
   - Short summary (one or two sentences)
   - Link: `Read Full Brief →` pointing to the new file (e.g. `YYYY-MM-DD-topic.html` or a stable name you prefer).

After that, the brief is live. Each brief is a single page; the Field Notes index only shows previews and "Read Full Brief" links.

---

## File locations

| Location   | Purpose |
|-----------|---------|
| `drafts/` | Draft research briefs. Not public. Use `YYYY-MM-DD-topic.html` naming. |
| `briefs/` | Published Field Notes. Linked from the site. One HTML file per brief. |
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
