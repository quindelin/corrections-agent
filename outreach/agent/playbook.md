---
name: outreach-playbook
description: How Redline's outreach messages are written. The learning step rewrites this file, and the change is reviewed as a git diff.
---

# Redline outreach playbook

We write to small Chicago architecture firms and permit expediters who file 2 to 6 flats, coach houses and renovations. We want three things, most important first: real correction letters, an architect's review of our answer key, and early users.

## Voice

- Write like one person writing to another: plain, short, specific.
- Say what you want in the first two sentences.
- About 60 words of your own, not counting the inserted claims. The limit is 110.
- Never describe Redline or its testing in your own words. Insert the claims.
- Ask for one thing, and make it easy to say no.
- Address the firm by name. Use a person's name only if a fact you were given names them.

## Personalizing

- Use at most one fact about the recipient, and only to explain why you're writing to them.
- Prefer what the firm says about its own work over a permit count.
- Don't praise work you can't judge.

## By segment

- `architecture_firm`: they answer for the drawings and sign the certification, so ask for their professional judgment.
- `permit_expediter`: they see many letters across many projects, so ask what patterns they see and whether they could share a redacted letter.

## Asks

- A redacted correction letter from a finished project, so we can test against something real.
- Twenty minutes to tell us where our answer key is wrong.
- Don't offer money, discounts or free services. Nobody has approved an offer yet.

## Variants

Each message uses exactly one variant, and the code assigns it. A variant's text is frozen once it exists: to change an idea, add a new variant with a new id.

<!-- variants:start -->
```json
[
  {
    "id": "V1-time-share",
    "status": "active",
    "segments": [
      "architecture_firm",
      "permit_expediter"
    ],
    "angle": "Open by saying you want a critique of the answer key from someone who deals with these letters. Insert the permit-time claim as the reason this is worth their attention, then the claims about Redline, then ask.",
    "ask": "Twenty minutes to tell us where our answer key is wrong.",
    "required_claims": [
      "chicago_time_share_2024"
    ]
  },
  {
    "id": "V2-need-real-letters",
    "status": "active",
    "segments": [
      "architecture_firm",
      "permit_expediter"
    ],
    "angle": "Open by saying you need real correction letters to test against. Insert the claims about Redline, which explain why, then ask.",
    "ask": "One redacted correction letter from a finished project.",
    "required_claims": []
  },
  {
    "id": "V3-why-letters-come-back",
    "status": "proposed",
    "segments": [
      "architecture_firm",
      "permit_expediter"
    ],
    "angle": "Open with a question about which correction comments cost them the most time. Insert the claims about Redline, then ask.",
    "ask": "A short reply naming the kind of comment that costs them the most time.",
    "required_claims": []
  }
]
```
<!-- variants:end -->

## Open questions

- Does naming a permit count feel useful or intrusive to recipients?
- Do expediters and architects need different asks?

## Standing

Written by code from the outcome log. Edits to this section are discarded.

<!-- standing:start -->
No outcomes recorded yet.
<!-- standing:end -->
