# Player-Facing Copy Review

**Status: USER-APPROVED.** The user reviewed and approved this copy packet, including the additions for gardening and broth-simmering achievements, work-ping and season-change role mentions, season timestamps and event descriptions, and banner titles. Player-facing copy may be committed. Production delivery remains gated by private-canary, permissions, first-update, and operational release checks.

This is the consolidated copy and reward-value review for the current rollout. Internal-only command responses, telemetry, debug logs, audit messages, and this review document are excluded. Existing player-facing copy not listed here is unchanged.

## 1. Shared-Order Contribution Limit

**Where:** Private response when a player tries to contribute above their equal per-member share for a shared order. The existing warning icon is shown before the text.

> ⚠️ You've reached the maximum allowed contribution for one party member in this shared order, your party members can help with the rest!

## 2. Counting Channel

**Where:** Reaction after a valid number, consecutive turn by the same player, or a broken sequence. These are existing custom server emojis; confirm their displayed appearance in the private canary:

- Valid count: `status_complete`
- Same-player repeat (does not advance or reset): `refresh`
- Incorrect integer (sequence resets to 1): `cancel`

**Where:** Public channel message after an incorrect integer:

> This count got a little tangled, so we're starting over at 1. Let's try again!

**Where:** Public reward confirmation after an eligible milestone reward is granted:

> `<@user> reached the [milestone] counting milestone and earned [reward] for their Noodle Shop!`

`[reward]` is rendered as an amount of coins, REP, SXP, or the name of the newly eligible recipe clue. If no eligible recipe remains, the configured fallback reward is used.

**Approved Milestone values:**

| Count | Approved reward |
|---:|---|
| 10 | 100 coins |
| 25 | 250 REP |
| 50 | 500 SXP |
| 100 | 1 recipe clue; fallback: 500 coins |
| 140 | 140 coins|
| 210 | 2100 REP |
| 270 | 1 recipe clue; fallback: 1000 coins |
| 320 | 320 coins |
| 380 | 3800 REP |
| 444 | 1 recipe clue; fallback: 2000 coins |
| 530 | 530 coins |
| 560 | 5600 REP|
| 600 | 1 recipe clue; fallback: 4000 coins |
| 680 | 680 coins |
| 777 | 7770 REP |
| 810 | 1 recipe clue; fallback: 8000 coins |
| 870 | 870 coins|
| 945 | 9450 REP|
| 999 | 1 recipe clue; fallback: 16000 coins |
| 1212 | 1212 coins |
| 1444 | 14440 REP |
| 1789 | 1 recipe clue; fallback: 32000 coins |
| 2222 | 2222 coins |


## 3. Work Ping

**Where:** Ping channel, exactly at 00:00, 02:00, 04:00, 06:00, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, and 22:00 UTC. No startup ping is sent, so weekly bot restarts do not shift the schedule. Production mode tags the configured `work ping` role; private canary mode suppresses the role mention. The post is a Components V2 container.

**Title:** `Work Ping`

> Time to work! Use `/work` in <#work-channel> to earn VALOR! (server XP) <@work ping>

Bot-authored counting reset and milestone-reward messages are also Components V2 containers. Player-submitted count entries remain plain numeric messages.

## 4. Weekly Giveaways

**Where:** Giveaway channel; scheduled weekly, Wednesdays at 21:00 UTC. One to three contests are selected, each open for seven days. Prizes are drawn from the approved, editable contest-count tiers below.

**Banner/title:** `Giveaway`

**Prize line examples:**

- `Prize: **50,000 coins**`
- `Prize: **[coin pack name] ([coin amount]c)**`
- `Prize: **24/7 House + Take-Out Counter Premium for 7 days**`
- `Prize: **500 VALOR (server XP)**`

**Close line:**

> Closes `<t:[close timestamp]:F>` (`<t:[close timestamp]:R>`).

**Live entry line and button:**

> Enter below for a chance to win! 

Button label: `Enter Giveaway`

**Private preview-only line:**

> Private preview only — entries and rewards are disabled.

**Private entry responses:**

- `You are now entered in this giveaway! Good luck!`
- `You are already entered in this giveaway.`
- `This giveaway is not accepting entries right now.`
- `This giveaway post is no longer active.`
- `This giveaway has closed. Look for an active giveaway in this channel!`
- `You have already won a giveaway this week, try again next week!`
- `We could not record your entry, please try again!`

**Automatic winner confirmation for in-game prizes:**

**Banner/title:**  `Giveaway`

> `<coins icon> Reward sent to <@winner>!`
>
> Coins: `• Coins credited: **[amount]c**.`
>
> Coin pack: `• Granted coin pack: [coin pack name] ([amount]c).`
>
> Perks: `• [perk name] for 7 days.` (one line per perk)
>
> Take-Out Counter Premium also grants coins: `• Coins credited: **50,000c**.`

The coin, coin-pack, and perk variants tag the winner and confirm the bot has granted the in-game reward.

**Initial VALOR winner notice (before manual fulfillment):**

**Banner/title:** `Giveaway`

> `<@winner> won the VALOR giveaway!`
>
> `• <@erma> will reward **[amount] VALOR** within 48 hours.`

**Follow-up after Erma confirms the VALOR has actually been sent:**

**Banner/title:** `Giveaway`

> `<coins icon> Reward sent to <@winner>!`
>
> `• <@erma> has rewarded **[amount] VALOR**.`

The follow-up is sent only after Erma invokes the fulfillment-confirmation command. Both winner and Erma are explicitly mention-allowed.

**Approved prize-pool values by weekly contest count:**

- **1 contest:** 50,000 coins; Greedy Noodle Goblin Hoard (100,000c); both perks for 7 days; or 500 VALOR.
- **2 contests:** 25,000 or 40,000 coins; Brothkeeper's Savings (25,000c) or Greedy Noodle Goblin Hoard (100,000c); either perk or both perks for 7 days; or 300/400 VALOR.
- **3 contests:** 5,000–30,000 coins in 5,000-coin steps; Chef's Coin Crate (10,000c) or Brothkeeper's Savings (25,000c); either perk for 7 days; or 100/150/200/250 VALOR.

## 5. Daily Order-Board Menu

**Where:** Player's menu/picker and menu update confirmation. The initial picker is delivered publicly by the current response helper when components are present, despite the command passing an ephemeral flag; the success response is also public, consistent with the takeout-menu route. Confirm visibility in canary checks and review whether this public behavior is intended.

**Title:** `Daily Order Board Menu`

> Choose up to 10 learned recipes for your shop's order board menu. Changing your menu will update your order board instantly and if you have any accepted orders, they will remain until you serve them.
>
> You can change your selected menu once per day after the daily reset.

**Picker placeholder:** `Pick recipes for your shop's order board menu.`

**Command description:** `Pick recipes for your shop's order board menu.`

When already changed that UTC day:

> Your menu has already been changed today. You can update your menu again after the daily reset.

When no menu is set:

> No menu has been set!

**Picker notice:**

> Pick the recipes you would like to see on your shop's order board menu.

**Multi-page draft controls (added to prevent an early daily-menu commit):**

> Menu draft saved. Continue selecting across pages, then save your menu.

> Menu draft: [selected]/10 selected. Continue across pages, then save to apply your change.

**Buttons:** `Save Menu` and `Cancel Draft`.

These controls are newly added operational UI copy and were not part of the original copy approval. Review their rendered wording in the private canary before production activation.

**Validation notices:**

- `Learn more recipes before changing your shop's order board menu.`
- `Select at least one recipe for your shop's order board menu.`
- `Choose no more than 10 recipes for your shop's order board menu.`
- `Choose at least one recipe you have learned for your shop's order board menu.`

**Success notice:**

> Your shop's order board menu has been updated!

## 6. Achievements

**Where:** Achievements menu beside Collections, `/noodle achievements`, and notice cards on unlock; each ready achievement has an inline Claim button.

**Display:** The list is split into Claimed and In Progress categories, with their buttons on a dedicated row above Previous/Next pagination. In Progress includes both ongoing and ready-to-claim achievements. The list is paginated at 10 achievements per page, with a page/total count. Secret achievements remain hidden until unlocked. Each achievement and collection displays a generic badge placeholder before its individual art is supplied.

**Command description:** `View and claim your achievement rewards!`

**Menu heading:** Existing sparkle icon followed by `Achievements`.

**Navigation button:** `Back`

**Retroactive notice (shortened):**

**Title:** `Achievement rewards can be claimed!`

> Congrats! You already have achievement rewards ready to claim. Run `/noodle achievements` to see them!

**New unlock card:**

**Title:** `Achievement unlocked: [achievement name]`

> [Achievement description]
>
> Congrats! Run `/noodle achievements` to claim your reward!

**Menu status labels:** `Claimed`, `Ready to claim`, `In progress`.

**Menu empty states:** `No claimed achievements yet.` and `No achievements are in progress.`

**Category buttons:** `Claimed ([count])` and `In Progress ([count])`.

**Claim control:** Each unlocked, unclaimed achievement has an inline `Claim` button beside its name and description. There is no reward selector row.

**Claim feedback:**

- `That achievement reward could not be claimed right now.`
- `That achievement reward has already been claimed!`
- `That achievement reward is not ready to claim yet.`
- `Please try claiming that reward again in a moment.`

**Approved achievement labels, descriptions, and rewards:**

| Achievement                     | Description                                       | Reward       |
| ------------------------------- | ------------------------------------------------- | ------------ |
| A Familiar Face                 | Serve 5 different kinds of visitors.              | 750 coins    |
| A Bustling Shop                 | Serve 15 different kinds of visitors.             | 75 REP       |
| Beloved by All                  | Serve 30 different kinds of visitors.             | 4,000 coins  |
| A Legendary Welcome             | Serve 44 different kinds of visitors.             | 750 SXP      |
| First Savings                   | Earn 25,000 coins over time.                      | 250 REP |
| A Comfortable Living            | Earn 100,000 coins over time.                     | 500 REP|
| Prosperous Proprietor           | Earn 500,000 coins over time.                     | 1,000 REP |
| A Fortune in Broth              | Earn 1,000,000 coins over time.                   | 2,000 REP    |
| The First Pages                 | Learn 10 recipes.                                 | 1,250 coins  |
| A Well-Worn Cookbook            | Learn 25 recipes.                                 | 2,500 coins  |
| Keeper of Flavors               | Learn 50 recipes.                                 | 5,000 coins  |
| The Grand Recipe Archive        | Learn 100 recipes.                                | 10,000 coins   |
| The First Hundred               | Serve 100 bowls.                                  | 500 coins    |
| A Steady Simmer                 | Serve 500 bowls.                                  | 250 SXP      |
| The Thousand-Bowl Kitchen       | Serve 1,000 bowls.                                | 1,000 REP    |
| Two Thousand Warm Meals           | Serve 2,500 bowls.                                | 1,250 SXP    |
| The Neighborhood Favorite       | Serve 5,000 bowls.                                | 3,500 coins  |
| A Flourishing Noodle House      | Serve 10,000 bowls.                               | 2,000 SXP    |
| Master of the Ladle             | Serve 15,000 bowls.                               | 2,500 REP    |
| The Endless Soup Pot            | Serve 20,000 bowls.                               | 4,000 SXP    |
| A City Fed on Noodles           | Serve 30,000 bowls.                               | 8,000 coins  |
| The Golden Ladle                | Serve 40,000 bowls.                               | 5,000 SXP    |
| A Thousand Tables               | Serve 50,000 bowls.                               | 5,000 REP    |
| The Immortal Kitchen            | Serve 75,000 bowls.                               | 8,000 SXP    |
| A Legend in Every Bowl          | Serve 100,000 bowls.                              | 15,000 SXP   |
| A Patient Cast                  | Catch 100 fish.                                   | 150 REP      |
| Riverbank Regular               | Catch 500 fish.                                   | 1,500 coins  |
| Friend of the Waters            | Catch 1,500 fish.                                 | 750 SXP      |
| Master Angler                   | Catch 5,000 fish.                                 | 2,500 REP    |
| A Few Wild Greens               | Gather 100 forageables.                           | 750 coins    |
| The Forager's Satchel           | Gather 500 forageables.                           | 100 REP      |
| Woodland Gatherer               | Gather 1,000 forageables.                         | 3,500 coins  |
| Bounty of the Wilds             | Gather 2,500 forageables.                         | 750 SXP      |
| A Familiar Stall                | Complete 25 market trades.                        | 500 coins    |
| A Regular at the Market         | Complete 100 market trades.                       | 500 REP      |
| A Savvy Shopkeeper              | Complete 250 market trades.                       | 2,500 coins  |
| Merchant of the Noodle District | Complete 1,000 market trades.                     | 1,500 REP    |
| A Helping Hand                  | Contribute to 10 shared orders.                   | 100 REP      |
| A Reliable Neighbor             | Contribute to 50 shared orders.                   | 1,000 coins  |
| The Community's Backbone        | Contribute to 150 shared orders.                  | 350 REP      |
| A Feast for Everyone            | Contribute to 500 shared orders.                  | 2,000 REP    |
| A Little Blessing               | Give another chef their first blessing.            | 250 coins    |
| A Warmhearted Host              | Give other chefs 25 blessings.                     | 75 REP       |
| A Blessing for Every Table      | Give other chefs 100 blessings.                    | 1,500 coins  |
| A Heart Full of Kindness        | Give other chefs 500 blessings.                    | 500 REP      |
| A Kind First Visit              | Receive your first blessing from another chef.     | 200 coins    |
| A Welcome Worth Remembering     | Receive 25 blessings from other chefs.             | 100 REP      |
| A Beloved Shopkeeper            | Receive 100 blessings from other chefs.            | 2,000 coins  |
| The Heart of the Community      | Receive 500 blessings from other chefs.            | 750 REP      |
| The First Offering              | Give your first tip.                              | 100 coins    |
| A Welcome Surprise              | Receive your first tip.                           | 10 REP       |
| Generous Gesture              | Tip 5,000 coins in total.                         | 1,500 coins  |
| A Heart of Gold                 | Tip 25,000 coins in total.                        | 150 REP      |
| The Generous Patron             | Tip 100,000 coins in total.                       | 7,500 coins  |
| The Village Benefactor          | Tip 500,000 coins in total.                       | 1,500 REP    |
| A Daily Ritual                  | Complete 10 daily quests.                         | 250 SXP      |
| A Devoted Routine               | Complete 50 daily quests.                         | 750 coins    |
| The Daily Regular               | Complete 150 daily quests.                        | 750 SXP      |
| A Life of Dedication            | Complete 500 daily quests.                        | 2,500 SXP    |
| Finding Your Rhythm             | Complete 5 weekly quests.                         | 150 REP      |
| Steady Tradition              | Complete 20 weekly quests.                        | 1,000 coins  |
| A Year of Service             | Complete 50 weekly quests.                        | 500 REP      |
| Two Years of Dedication            | Complete 100 weekly quests.                       | 1,500 REP    |
| A Week Together                 | Keep a 7-day daily reward streak.                 | 2,000 coins  |
| Two Weeks of Warmth             | Keep a 14-day daily reward streak.                | 250 REP      |
| A Month at the Hearth           | Keep a 30-day daily reward streak.                | 5,000 coins  |
| The Unbroken Tradition          | Keep a 100-day daily reward streak.               | 2,000 REP    |
| The Golden Hearth Revealed (secret) | Unlock the hidden Golden Hearth specialization. | 500 coins |
| Fortune Favors the Ladle (secret) | Unlock the hidden Lucky Ladle Pavilion specialization. | 1,000 coins |
| A Hall of Legends (secret)      | Unlock the hidden Legendary Noodle Hall specialization. | 2,000 coins |
| Sprout of Promise               | Harvest 100 vegetables and herbs.                 | 750 coins    |
| The Green Thumb                 | Harvest 500 vegetables and herbs.                 | 150 REP      |
| A Herbalist's Bounty            | Harvest 1,500 vegetables and herbs.               | 4,000 coins  |
| The Verdant Sanctuary           | Harvest 5,000 vegetables and herbs.               | 750 SXP      |
| Seeds of Tomorrow               | Collect 100 seeds.                                | 500 coins    |
| The Seed Collector              | Collect 500 seeds.                                | 75 REP       |
| A Thousand Possibilities        | Collect 1,500 seeds.                              | 3,500 coins  |
| The Keeper of Seeds             | Collect 5,000 seeds.                              | 400 SXP      |
| First Furrow                    | Plant 25 garden plots.                            | 350 coins    |
| Rows of Abundance               | Plant 100 garden plots.                           | 50 REP       |
| The Patient Cultivator          | Plant 500 garden plots.                           | 4,500 coins  |
| The Master Gardener             | Plant 1,500 garden plots.                         | 650 SXP      |
| The First Simmer                | Simmer 100 servings of broth in your kitchen.     | 800 coins    |
| A Comforting Stockpot           | Simmer 500 servings of broth in your kitchen.     | 100 REP      |
| Master of the Stockpot          | Simmer 1,500 servings of broth in your kitchen.   | 4,500 coins  |
| The Endless Broth Pot           | Simmer 5,000 servings of broth in your kitchen.   | 500 SXP      |
| A Broth for Every Bowl          | Simmer 10,000 servings of broth in your kitchen.  | 12,500 coins |
| The Broth Artisan               | Simmer 25,000 servings of broth in your kitchen.  | 1,000 REP    |
| Guardian of the Hearth          | Simmer 50,000 servings of broth in your kitchen.  | 40,000 coins |
| The Legendary Brothmaster       | Simmer 100,000 servings of broth in your kitchen. | 2,500 REP    |


## 7. Badge Customization

**Where:** Customize Profile → `Badges`; no slash command or other entry point.

**Menu copy:** `Choose what appears on your profile. Each row can show up to 7 badges; [count]/7 equipped in [category].`

**Categories:** `Badges`, `Achievements`, and `Collections`.

**Controls:** Each earned item has an `Equip` or `Equipped` toggle; category rows are independent and capped at seven. The menu paginates eligible entries and shows `[count]/7 equipped` for the current category. `Back` returns to Customize Profile.

**Placeholder art:** The generic badge icon is shown for each achievement and collection until individual badge artwork is supplied.

**Profile display:** Three rows—Badges, Achievements, Collections—with no more than seven equipped entries per row.

## 8. Game Updates and Season/Event Changes

**Scheduled update config:** `content/game-updates.md` contains the comprehensive first update (`v0-6-0-first-update`, title `Noodle Story v0.6.0 Update`, `rollout_summary: true`), mirroring the v0.6.0 entry in `content/news.json`. This copy is new and needs your review. Preview and schedule each update privately with `/noodle-dev admin game_update_preview` and `/noodle-dev admin game_update_schedule`.

**Generated season/event template (approved):**

**Banner/title:** `[season] Seasonal Update` (the first heading is replaced with the matching Season scene banner)

**Body:**

>The world of Noodle Story has transitioned to **[season]**!
>
> **[event name]**
> _[event tagline]_
> `<t:[event start Unix timestamp]:F> - <t:[event end Unix timestamp]:F>`
> _[event description]_
> 
> **Rewards**
> [Configured event reward and market-effect lines]
> 
> Special event recipes:
> • **[each configured event recipe name]**
> 
> -# Rewards apply to any order served during the event & unlocking an event scroll grants a badge!
> <@events>  

When no event is active:

> There is no special event active right now.
>
> **Rewards**
> • No additional bonuses
>
> There are no special event recipes for this season.

The user approved the dynamic season/event wording and the configured event details below. Each manually authored game-update body remains editable and must be privately previewed before it is scheduled. Scheduled feature updates and season/event posts stay held until the comprehensive first player update is delivered to production.

**Currently configured event details included in the generated season post:**

| Event | Tagline shown | Event description shown | Event recipe names shown |
|---|---|---|---|
| Spring Blossoms | Petals on the breeze and fresh starts in every bowl. | Slight SXP uplift and extra market stock for new recipes. | Garden Bowl; Vernal Shio; Bloom Noodles; Sakura Flare; Petal Miso |
| Summer Solstice | Long days, faster service, brighter tips. | Coins boosted with a small discount at the market. | Soft Breeze Noodles; Citrus Zen; Sunlit Udon; Firewave Ramen; Starlit Shio |
| Harvest Festival | A market-wide celebration of the autumn harvest. | Limited-time bonuses across the market and rewards. | Hearth Stock; Herbal Wok; Spiced Sweet; Pumpkin Miso; Black Garlic Hearth |
| Winter Market | Warm lights and hearty bowls. | Reputation and SXP bonuses to reward cozy cooking. | Warm Shio; Snow Miso; Glow Noodles; Hearth Bowl; Moonlight Stock |

Season labels displayed as currently configured are `spring`, `summer`, `autumn`, and `winter` (lowercase).

## Approval Record

- User review status: **Approved** (explicit approval received in the conversation)
- Approved additions: Gardening and broth-simmering achievements; role mentions in work pings and season changes; season timestamps plus event tagline and description; Giveaway and Season scene banners as titles.
- Copy may be committed: **Yes**, while preserving disabled-by-default feature gates.
- Player-facing automation may be enabled: **Not yet**; private-canary privacy, route permissions, backups/recovery, telemetry review, and first comprehensive production update remain release gates.
