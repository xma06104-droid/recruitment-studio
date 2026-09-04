ALTER TABLE ai_questions ADD COLUMN keywords TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_questions ADD COLUMN reference_answer TEXT NOT NULL DEFAULT '';

UPDATE ai_questions
SET keywords = competency
WHERE TRIM(keywords) = '';
