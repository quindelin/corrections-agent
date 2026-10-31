---
name: local-seattle
description: Rules learned for projects in Seattle (jurisdiction id "seattle"). Use only when the project's jurisdiction is seattle.
---

# Seattle rules

**Code edition notes.** When a comment asks to add code edition references to the plans, route to `no_action`. Seattle's reviewers do not expect a response letter item for code edition compliance notes.

**Energy compliance certificates.** When a comment asks to include a blank energy compliance certificate form on the plans, route to `no_action`. This is a standard submittal requirement, not a correction.

**Site plan requirements.** When a comment asks to add a site plan per a city tip or standard, route to `agent_draft`, not `licensed_review`.

**Addressing and site plan notes.** When a comment asks to add a note to the site plan about construction activity or features, route to `agent_draft`.

**Discipline from review category.** Use the city's stated review category (e.g., "Zoning review," "Structural review," "Fire review") to determine discipline, not the comment's subject matter alone.

**Citation from similar comments.** When a comment shows `[code reference removed]`, use `similar_comments` to find what this city's reviewers cite on the same topic, then confirm with `get_section`. Do not guess or cite sections from other cities.

**Draft language.** Use the city's own wording and process language from past correction letters. Do not use generic or out-of-jurisdiction language.

**Geotechnical citations.** Geotechnical comments in Seattle cite SMC 22.17 or SMC 25.09, not other sections. Confirm the specific subsection with `get_section`.

**Drainage discipline.** Comments about stormwater collection, footing drains, and drainage conveyance are drainage discipline, not geotech.

**Egress vs. structural.** Comments about guards, railings, and egress windows are egress discipline, not structural.

**Energy vs. MEP.** Comments about exhaust fans, ventilation systems, and roof vents are MEP discipline, not energy.

**Tree discipline.** Comments about tree maintenance, tree protection, and SDOT tree permits are tree discipline. Use the city's stated review category (zoning) to determine if the comment is about zoning compliance or tree requirements.

**Zoning vs. addressing.** Comments about primary entrances and unit identification on site plans are addressing discipline, not zoning.

**No response for incomplete review.** When a comment states that review cannot be completed until a related permit or document is issued or recorded, route to `no_action`. The city will resume review when the condition is met.

**Landscape plan references.** When a comment asks to remove or update a reference to a landscape plan that is not provided, route to `agent_draft`.

**Deferred submittals.** When a comment asks to confirm whether an item will be a deferred submittal, route to `licensed_review`.

**Geotechnical special inspector notes.** When a comment asks to add notes about geotechnical special inspector requirements or seasonal grading restrictions, route to `licensed_review`.

**Maneuvering easement notes.** When a comment asks to include a record number or recording number in a maneuvering easement note, route to `client_input`.

**Master Use Permit coordination.** When a comment states that building permit review cannot proceed until a Master Use Permit is issued, route to `no_action`.

**SDOT coordination.** When a comment asks to update plans with SDOT-approved information (e.g., street tree locations, conceptual approval stamps), route to `other_agency`.

**Structural calculations and design.** When a comment asks to revise structural design or calculations (e.g., footing design, lateral load resistance, guard loading), route to `licensed_review`.

**Fire-rated assemblies.** When a comment asks to revise a wall or assembly to be fire-rated, route to `licensed_review`.

**Safety glazing locations.** When a comment asks to clearly indicate safety glazing locations on plans, route to `licensed_review`.

**Emergency escape windows.** When a comment asks to provide or revise emergency escape windows, route to `licensed_review`. Do not state compliance conclusions in the draft.

**Obstruction of egress.** When a comment identifies an obstruction to an egress window or path, route to `licensed_review`. Describe the revision without stating compliance.

**NFPA standards.** When a comment asks to revise fire protection system notes to reference NFPA standards, route to `licensed_review`.

**Building address visibility.** When a comment asks to specify building address visibility, route to `licensed_review`.

**Existing vs. new construction.** When a comment asks to clarify existing vs. new construction on plans, route to `licensed_review`.

**AADU floor plan labeling.** When a comment asks to label a floor plan as "AADU floor plan," route to `agent_draft`.

**Description of work.** When a comment asks to provide a description of work on the plans, route to `licensed_review`.

**Party wall details.** When a comment asks to remove a party wall detail that does not apply to the project, route to `agent_draft`.

**Roof ventilation calculations.** When a comment asks to provide roof ventilation calculations and vent sizing, route to `licensed_review`.

**Exterior stair and landing details.** When a comment asks to clarify roof assembly or insulation at exterior stairs and landings, route to `licensed_review`.

**Excavation profiles and grading.** When a comment asks to provide section details showing excavation profiles and grading, route to `licensed_review`.

**Townhouse vs. apartment classification.** When a comment asks to specify the governing code for architectural design based on unit classification, route to `licensed_review`.

**EERO window placement.** When a comment asks to revise EERO window placement to open to a yard or public way, route to `licensed_review`.

**Geotechnical report completeness.** When a comment asks to upload a complete geotechnical report with missing logs or data, route to `client_input`.

**Scooter garage design.** When a comment asks to document scooter garage design, access pathways, and door widths, route to `licensed_review`.

**Green Building Inspection Form.** When a comment asks to update an embedded Green Building Inspection Form, route to `agent_draft`.

**Elevator recall levels.** When a comment asks to specify primary and secondary elevator recall levels, route to `licensed_review`.

**Roof deck access and guard loading.** When a comment asks to coordinate parapet design for guard loading near roof access, route to `licensed_review`.

**Deck and guard clarification.** When a comment asks to clarify whether an existing deck and/or guard exists and to show conformance with guard requirements, route to `licensed_review`.

**Revision marking.** Seattle reviewers do not require standard revision marking language in response letters. Do not add "will be bubbled, dated and initialed" or similar language unless the city's own letters show it.
