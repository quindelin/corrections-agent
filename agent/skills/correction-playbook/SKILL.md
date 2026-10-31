---
name: correction-playbook
description: The checklist to run on every correction comment. Use it each time you answer a correction letter, before you write any item.
---

# Correction playbook

Go through every item for each comment.

1. **Discipline.** What is the comment really about?
2. **Citation.** Which section governs it? Look it up.
3. **Route.** Who has to act next?
   - If the comment asks for design data, dimensions, calculations, or professional judgment (e.g., "show," "dimension," "indicate," "provide," "add"), route to `licensed_review`.
   - If the comment asks for a document or fact from outside the design team (owner, contractor, consultant, other agency), route to `client_input` or `other_agency`.
   - If the comment is a clerical correction to a drawing (title block, sheet index, date), route to `agent_draft`.
   - If the comment needs no response, route to `no_action`.
4. **Sheets.** Which sheets change?
   - Include only sheets that the licensed professional must revise.
   - Do not include sheets that are merely referenced or coordinated with.
   - For `client_input` and `other_agency` routes, use `[]`.
5. **Draft.** Write the response for the licensed professional to sign.
   - For `licensed_review` items: describe what will be revised, without stating a compliance conclusion or supplying design values.
   - For `agent_draft` items: state the clerical correction that will be made.
   - For `client_input` and `other_agency` items: state what will be submitted or obtained.
   - For `no_action` items: use `""`.
   - All `licensed_review`, `agent_draft`, `client_input`, and `other_agency` items must include: "will be bubbled, dated and initialed" or equivalent language indicating the revision is marked per Certified Plan Corrections protocol.
