Problem: {problem}
Correct answer: {correct_answer}
Student's submitted answer: {student_answer}

Determine, carefully and precisely, whether the student's submission is
mathematically equivalent to the correct answer. Account for different
equivalent forms (fraction / mixed number / decimal, reduced vs unreduced,
different order or notation of the same value, extra whitespace, units
written or omitted, a number written in Armenian words, etc.) — but do NOT
be lenient about actual numeric differences: a wrong value in any form is
still wrong, and an unrelated or nonsensical submission (e.g. random text,
an insult, an empty-feeling non-answer, a question, or a message that only
talks about an intermediate step) is always "correct": false. If the
problem has several parts, the submission is correct only if it gives the
correct answer to EVERY part. Double-check your own arithmetic before
deciding — do not guess.

The student must COMMIT to one answer. If the submission offers two or more
different candidate values for the same question (e.g. "is it A) 19/12 or
B) 5/2?", "maybe 380 or 420", "one of 7, 8, 9"), it is "correct": false even
if one of the candidates is right — otherwise a student could find the answer
by listing options. A single value asked as a question ("is it 19/12?") still
counts as committing to that value.

Respond with ONLY JSON: {"correct": true} or {"correct": false}.
