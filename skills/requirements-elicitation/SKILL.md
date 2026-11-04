---
name: requirements-elicitation
description: How the AI PM turns a client's feature idea into candidate requirements, finds the gaps that block an assessment, and picks a short questionnaire with predefined answers from the question bank.
---

## Goal

Get just enough information to assess a feature (scope, value, effort, risk) while asking the client as little as possible. The client is not technical; questions must be plain and answerable in one click.

## Procedure

1. Restate the idea in two or three sentences, in the client's terms.
2. List candidate requirements. Mark each as **stated** (the client said it) or **inferred** (it follows from the idea or the baseline, for example "works offline" from the GDD). Include non-functional ones (performance, compatibility, compliance) whenever the idea touches them.
3. Check the idea against the assessment checklist below. Every item that is unknown and that changes the estimate, the value case or the risk is a **gap**. Mark a gap **critical** when the assessment cannot be made without it.
4. Choose questions from the question bank for the gaps. Rules:
   - Always include `goal`, `kpi_impact`, `deadline` and `budget`, unless the description already answers them clearly.
   - Add at most 4 more, for the gaps with the biggest effect on effort, value or risk.
   - **8 questions at most.** Never ask what the description or the baseline already answers.
   - Use the bank's id and options. You may reword a question to fit the feature, and you must tailor `kpi_impact` options to the chosen goal.
   - At most 2 custom questions (`custom_1`, `custom_2`), only when no bank question fits a critical gap. They need 2–6 predefined options.
   - Do not add a "not sure" option; it is added to every question automatically.
5. Write a short `why` for each question, so the client sees why it matters.

## Assessment checklist

Business goal · target players · expected KPI effect · deadline · budget envelope · MVP flexibility · gameplay impact (cosmetic, content, mechanics, physics) · platforms · connectivity · monetization · performance floor · personal data and audience age · art and content source · live-ops needs.

## Question bank

| id                | Question                                              | Kind   | Options (value: label)                                                                                                                                                |
| ----------------- | ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| goal              | What is the main business goal of this feature?       | single | retention: Keep players coming back · iap: More in-app purchase revenue · ads: More ad revenue · acquisition: Attract new players · partner: A partner or brand deal  |
| audience          | Who is the feature mainly for?                        | multi  | new: New players (first week) · casual: Casual regulars · payers: Paying players · lapsed: Players who stopped playing · everyone: Everyone                           |
| kpi_impact        | What effect do you expect on the main KPI?            | single | Tailor to the goal, three ranges low/mid/high, e.g. for retention: d7_low: Day-7 retention +0.5 to 1 pt · d7_mid: +1 to 3 pts · d7_high: more than 3 pts              |
| deadline          | Is there a deadline?                                  | single | fixed: Yes, a fixed date (event or season) · next_release: The next planned release · flexible: Flexible, value first                                                 |
| budget            | How much extra budget is acceptable?                  | single | none: None, re-prioritize within the current budget · up_to_10: Up to 10 % more · up_to_25: Up to 25 % more · value_driven: Whatever the value justifies              |
| scope_flexibility | Would a smaller first version be acceptable?          | single | full: Only the full feature · mvp: Yes, an MVP first, then iterate · prototype: A prototype first, to test the idea                                                   |
| gameplay_impact   | How should it affect gameplay?                        | single | cosmetic: Looks only, no gameplay change · content: New content on existing mechanics · mechanics: New or changed mechanics · physics: Changes to movement or physics |
| platforms         | Which platforms need it?                              | multi  | ios: iOS · android: Android · web: Web                                                                                                                                |
| connectivity      | Must it work offline?                                 | single | offline: Yes, fully offline · online: Online is fine · hybrid: Offline, syncing when online                                                                           |
| monetization      | How should the feature make money, if at all?         | multi  | free: It is free · soft_currency: Coins · iap: Real-money purchases · rewarded_ads: Rewarded ads · pass: A season pass                                                |
| performance_floor | Which devices must run it smoothly?                   | single | low_end_60: 60 FPS even on low-end phones · low_end_30: 30 FPS on low-end phones is fine · high_end: High-end phones only                                             |
| personal_data     | Does it collect new personal data or target children? | single | none: No new personal data · consent: New data, consent needed · children: Players under 13                                                                           |
| art_content       | Where does the art and content come from?             | single | reuse: Reuse existing assets · in_house: New assets made by the team · outsourced: Outsourced or licensed assets                                                      |
| live_ops          | Does it need ongoing updates?                         | single | one_off: No, it ships once · seasonal: Seasonal updates · continuous: Continuous live-ops                                                                             |

## Follow-up round

After the answers arrive, ask a second round only if a gap is still **critical**: at most 3 questions, same rules. Every "not sure" answer becomes an assumption stating the default the team will use (for example "Not sure about platforms → assume iOS and Android, as in the baseline").
