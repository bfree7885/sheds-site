#!/usr/bin/env python3
"""
Build the Field Notes single-page research feed from individual brief files.

Reads all .html files in briefs/ (except index.html), extracts article content,
sorts by date (newest first), and writes briefs/index.html.

Usage: python scripts/build_field_notes.py

Run after adding or editing briefs in /briefs.
"""

import re
from pathlib import Path
from datetime import datetime

BRIEFS_DIR = Path(__file__).resolve().parent.parent / "briefs"
OUTPUT_FILE = BRIEFS_DIR / "index.html"


def parse_brief(path):
    """Parse a brief HTML file. Returns (sort_key, title, date, sections, external_url, external_text)."""
    text = path.read_text(encoding="utf-8")

    # Extract body content only (between body tags)
    body_match = re.search(r"<body[^>]*>([\s\S]*?)</body>", text, re.IGNORECASE)
    body = body_match.group(1) if body_match else text

    title = ""
    m = re.search(r"<h1[^>]*>([^<]+)</h1>", body)
    if m:
        title = m.group(1).strip()

    date = ""
    m = re.search(r"<em>Published\s+([^<]+)</em>", body)
    if m:
        date = m.group(1).strip()

    try:
        dt = datetime.strptime(date, "%B %d, %Y")
    except ValueError:
        try:
            dt = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            dt = datetime.min
    sort_key = dt

    sections = {}

    # Research Summary, Interpretation, Terrain Implications, Citation: <p class="article-section">Label</p><p>content</p>
    for label in [
        "Research Summary",
        "Interpretation",
        "Terrain Implications (Sheds Take)",
        "Citation",
    ]:
        pattern = rf'<p class="article-section">\s*{re.escape(label)}\s*</p>\s*<p[^>]*>([\s\S]*?)</p>'
        m = re.search(pattern, body)
        if m:
            sections[label] = re.sub(r"\s+", " ", m.group(1).strip())

    # Key Findings: <ul><li>...</li></ul>
    m = re.search(
        r'<p class="article-section">Key Findings</p>\s*<ul[^>]*>([\s\S]*?)</ul>',
        body,
    )
    if m:
        ul_content = m.group(1)
        items = re.findall(r"<li[^>]*>([^<]*(?:<[^/][^>]*>[^<]*)*)</li>", ul_content)
        items = [re.sub(r"<[^>]+>", "", x).strip() for x in items if x.strip()]
        sections["Key Findings"] = items

    # External Source Link: skip if Google Scholar
    external_url = ""
    external_text = ""
    m = re.search(
        r'<p class="article-section">External Source Link</p>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([^<]+)</a>',
        body,
    )
    if m and "scholar.google" not in m.group(1).lower():
        external_url = m.group(1).strip()
        external_text = m.group(2).strip()

    return (sort_key, title, date, sections, external_url, external_text)


def render_article(title, date, sections, external_url, external_text):
    """Render one article as HTML."""
    parts = [
        '<article class="field-note">',
        f"<h2>{title}</h2>",
        f"<p><em>Published {date}</em></p>",
    ]

    section_order = [
        "Research Summary",
        "Key Findings",
        "Interpretation",
        "Terrain Implications (Sheds Take)",
        "Citation",
    ]

    for label in section_order:
        if label in sections:
            parts.append(f'<p class="article-section">{label}</p>')
            content = sections[label]
            if label == "Key Findings":
                parts.append("<ul>")
                for item in content:
                    parts.append(f"<li>{item}</li>")
                parts.append("</ul>")
            else:
                parts.append(f"<p>{content}</p>")

    if external_url and external_text:
        parts.append('<p class="article-section">External Source Link</p>')
        parts.append(
            f'<p class="external-source">'
            f'<a href="{external_url}" target="_blank" rel="noopener">{external_text}</a>'
            f"</p>"
        )

    parts.append("</article>")
    return "\n".join(parts)


def main():
    brief_files = [f for f in BRIEFS_DIR.glob("*.html") if f.name != "index.html"]
    if not brief_files:
        print("No brief files found in", BRIEFS_DIR)
        return

    articles = []
    for path in brief_files:
        try:
            sort_key, title, date, sections, ext_url, ext_text = parse_brief(path)
            articles.append((sort_key, title, date, sections, ext_url, ext_text))
        except Exception as e:
            print(f"Warning: could not parse {path}: {e}")

    articles.sort(key=lambda x: x[0], reverse=True)

    article_html = "\n\n".join(
        render_article(t, d, s, u, txt) for _, t, d, s, u, txt in articles
    )

    index_html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sheds | Field Notes</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="../styles.css">
<style>
  body {{ background: #0b2433; color: #e6edf3; font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 40px; max-width: 900px; }}
  .page-nav {{ margin-bottom: 24px; }}
  .page-nav a {{ color: #9adf3f; text-decoration: none; font-weight: 600; }}
  .page-nav a:hover {{ text-decoration: underline; }}
  .nav-divider {{ margin: 0 12px; color: #6a8f3a; }}
  .field-note {{ margin-bottom: 48px; padding-bottom: 40px; border-bottom: 1px solid #355166; }}
  .field-note:last-of-type {{ border-bottom: none; }}
  .field-note h2 {{ margin-bottom: 8px; color: #e6edf3; }}
  .field-note p {{ line-height: 1.65; color: #e6edf3; margin: 0 0 12px 0; }}
  .article-section {{ margin-top: 20px; font-weight: bold; color: #9adf3f; }}
  ul {{ line-height: 1.6; color: #e6edf3; }}
  .external-source {{ margin-top: 8px; }}
  .external-source a {{ color: #9adf3f; text-decoration: none; font-weight: 600; }}
  .external-source a:hover {{ text-decoration: underline; }}
  .bottom-nav {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #355166; }}
  .bottom-nav a {{ color: #9adf3f; text-decoration: none; font-weight: 600; }}
  .bottom-nav a:hover {{ text-decoration: underline; }}
</style>
</head>
<body>

<nav class="page-nav">
<a href="../index.html">Home</a><span class="nav-divider">→</span>
<a href="../field-guide/index.html">Field Guide</a><span class="nav-divider">→</span>
<a href="../fieldview.html">Field View</a>
</nav>

<h1>Field Notes</h1>

<p>
Field Notes summarizes research and wildlife monitoring that may influence deer
movement and shed timing. Each brief uses the same structure: Research Summary,
Key Findings, Interpretation, Terrain Implications, Citation, and External Source.
</p>

{article_html}

<nav class="bottom-nav">
<a href="../index.html">← Back to Home</a>
</nav>

</body>
</html>
'''

    OUTPUT_FILE.write_text(index_html, encoding="utf-8")
    print(f"Built {OUTPUT_FILE} with {len(articles)} articles")


if __name__ == "__main__":
    main()
