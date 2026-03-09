# Sheds Field Notes AI Writing Prompt

Your task is to summarize research relevant to whitetail deer behavior,
winter ecology, terrain use, and antler shed timing.

Write for a **high school science reading level**.

The output must generate a **publish.json file** that follows this structure.

---

## Article Requirements

The article must contain these sections:

Research Summary  
Key Findings  
Interpretation  
Sheds Take  
Source Link

---

## Writing Guidelines

Research Summary
Explain what the study investigated and why it matters.

Key Findings
List 3–4 important findings from the research.

Interpretation
Explain what the findings mean for deer ecology and movement.

Sheds Take
Translate the research into terrain strategy for shed hunters.

Source
Provide a link to the original research article.

---

## Output Format

Return ONLY this JSON structure.

{
"title": "Article Title",
"date": "Month Day, Year",
"content": "<p class='section'>Research Summary</p><p>Summary text.</p><p class='section'>Key Findings</p><ul><li>Finding one</li><li>Finding two</li><li>Finding three</li></ul><p class='section'>Interpretation</p><p>Interpretation text.</p><p class='section'>Sheds Take</p><p>Shed hunting insight.</p><p class='section'>Source</p><p><a href='SOURCE_URL' target='_blank'>Read Original Research</a></p>"
}
