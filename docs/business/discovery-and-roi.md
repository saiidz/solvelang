# Discovery Questionnaire and ROI Calculator

## Discovery questionnaire

Use this before proposing automation. The goal is to understand the process, not to force SolveLang into the solution.

### Process
- What triggers the workflow?
- Who owns the outcome?
- What systems are involved?
- Which steps are deterministic rules versus judgment calls?
- Where does work wait for a person?
- What happens when a step fails?
- What exceptions happen most often?

### Volume and effort
- How many items enter the workflow per week or month?
- Average human minutes per item?
- Fully loaded hourly cost for the people doing the work?
- Rework or escalation rate?
- What work is delayed because of this process?

### AI suitability
- Which steps require classification, summarization, extraction, drafting, or reasoning?
- What errors would be merely inconvenient versus consequential?
- Which outputs require human approval?
- What data may or may not be sent to an AI provider?

### Technical constraints
- Existing SaaS tools and APIs
- Authentication/SSO requirements
- Data residency/security requirements
- Current automation platform
- Logging/audit requirements
- Expected support hours

### Buying process
- Who owns the budget?
- What would make this project worth paying for?
- Is there a deadline or event driving the work?
- What is the smallest useful pilot?

## ROI calculator

Use client-supplied inputs only. Do not present calculated savings as guaranteed results.

Let:

- `V` = workflow items per month
- `M` = current human minutes per item
- `R` = expected fraction of human effort removed or avoided after validation, from 0 to 1
- `C` = fully loaded labor cost per hour
- `P` = monthly platform/model/maintenance cost
- `I` = one-time implementation cost

Estimated monthly labor value potentially released:

`V × (M / 60) × R × C`

Estimated monthly net value:

`monthly labor value - P`

Simple payback period in months:

`I / monthly net value`

Only use the payback formula when monthly net value is positive.

## Example with fictional numbers

This is an illustration, not a SolveLang benchmark or customer result.

If a team processes 1,000 items/month, spends 4 minutes/item, estimates that a validated workflow could remove 50% of that handling time, and labor costs $45/hour:

`1,000 × (4/60) × 0.50 × $45 = $1,500/month` potential labor capacity released before platform/support costs.

The client must validate whether that time is actually saved, reassigned, or merely shifted elsewhere.
