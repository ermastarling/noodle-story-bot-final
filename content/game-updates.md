# Game Updates

This file is the source for scheduled game updates (loaded by the bot; no JSON needed).
Edit the title and body of an update, then preview it with `/noodle-dev admin game_update_preview update_id:<id>`.
Schedule it with `/noodle-dev admin game_update_schedule`. The text is snapshotted at schedule time, so later edits do not change an already-scheduled post.

How it is posted: a banner image, then the title as a heading (`## Title`), then the body, then the announcement role mention(s) in production (none in the private canary). Use Discord markdown (`**bold**`, `_italic_`, `-# small text`, `<t:UNIX:F>` dates). Title: 1-100 characters. Body: up to 3500 characters.

Layout of a post (the real preview is `/noodle-dev admin game_update_preview`, which is private to you):

> [news banner image]
> **## Title**
> Body text, with each bullet on its own line
> @announcements role  @game updates role  (production only)

Each update starts with a header block between `---` lines:
- `id`: letters, numbers, `_` or `-` (used in the commands)
- `title`: heading text
- `rollout_summary`: `true` only for the comprehensive first update (it must be sent first and can be sent once); `false` for later updates

Do not put a line containing only `---` followed by `id:` inside a body.

---
id: v0-6-0-first-update
title: Noodle Story v0.6.0 Update
rollout_summary: true
---
**A fresh batch of changes is now live in Noodle Story!**

> • **Achievements** have arrived!
> Track 90 shop milestones across bowls served, gardening, fishing & foraging, blessings, quests, broth simmering, tipping, visitors, and more, then **claim your rewards** right from the Achievements menu (open it from your Stats menu or run `/noodle achievements`).

> • **Badge Customization** lets you show off your journey: open Customize menu → **Badges** to equip up to 7 badges each for Milestones, Achievements, and Collections on your profile.

> • **Daily Menu Customization** is here! Pick up to 10 learned recipes for your shop's order board menu from the new **Menu** button on the Orders Board. Select across multiple pages if you have a lot of recipes, then **Save Menu** (or cancel the draft). You can change your menu once per day after the daily reset.

> • **Weekly Giveaways** now run automatically in the Official Server every Wednesday: one to three contests, each open for a week, with prizes that include coins, coin packs, perks, and VALOR (official server xp). Tap **Enter Giveaway** for a chance to win, each player can win once per week.

> • A **Work Ping** now appears every two hours in the Official Server to remind you to use `/work` and earn VALOR (server xp).

> • Adjustments were made to shared orders: Shared orders limit how much one party member can contribute, so everyone gets a fair chance to help your party finish together.

> • Recipe wording updated, it now says **Discovered** to better match how you find new recipes.

> • **Coming soon:** a **Counting Channel** in the Official Server where the community counts together and reaches milestones for coins, REP, SXP, and recipe clues. Stay tuned!
