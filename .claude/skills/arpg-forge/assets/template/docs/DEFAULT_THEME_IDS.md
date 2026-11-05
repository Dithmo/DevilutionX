# Default theme id registry ("Hollow Vigil")

The default theme is an ORIGINAL placeholder setting: a frontier watch-town built over sealed
ruins. It exists to prove the engine and to be copied when making a new theme. It must not
reuse names from any published game. Several modules are written in parallel, so the ids below
are fixed in advance; every builder creates exactly these ids (and may add more).

## meta
id `default`, title `Hollow Vigil`, tagline `Something stirs beneath the watch-town.`

## tilesets (tilesets.js)
`undercroft` (rooms) · `ossuary` (halls) · `root_caves` (caves) · `ember_vault` (halls, red palette)

## tiers (world.js)
| id | name | tileset | depths | monsterLevel | boss |
|---|---|---|---|---|---|
| `t1` | The Undercroft | undercroft | [1,4] | [1,6] | `u_gorrak` |
| `t2` | The Ossuary | ossuary | [5,8] | [6,12] | `u_mother_sallow` |
| `t3` | The Root Caves | root_caves | [9,12] | [12,20] | `u_the_tallow_king` |
| `t4` | The Ember Vault | ember_vault | [13,16] | [20,30] | `u_vessel_of_ash` |
maxDepth 16. Town name `Hollow Vigil`.

## classes (classes.js)
`warden` (melee, bulky) · `stalker` (ranged, lean) · `hexwright` (caster, robed)

## monsters (monsters.js) — 3 colour variants each where marked ×3
Tier 1: `shambler` ×3 (rusher, undead), `bonepicker` ×3 (skirmisher, undead), `cave_bat` ×2 (flier), `rust_sentinel` (tank)
Tier 2: `gravecaller` ×3 (spawner, undead), `hollow_archer` ×3 (ranged, undead), `pit_hound` ×3 (charger), `lantern_wisp` ×2 (caster)
Tier 3: `root_crawler` ×3 (ambusher), `tallow_brute` ×3 (tank), `spore_mage` ×3 (caster), `thornling` ×2 (rusher)
Tier 4: `ash_knight` ×3 (tank), `ember_hound` ×3 (charger), `cinder_seer` ×3 (caster), `vault_warden` ×2 (boss-ai, ranged)
Variant ids: `<base>`, `<base>_2`, `<base>_3`.
Uniques (uniques list): `u_gorrak` (depth 2, boss t1, quest q1), `u_mother_sallow` (depth 8), `u_the_tallow_king` (depth 12), `u_vessel_of_ash` (depth 16, final), `u_grim_tobin` (depth 4, quest q3), `u_whisper` (depth 10, quest q5)

## items (items.js)
Weapons: `shortblade`, `longblade`, `greatblade`, `hatchet`, `war_axe`, `cudgel`, `iron_mace`, `maul`, `short_bow`, `long_bow`, `war_bow`, `ash_staff`, `bone_staff`, `rune_staff`, `wand`
Armor: `cloth_shirt`, `leather_jerkin`, `studded_coat`, `chain_hauberk`, `plate_harness`, `cap`, `iron_helm`, `great_helm`, `buckler`, `kite_shield`, `tower_shield`
Jewelry: `ring`, `amulet`
Consumables: `c_minor_heal`, `c_heal`, `c_full_heal`, `c_minor_mana`, `c_mana`, `c_full_mana`, `c_rejuv`, `c_full_rejuv`, `c_elixir_str`, `c_elixir_mag`, `c_elixir_dex`, `c_elixir_vit`, `c_scroll_portal`, `c_scroll_identify`, `c_scroll_<skillId>` for each skill, `c_tome_<skillId>` for each skill
Quest items: `q_sealed_ledger` (q2 fetch), `q_bell_clapper` (q4 collectN ×3)
Uniques: `uq_vigilant_edge` (longblade), `uq_gorraks_jaw` (war_axe), `uq_sallow_crown` (iron_helm), `uq_tallow_heart` (amulet), `uq_ash_vessel_staff` (rune_staff), `uq_whisper_bow` (long_bow), `uq_warden_plate` (plate_harness), `uq_ring_of_the_watch` (ring)
Affix ids: prefixes `p_*`, suffixes `s_*` (≥25 each; builder's choice of names, must cover stats listed in CONTRACTS).

## skills (skills.js)
`firebolt` (bolt, fire) · `frost_shard` (bolt, cold) · `arc_lance` (pierce, shock) · `nova` (nova, shock) · `chain_arc` (chain, shock) · `flame_wall` (wall, fire) · `ember_pool` (groundAoe, fire) · `mend` (heal) · `stone_skin` (buff ac) · `blink` (blink) · `raise_ward` (summon) · `homing_spite` (homing, arcane) · `volley` (multishot, phys) · `cleave` (melee, phys) · `return_home` (townPortal) · `reveal` (identify)
Class starts: warden→`cleave`, stalker→`volley`, hexwright→`firebolt`.

## objects (objects.js)
`chest_small`, `chest_large`, `door_wood`, `door_iron`, `barrel`, `crate`, `altar_old`, `lever_rust`, `sign_post`, `trap_dart`, `fountain_murk`, `bookstand`
Altar effects: ≥12 using the AltarEffect.apply vocabulary.

## npcs (npcs.js)
`n_sister_oda` (healer, services heal) · `n_brann` (smith, vendor weapons+armor, repair) · `n_mirelle` (arcanist, vendor magic+potions, identify, recharge) · `n_captain_rook` (questgiver) · `n_old_fen` (gossip/storyteller) · `n_pip` (wanderer, vendor junk)

## quests (quests.js)
`q1_the_thing_below` killBoss u_gorrak depth 2 giver n_captain_rook · `q2_sealed_ledger` fetch q_sealed_ledger depth 3 giver n_mirelle · `q3_grim_tobin` clearArea depth 4 (den stamp, u_grim_tobin) giver n_brann · `q4_bell_clappers` collectN q_bell_clapper ×3 depths 5–7 giver n_sister_oda · `q5_the_whisper` findNpc→killBoss u_whisper depth 10 giver n_old_fen · `q6_vessel_of_ash` killBoss u_vessel_of_ash depth 16 (main) giver n_captain_rook

## sfx names (sfx.js)
hit, miss, swing, cast, pickup, drop, levelup, open, close, die, monsterHit, monsterDie, potion, gold, stairs, error, click, quest, portal, explode, bowShot, block
