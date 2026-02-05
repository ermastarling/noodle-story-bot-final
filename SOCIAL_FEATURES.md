# Social Systems & Async Co-Op (Phase D)

This document describes the social features implemented in Noodle Story Bot.

## Design Philosophy

The social system follows these core principles:

- **Solo Progression**: All social features are optional and cosmetic
- **No Trading**: Players cannot trade items or permanent power
- **Time-Limited**: Social buffs expire and cannot stack
- **Safe Economy**: Tips are the only coin transfers, with strict limits

## Features

### 1. Parties (`/noodle-social party`)

Players can form parties to collaborate asynchronously.

**Commands:**
- `/noodle-social party action:create name:"Party Name"` - Create a new party
- `/noodle-social party action:join party_id:abc123` - Join an existing party
- `/noodle-social party action:leave` - Leave your current party
- `/noodle-social party action:info` - View party details

**Mechanics:**
- Max party size: 4 members (configurable)
- Leader automatically promoted when original leader leaves
- Party disbanded when last member leaves
- Members earn contribution points for shared activities

### 2. Tips (`/noodle-social tip`)

Safe coin transfers between players.

**Command:**
- `/noodle-social tip user:@player amount:50 message:"Great service!"` - Tip another player

**Mechanics:**
- Minimum tip: 1c (configurable)
- Maximum tip: 10,000c (configurable)
- Cannot tip yourself
- Requires sufficient coins
- Tracked in lifetime statistics

### 3. Shop Visits (`/noodle-social visit`)

Visit another player's shop to receive a temporary blessing.

**Command:**
- `/noodle-social visit user:@player` - Visit a player's shop

**Mechanics:**
- Grants a 6-hour blessing (configurable)
- 24-hour cooldown between blessings (configurable)
- Cannot visit yourself
- One active blessing at a time
- Blessing effects:
  - `discovery_chance_add` - Enhanced ingredient discovery
  - `limited_time_window_add` - More time for limited orders
  - `quality_shift` - Improved cooking quality
  - `npc_weight_mult` - Better NPC encounters

### 4. Leaderboards (`/noodle-social leaderboard`)

View server-wide rankings.

**Command:**
- `/noodle-social leaderboard type:coins` - View leaderboards

**Types:**
- `coins` - Top coin holders
- `rep` - Top reputation
- `bowls` - Most bowls served

**Mechanics:**
- Read-only, informational only
- No power rewards for rankings
- May award cosmetic titles/badges

### 5. Social Stats (`/noodle-social stats`)

View your personal social statistics.

**Command:**
- `/noodle-social stats` - View your social stats

**Information:**
- Tips sent and received
- Current party and contributions
- Active blessings

## Database Schema

### Tables

**`guild_parties`**
- Party management and metadata
- Leader tracking
- Status (active/disbanded)

**`party_members`**
- Party membership records
- Join/leave timestamps
- Contribution points

**`tips`**
- Coin transfer records
- Sender/receiver tracking
- Optional messages

**`shared_orders`**
- Collaborative orders for parties
- Status tracking

**`shared_order_contributions`**
- Individual contributions to shared orders
- Ingredient and quantity tracking

## Server Settings

Admins can configure social features:

- `SOCIAL_FEATURES_ENABLED` - Toggle all social features (default: true)
- `BLESSING_DURATION_HOURS` - Blessing duration (default: 6)
- `BLESSING_COOLDOWN_HOURS` - Blessing cooldown (default: 24)
- `MAX_PARTY_SIZE` - Maximum party members (default: 4)
- `MIN_TIP_AMOUNT` - Minimum tip in coins (default: 1)
- `MAX_TIP_AMOUNT` - Maximum tip in coins (default: 10000)

## Anti-Exploitation

The system includes monitoring features:

- Visit patterns are logged (for analytics only)
- No automatic enforcement
- Admins can review patterns for abuse
- All social features are optional

## Community Events

Server-wide collaborative events:

- Players contribute individually
- Milestones unlock cosmetics and story content
- No economy rewards
- Tracked in `community_events` server state

## NPC Affinity

Server-wide NPC relationship tracking:

- Purely cosmetic/narrative
- Affects appearance frequency and dialogue
- No reward increases
- Tracked in `npc_affinity` server state

## Future Enhancements

Potential additions (not yet implemented):

- Shared order completion rewards
- Party-specific events
- Community event UI
- More blessing types
- Party chat channels
