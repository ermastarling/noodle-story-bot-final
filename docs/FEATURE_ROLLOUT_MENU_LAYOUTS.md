# Feature Rollout Menu Layouts

This is the player-facing visual reference for rollout menus and announcement messages. Dynamic values appear in brackets. Components V2 containers append `Menu owner: @player` in their footer. Button labels use these exact custom emoji values from `content/icons.json` (unless `NOODLE_FORCE_UNICODE_EMOJI=1`):

| Key | Custom emoji |
|---|---|
| `back` | `<:back:1470315380731019388>` |
| `badges` | `<:badges:1470315753545924721>` |
| `cancel` | `<:cancel:1470315381619953675>` |
| `cart` | `<:cart:1470315512067129366>` |
| `coins` | `<:coins:1470315544027856977>` |
| `collections` | `<:collections:1470315756754571305>` |
| `cook` | `<:cook:1486464251412353305>` |
| `daily_reward` | `<:daily_reward:1470315422359355620>` |
| `leaderboard` | `<:leaderboard:1470315545277632576>` |
| `new` | `<:new:1501801363166855218>` |
| `next` | `<:next:1470315387056029757>` |
| `orders` | `<:orders:1470315427841179841>` |
| `pantry` | `<:pantry:1486270776502911167>` |
| `party` | `<:party:1470315765373866065>` |
| `profile` | `<:profile:1470315766652866591>` |
| `quests` | `<:quests:1470315429758111816>` |
| `recipes` | `<:recipes:1470315517364539521>` |
| `refresh` | `<:refresh:1470315389522018375>` |
| `sparkle` | `<:sparkle:1470315971456667659>` |
| `serve` | `<:serve:1486463795848024204>` |
| `stats` | `<:stats:1470315554551365632>` |
| `status_complete` | `<:status_complete:1470315431687491700>` |
| `status_incomplete` | `<:status_incomplete:1470315432828207167>` |
| `upgrades` | `<:upgrades:1470315778065698978>` |

## Orders Board

**Entry point:** `/noodle orders`

**Banner:** `scene_banner_orders` — [Orders.png](https://noodlestory.lol/wp-content/uploads/2026/10/Orders.png). In the Components V2 layout, the banner replaces the `Orders Board` heading.

```text
┌─ Orders banner
│ Open orders: [count]                 (or daily-completion / active-shift message)
│ Accepted: [count]
│ Your Accepted Orders
│   [accepted order details, including Serve Ready buttons (no emoji) when eligible]
├─ Accept [orders]  Cook [cook]  Serve [serve]  Cancel [cancel]
├─ Back [back]  Menu [recipes]  Buy [cart]  Pantry [pantry]
└─ Quests [quests]  Takeout [orders, only when available]
   Menu opens the Daily Order Board Menu picker.
```

In the V2 order-board rendering, **Serve Ready** has no emoji. In the legacy order-board rendering, the Accept button uses [status_complete] instead of [orders]. Its Accept/Cook/Serve row (plus optional Cancel [cancel] and Takeout [orders]) is followed by a separate **Menu** [recipes] button row, then **Buy** [cart], **Pantry** [pantry], and **Profile** [profile]. During the tutorial, tutorial-specific controls continue to replace normal order-board actions.

**Serve Ready** [serve] buttons appear beside individual accepted orders that are ready. The V2 layout groups quick actions into rows of up to four, so exact row breaks depend on whether Cancel and Takeout are currently available.

## Daily Order Board Menu

**Entry point:** `/noodle daily_menu`, or the new **Menu** [recipes] button on the normal Orders Board.

**Banner:** `scene_banner_menu` — [Menu.png](https://noodlestory.lol/wp-content/uploads/2026/10/Menu.png). The picker is a Components V2 container; the banner replaces the `Daily Order Board Menu` heading.

```text
┌─ [Daily Order Board Menu banner, when supplied]

[notice or validation message, if any]
Choose up to 10 learned recipes for your shop's order board menu. Changing your menu will update your order board instantly and if you have any accepted orders, they will remain until you serve them.

[You can change your selected menu once per day after the daily reset.
 OR
Your menu has already been changed today. You can update your menu again after the daily reset.]

Current menu
[• recipe name ... OR “No menu has been set!”]

│ [Pick recipes for your shop's order board menu.] (select up to 10)
[Prev] [Next] (only when more than 25 options exist)
└─ Menu owner: @player
```

The select menu has at most 25 recipe choices on each page, retains the draft while paging, and updates the order board immediately after a valid selection. **Prev** [back] and **Next** [next] wrap at either end. No Save button is shown. The picker is an ephemeral Components V2 container until a successful menu edit returns the updated screen publicly.

## Social Stats

**Entry point:** the **Stats** [stats] button on the social/profile navigation.

**Banner:** `scene_banner_stats` — [Stats.png](https://noodlestory.lol/wp-content/uploads/2026/10/Stats.png). It replaces the `Your Social Stats` heading; the screen content is unchanged.

Its first action row now contains:

```text
Party [party]  Leaderboard [leaderboard]  Collections [collections]  Achievements [sparkle]
```

The second action row remains:

```text
Orders [orders]  Buy [cart]  Pantry [pantry]  News [new]  Profile [profile]
```

The Achievements entry point is here beside Collections; Collections itself no longer links to Achievements. The **Stats** button on social/profile navigation and the **Achievements** button here turn green when an achievement reward is ready to claim; otherwise they keep their normal secondary style.

## Collections

**Entry point:** **Collections** [collections] on Social Stats, or `/noodle collections`.

**Banner:** `scene_banner_collections` — [Collections.png](https://noodlestory.lol/wp-content/uploads/2026/07/Collections.png). It replaces the title heading.

```text
┌─ Collections banner
│ [own icon] [complete/incomplete emoji] Collection Name — completed/total (percent)
│   [optional italicized collection description]
│ ...one block per configured collection...
└─ Back [back]
```

If there are no configured collections, the body reads `No collections defined yet.` There is no Achievements button on this screen. Each collection shows its own uploaded icon to the left of its name.

## Badges

**Entry point:** Customize Profile → **Badges** [badges]. There is no slash command or other entry point.

**Banner:** None.

```text
┌─ Badges
│ Select the badges you want to display on your profile! 
│ 
│ [equipped count]/7 equipped in [selected category].
├─ Badges [active when selected]  Achievements  Collections
│ [own icon] Badge Name — rarity       [Equipped] (green) or [Equip]
│ [own icon] Achievement Name — description [Equipped] or [Equip]
│ [own icon] Collection Name — description [Equipped] or [Equip]
│ ...up to 10 available badges on this page...
│   
│ Page [n]/[total] • Menu owner: @player
├─ Previous [back]  Next [next] (only when more than one page exists)
└─ Back [back] (returns to Customize Profile)
```

The three category tabs each manage a separate profile row: Badges, Achievements, and Collections. Each row is capped at seven equipped items. Only earned badges, unlocked achievements, and completed collections can be equipped; entries are paginated 10 per page. Every badge, achievement, and collection has its own uploaded icon, keyed by its ID in `content/icons.json` (achievement and collection keys are listed in `content/badges.json`). The profile displays up to seven selected badge icons in each of its three horizontal rows.

## Achievements

**Entry point:** the **Achievements** [sparkle] button on Social Stats, or `/noodle achievements` (including from an unlock notice). There is no Achievements button on Collections.

**Banner:** `scene_banner_achievements` — [Achievements.png](https://noodlestory.lol/wp-content/uploads/2026/10/Achievements.png). The banner replaces the heading; achievement unlock notice cards use the same banner.

```text
┌─ Achievements banner
│ [own icon] Achievement Name — In progress
│ Description
│
│ [own icon] Achievement Name — Ready to claim [Claim] [daily_reward]
│ Description
│
│ [own icon] Achievement Name — Claimed
│ Description
│
│ ...up to 10 achievements in the selected category...
│
│ Page [n]/[total] • Menu owner: @player • Tip: Tap the green button(s) to continue. (if Claim is present)
├─ Claimed ([count])  In Progress ([count]) (their own row; selected category is primary)
├─ Previous [back]  Next [next] (only when more than one page exists)
└─ Back [back]
```

Each ready, unclaimed achievement has its own **Claim** [daily_reward] button inline with its name and description; there is no reward selector row. The Claimed and In Progress buttons are on their own row above the page-navigation controls. In Progress includes unclaimed achievements that are either still progressing or ready to claim. Secret achievements—including one for each hidden specialization—remain hidden until unlocked. Empty states read `No achievements are in progress.` or `No claimed achievements yet.` Previous/Next wrap within the selected category; Back returns to Social Stats.

## Weekly Giveaway

**Surface:** scheduled public post; it is a single-action panel, not a navigation menu.

**Banner:** `scene_banner_giveaway` — [Giveaway.png](https://noodlestory.lol/wp-content/uploads/2026/07/Giveaway.png). It replaces the Giveaway heading.

**Live production post:**

```text
┌─ Giveaway banner
│ Prize: [prize]
│ Closes [absolute time].  
│ 
│ Enter below for a chance to win!  
│ 
│ -# @shared rollout-announcements role
└─ Enter Giveaway [sparkle]
```

**Private canary preview:** same Giveaway banner, prize and close lines, then `Private preview only — entries and rewards are disabled.` It has no role mention and no button.

**Winner confirmations:** same Giveaway banner, no buttons. In-game prizes show `[coins] Reward sent to @winner!` followed by the exact granted coin, coin-pack, or perk details. A VALOR winner post reads `@winner won the VALOR giveaway!` and `@fulfiller will reward [amount] VALOR within 48 hours.` The later manual-fulfillment confirmation reads `[coins] Reward sent to @winner!` and `@fulfiller has rewarded [amount] VALOR.`

## Other Rollout Messages (No Buttons)

These are standalone player-facing messages, not menus:

| Message | Visible content | Banner |
|---|---|---|
| Work Ping | `Work Ping` title; `Time to work! Use /work in #work-channel to earn VALOR! (server XP) @work-ping-role`. Role mention is suppressed in private canaries. | None currently configured. |
| Counting reset | `Counting` title; `This count got a little tangled, so we're starting over at 1. Let's start again!` | None currently configured. |
| Counting reward | `Counting` title; `@player reached the [count] counting milestone and earned [reward] for their Noodle Shop!` | None currently configured. |
| Achievement unlock notice | `Achievement unlocked: [name]` title; the achievement description, then `Congrats! Run /noodle achievements to claim your reward!` Existing-profile backfill instead shows `Achievement rewards can be claimed!` and `Congrats! You already have achievement rewards ready to claim. Run /noodle achievements to see them!` | Achievements banner. |
| Shared-order contribution limit | `⚠️ You've reached the maximum allowed contribution for one party member in this shared order, your party members can help with the rest!` | No banner; private response. |
| Scheduled game update | The configured update title and body, followed in production by mentions of both the shared rollout-announcements role and the game-updates role. Content is authored in `content/game-updates.md`; no fixed update body is currently configured. | `scene_banner_news` — [News.png](https://noodlestory.lol/wp-content/uploads/2026/07/News.png). |
| Season/event update | Season transition text, event name/tagline/description/timestamps/rewards/recipes where applicable; production tags both roles, with the game-updates role also placed at the event-role copy placeholder. | `scene_banner_season` — [Season.png](https://noodlestory.lol/wp-content/uploads/2026/07/Season.png). |
| Giveaway winner and fulfillment notices | Prize-specific confirmation text described above. | Giveaway banner. |

Counting submissions themselves remain plain numeric messages. Their reactions use `<:status_complete:1470315431687491700>` for a valid count, `<:refresh:1470315389522018375>` when the same player repeats a turn, and `<:cancel:1470315381619953675>` for an incorrect integer. The exact approved player-facing wording and reward values are recorded in [PLAYER_COPY_REVIEW.md](PLAYER_COPY_REVIEW.md).

## Telemetry Bot Health Reports (Staff Channel, No Buttons)

Posted by the scheduler to `NOODLE_TELEMETRY_ALERT_CHANNEL_ID` in the official server (staff only; players never see it). It is a Components V2 container with **no buttons and no banner**. Content is a header, one body text block (kept within Discord's 4,000-character limit; if long, the detail sections are trimmed with a note while the recommendation, next steps and issues are always kept; reports are never split across messages), and a footer. Every figure comes from measured log records in the window.

```text
## Bot Health Report            (or "## Bot Health Alert" when action is needed)

[@dev-alert-user]               (Alert only: pings the dev alert user)

Window: last 24h
Scope: sampled bot interactions, instrumented scheduled-job runs, and V2 diagnostics. This is measured activity, not continuous uptime or Discord availability.

What was observed:
- Log records in this window
- Bot interaction latency records (seen / valid durations)
- Failed interactions (count and %)
- Server response time p50 / p95
- Interactions over the slow-event threshold
- Scheduled-job runs (succeeded / failed / skipped)
- Hard operation/delivery failures recorded
- Process start events observed; continuous uptime: not measured
- Discord gateway events (ready / disconnect / shard errors / reconnecting / resumed)
- V2 scene transitions / completed flows
- V2 route-error signals per 100 transitions (diagnostic only)
- Gate bypasses
- V2 average clicks per completed flow
- V2 flow elapsed p50 / p95 (includes player time between clicks)
- Data collection: mode and sample rate

Compared with previous 24h window:            (or "No prior window data available")
- Interactions measured, failed interactions, p95 change, error-rate change,
  failed job runs, hard send failures, V2 flow p95 change, V2 route-error change

Top V2 route-error signals: ...               (only when present)
Most failed interaction routes: ...           (only when present)
Scheduled-job outcomes: job(runs, failed)     (top 5, only when present)
Hard failure signals / Affected operation sources   (only when present)
Data quality warnings:                        (only when present)
Top bypass reasons: ...                       (only when present)

Recommendation: ACTION NEEDED / WATCH / LIMITED DATA / MIXED / IMPROVING / NO THRESHOLD BREACH ...

Suggested next step:
- one line per observed issue

Detected issues:                              (only when thresholds are crossed)
- ...

-# Window: 24h | Minimum interactions: 20 | Mode: all
```

**Behavior:** posts every `NOODLE_V2_TELEMETRY_REPORT_INTERVAL_MS` (default 6h). It is an **Alert** (pings the dev alert user) when failed job runs, hard failures, or threshold breaches are present with enough data; otherwise a quiet **Report**. The startup run posts only if it is an Alert. Reports never claim uptime or Discord availability.
