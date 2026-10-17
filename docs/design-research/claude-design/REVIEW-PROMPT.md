# Review prompt (paste into Claude Design after each screen; fix Blocker and High only, then re-run)

"Review the current screen against the North design system and BRIEF.md as a skeptical
design critic. Do not praise. For each principle give a score 1-10 and name the element
(describe where it is) and the measurable fact that supports the score. A score without an
element and a fact is invalid.

1. Fit: which sentence of BRIEF.md does each visible element serve? Name any element with no
   sentence.
2. Hierarchy: describe the screen as if blurred. What reads first, second, third? Is first the
   headline (Home) or the question (card) or the H1 (landing)? Is there exactly one filled
   control above the fold?
3. Counted system: count type sizes (≤ 5), weights (≤ 2), colours (≤ 8, with needle red only
   on stopped/failed and verified green only on evidence/live), radii (≤ 3), shadows (sheet
   only). List every number you counted.
4. Craft: left edges (≤ 3 per fold), orphans in headings, tabular figures aligned, hairlines
   visible in dark, 44 px controls, 16 px gutters at 390, no horizontal overflow.
5. Earned motion: is any element implying decorative motion (shimmer, pulse, marquee)? It
   should not.
6. Instant acknowledgement: does every control have a visible pressed and focus state in the
   states frames?
7. Honest copy: is every string from SAMPLE-DATA or BRIEF voice rules? Any 'we', 'oops',
   'seamless', emoji, exclamation mark, Yes/No labels, K-codes alone?
8. Back of the drawer: are empty, loading, error, offline and long states designed, and does
   each empty state say what will appear and who makes it?
9. Restraint: name the weakest element; would the screen lose a decision or a feeling without
   it? If not, it is decoration.
10. Non-default: does anything match the banned list in BRIEF (boxes around sections, icon
    tiles, three identical cards, gradients, glows, uppercase tracked labels, mono data, purple,
    cream/terracotta, illustrations)?

Then the 5-second test: looking at the first viewport only, in one sentence each: what is this,
what does it want me to do, what do I remember? Compare with the screen's intent in BRIEF.

Output: what works (two lines), then at most seven findings ordered Blocker, High, Medium, Nit,
each as: principle · element · fact · fix · expected effect. Then the ten scores."
