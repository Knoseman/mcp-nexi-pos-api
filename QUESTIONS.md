# MCP Nexi POS API - Remaining Questions

## Product scope

1. Should the first version be an MVP focused on payments, or a fuller MCP server covering all endpoints?
   - mvp, payments only

2. Which tools should be included in v1?
   - [X] `create_purchase`
   - [X] `create_refund`
   - [X] `confirm_transaction`
   - [X] `get_transaction`
   - [ ] `continue_transaction`
   - [X] `get_unconfirmed_transactions`
   - [ ] `get_terminal_status`
   - [ ] `list_events`

3. Should the MCP server hide the confirm flow behind a single `take_payment` tool, or expose the raw API steps as separate tools?
   - [X] Both

Recommended: both:
   - high-level `take_payment`
   - low-level tools for support/debugging

## Runtime and storage

4. Do you want this in TypeScript/Node.js using the official MCP SDK?
   - [X] Use what’s simplest

5. Should the server persist transaction state locally?
   This is important because Nexi recommends stable storage before sending payments.

Options:
- SQLite
- JSON file
- [X] no storage for MVP
- pluggable storage later

6. If storage is used, should it store:
   - external IDs
   - terminal IDs
   - transaction result
   - confirm status
   - receipts
   - full raw API response

## Payment behavior

7. Should `take_payment` automatically call `/transaction/confirm` when the transaction reaches `AWAITING_CONFIRM`?
 - No, not unless specifically instructed to do so

8. Should failed/non-success transactions also be confirmed automatically?
 - No, not unless specifically instructed to do so

9. What should be the default long-poll wait time?
   Nexi default is 25 seconds. Max is 180 seconds.
 - 25 seconds

10. What should be the total payment timeout before the MCP tool returns or aborts?
 - 15 seconds

11. Should the MCP tool keep polling until final result, or return early with `external_id` so the user can check later?
 - read documentation for this answer

## Safety

12. Should real payments require an explicit confirmation argument, for example `confirm_real_payment: true`?
 - No

13. Should production use be blocked unless `NEXI_POS_ENABLE_REAL_PAYMENTS=true`?
 - No

14. Should we add max amount limits by config?
 - Yes, max 5 EUR or equal value in other currencies

15. Should refunds require stricter confirmation than purchases?
 - No

## Defaults

16. What default currency should we use?
   For Sweden, likely `SEK`.
 - SEK

17. Should amounts be accepted as:
   - integer minor units only, e.g. `10000`
   - decimal string, e.g. `"100.00"`
   - both, converting to minor units internally
 - Read documentation for amount syntax

18. Should terminal ID be required for every tool call, or configured as a default environment variable?
 - Provided Terminal ID should be set as variable for each session, until overwritten or manually cleared

## Testing

19. Do you have a simulated terminal ID already?
 - Terminal ID will be provided manually at the start of each session.

20. Should we build mock mode so tests work without Nexi credentials?
 - No

21. Should we include automated tests from the start using simulator amounts like:
   - `100002` instant success
   - `100004` customer cancelled
   - `100006` bank declined
 - No

## Packaging

22. Should this repo be prepared for:
   - Claude Desktop MCP config
   - npm package
   - Docker
   - GitHub Actions
 - I don’t know

23. Should the server be named/package-named `mcp-nexi-pos-api`?
 - Yes

24. Should logs avoid sensitive data and card-related fields by default?
 - Yes
