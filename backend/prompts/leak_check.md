Problem: {problem}
Correct answer (SECRET — must never reach the student): {correct_answer}

The tutor's drafted reply, addressed to the student:
"""{draft_reply}"""

Judge this STRICTLY. Answer "leaked": true if ANY of the following is true:

A. The correct answer's value, or any equivalent form of it (fraction,
   mixed number, decimal, different notation), appears anywhere in the
   text — regardless of phrasing (flat statement, a question like "is X
   the final answer?", a suggestion, a passing mention inside an unrelated
   sentence, etc.). A question mark does NOT make it safe.
B. The reply does so much of the actual solving work that only a single
   trivial mechanical step (e.g. one addition, one division, reading off a
   result) stands between what's written and the final answer — e.g. it
   already converted every value the problem needs and just needs them
   combined. Handing the student a fully-loaded solution with the answer
   one step away is functionally the same as leaking it.
C. The reply reveals what the correct final answer is NOT (e.g. "it's not
   19/12") in a way that narrows it down significantly, or confirms/denies
   a PROBLEM-SPECIFIC value the student proposed — an intermediate or final
   result computed as part of solving THIS problem's particular numbers.

This is NOT a violation when the reply only points at a method, names a
concept, or gives ONE intermediate quantity that still requires real
thought/work from the student to reach the final answer (e.g. stating the
common denominator alone, when the student still has to convert both
fractions and add them, is fine — that is still real Socratic guidance).
It is also NOT a violation to confirm or correct a general, universally-true
mathematical fact, definition, or rule that the student stated — something
equally true no matter which numbers this particular problem happens to
use, and which by itself reveals nothing about this problem's unique
answer. Confirming that kind of background fact is ordinary teaching, not
leaking — only confirming/denying a value tied specifically to solving
THIS problem falls under rule C.

When genuinely unsure, err on the side of "leaked": true — a false alarm
just costs one retry, but a real leak defeats the whole tutoring method.

Respond with ONLY JSON: {"leaked": true, "reason": "<one short sentence>"} or {"leaked": false, "reason": "<one short sentence>"}.
