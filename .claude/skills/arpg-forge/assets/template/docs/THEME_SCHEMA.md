# Theme schema

A theme is a directory `data/themes/<id>/` with one ES module per content area and an `index.js`
that merges them into a single object. The engine loads `data/themes/<id>/index.js` where `<id>`
comes from `data/active_theme.js` (one line: `export default 'default'`).

Every `id` is a short snake_case string unique within its table. Colours are CSS strings.
Ranges are `[lo, hi]` inclusive. All text is plain strings (no markup).

```
data/themes/<id>/
  index.js        merges and exports { meta, palette, tilesets, tiers, town, classes, monsters,
                  uniqueMonsters, items, skills, objects, altarEffects, npcs, quests, flavor, sfx, strings }
  meta.js         { id, title, tagline, version, actors?: '3d'|'2d', lookDefaults?: { style?: 'classic'|'tech' } }
                  // actors: '2d' turns off the 3D actor renderer; lookDefaults.style 'tech' gives every actor the sci-fi kit
  palette.js      { bg, panel, panelBorder, text, textDim, accent, hp, mp, xp, gold,
                    rarity: { normal, magic, rare, unique }, danger, good, light,
                    // optional HUD chrome + lighting (derived when absent):
                    metal?, metalLight?, metalDark?, metalEdge?, trim?, trimGlow?: 0..1, recess?,
                    lifeColor?, manaColor?, ornament?: 'organic'|'angular',
                    fogColor?, fogAlpha?, emberColor?, moteColor?, ambientLevel? (town, default 0.42) }
  tilesets.js     [ Tileset ]
  world.js        { tiers: [ Tier ], town: Town, maxDepth }
  classes.js      [ PlayerClass ]
  monsters.js     { monsters: [ MonsterType ], uniques: [ UniqueMonster ] }
  items.js        { bases: [ ItemBase ], prefixes: [ Affix ], suffixes: [ Affix ], uniques: [ UniqueItem ], consumables: [ Consumable ] }
  skills.js       [ Skill ]
  objects.js      { objects: [ ObjectType ], altarEffects: [ AltarEffect ] }
  npcs.js         [ Npc ]
  quests.js       [ Quest ]
  flavor.js       { deathLines, loadingTips, intro, outro, levelName(depth), welcome }
  sfx.js          { [sfxName]: SynthDescriptor }
  strings.js      UI vocabulary overrides (see data/strings.js for keys)
```

## Tileset

```js
{ id, name, generator: 'rooms' | 'caves' | 'halls' | 'maze',
  floors: [color×3..4], walls: [color×2..3], accent: color, lightTint: color, voidColor: color,
  doorColor: color, decor: ['pillar','rubble','grate','vent','crate','bones','puddle'] (subset),
  ambient: sfxName|null,
  art?: TileArt }

TileArt = {   // every key optional; with none you get flagstone, masonry and torches
  floorStyle?: 'flagstone'|'cobble'|'concrete'|'plate'|'grate'|'water', floorStyles?: [style per floors[i]],
  wallStyle?: 'masonry'|'rough'|'panel', wallStyles?: [style per walls[i]],
  groutDark?: 0.22, grout?: color, cracks?: 0.16, grime?: 0.6, stain?: color,
  rust?, hazard?, metal?: color, runeColor?: color, runes?: 0.22, pilasterEvery?: 4,
  features?: { niche, runes, damaged, vent, screen },          // weights
  lamp?: { kind: 'torch'|'neon', color, colors?: [color], chance: .3, spacing: 4, radius: 135, intensity: 1 },
  wallDecor?: ['banner','chain','cable','sign'], wallDecorChance?: .14, banner?: [cloth, trim],
  bone?, wood?: color, rubble?: .12, stones?: .035, poles?: .02, decalChance?: .03 }
```
See `references/visual-quality.md` (in the skill) for what each knob does.

## Tier / Town

```js
Tier = { id, name, tilesetId, depths: [lo, hi], monsterLevel: [lo, hi], bossId: uniqueMonsterId|null,
         monsterPool: [monsterTypeId], objectPool: [objectTypeId], themedRooms: ['treasure','library','shrine','armory','barrel','torture','monsterDen'] }
Town = { name, size: [w, h], layout: 'plaza' | 'street' | 'ring', npcPlacements: [{ npcId, x, y }],
         dungeonEntrance: {x, y}, decor: [{kind, x, y}], groundColors: [color×3], buildingColors: [color×3],
         art?: TileArt, decorKinds?: [decal kind], doorColor?: color }
maxDepth = last tier's depths[1]
```

## PlayerClass

```js
{ id, name, blurb,
  base: { str, mag, dex, vit }, max: { str, mag, dex, vit },
  startLife, startMana, lifePerLevel, manaPerLevel, lifePerVit, manaPerMag,   // see balance for formula
  toHitBase, blockBase, critOnLevel: boolean,
  frames: { attack, cast, hitRecover, walk, death, actionFrame },            // ticks per anim and which frame resolves
  weaponPref: 'melee' | 'ranged' | 'caster',
  startKit: [ { baseId, count? } ], startSkill: skillId|null,
  skillPool: [skillId] (skills this class can learn from tomes), levelSkills: { [level]: skillId },
  epithet: string,                       // short subtitle on the class card ('Cutlass Brawler')
  look: { silhouette: 'bulky'|'lean'|'robed', bodyColor, trimColor, accent?, ...ActorLook } }   // accent: name colour on the card (else lightened bodyColor)

ActorLook = {   // optional on classes, monsters, uniques and NPCs; defaults come from the silhouette
  weapon?: 'sword'|'katana'|'greatsword'|'dagger'|'axe'|'hammer'|'mace'|'spear'|'staff'|'wand'|'pistol'|'rifle'|'bow'|'claws'|'none',
  offhand?: 'shield'|'buckler'|'orb'|'pistol'|'dagger'|'none',
  helm?: 'full'|'visor'|'open'|'hood'|'horned'|'crest'|'bare'|'mask'|'goggles', armor?: 'plate'|'light'|'cloth'|'none',
  cloak?: 'none'|'short'|'long'|'tattered', glow?: true|color,
  style?: 'classic'|'tech',   // gear kit; defaults to meta.lookDefaults.style, then 'classic'
  cloakColor?, metalColor?, skinColor?, accentColor?, underColor?, hairColor?: color,
  legs?: 4|6|8 (crawler), wings?: 'membrane'|'rotor' (flier),
  render?: '3d'|'2d' }   // '2d' draws this look with the 2D puppet even when 3D actors are on
```

## MonsterType

```js
{ id, name, tier, ai: 'rusher'|'skirmisher'|'ranged'|'caster'|'ambusher'|'charger'|'spawner'|'flier'|'tank'|'boss',
  level, hp: [lo,hi], dmg: [lo,hi], ac, toHit, xp,
  speed: { walkTicksPerTile, attackTicks, hitTicks, deathTicks, actionFrame },
  resist: { phys, fire, cold, shock, arcane }   // 0 none, 1 resist (¼ dmg), 2 immune
  flags: ['undead','flies','noLoot','noHitRecover','ranged','opensDoors','leader'],
  pack: { size: [lo,hi], leader: boolean }, intelligence: 0..3,
  missile: { archetype, element, dmg: [lo,hi] }|null, special: string|null,
  look: { silhouette, bodyColor, trimColor, size: 1, ...ActorLook }, sfx: { attack, hit, die } }
UniqueMonster = { id, name, baseTypeId, level, hp, dmg: [lo,hi], ai?, resist?, flags?, dropUniqueId?, look, packType: 'none'|'followers'|'elite' , questId|null, depth }
```

## Items

```js
ItemBase = { id, name, slot, type, size: {w,h}, level, price, look: {glyph, color},
             dmg?: [lo,hi], ac?: [lo,hi], dur?: number, req?: {str?, dex?, mag?}, twoHanded?: boolean,
             hands?: 1|2, speed?: 'slow'|'normal'|'fast', dropWeight: number, classWeight?: { [classId]: mult } }
Affix = { id, name, kind: 'prefix'|'suffix', slots: [slot|type], minLevel, maxLevel?, stat, range: [lo,hi],
          priceAdd: [lo,hi], priceMult?: number, cursed?: boolean, power: 1..3 (for rare rolls) }
UniqueItem = { id, name, baseId, level, effects: { [stat]: value }, price, look }
Consumable = { id, name, kind: 'potion'|'scroll'|'tome'|'elixir'|'key'|'misc', effect: { type: 'heal'|'mana'|'rejuv'|'stat'|'castSkill'|'identify'|'townPortal'|'learnSkill', value?, skillId? },
               level, price, belt: boolean, look, dropWeight }
```

## Skill

```js
{ id, name, blurb, archetype: 'bolt'|'pierce'|'homing'|'nova'|'chain'|'wall'|'groundAoe'|'heal'|'buff'|'blink'|'summon'|'townPortal'|'identify'|'melee'|'multishot',
  element, manaBase, manaPerLevel, manaMin, minMag, classes: [classId], learnLevel,
  dmg: { base: [lo,hi], perCasterLevel: [lo,hi], perSkillLevel: [lo,hi] },  // dmg = base + perCasterLevel*clvl + perSkillLevel*slvl
  missile: { speed, range, radius?, count?, spread? }, buff?: { stat, value, duration },
  look: { color, glyph, icon? }, sfx }   // icon: 1–2 chars drawn on the skill button (else glyph's first letter)
```

## Objects

```js
ObjectType = { id, name, kind: 'chest'|'door'|'breakable'|'altar'|'lever'|'sign'|'trap'|'fountain'|'bookstand',
               tilesets: [tilesetId]|'all', solid, blocksLight, look: { color, color2?, shape? }, lootTable?: { count: [lo,hi], goodChance },
               trapChance?: number, text?: string }
AltarEffect = { id, text, weight, apply: 'healFull'|'manaFull'|'swapStats'|'randomResist'|'dropGold'|'identifyAll'|'curseItem'|'blessItem'|'levelUpSkill'|'revealMap'|'spawnMonsters'|'teleport'|'buffDamage'|'drainMana', params?: {} }
```

## Npc / Quest

```js
Npc = { id, name, title, role: 'healer'|'smith'|'arcanist'|'questgiver'|'gossip'|'wanderer'|'storyteller',
        vendorType: 'weapons'|'armor'|'magic'|'potions'|'junk'|null, services: ['heal','identify','repair','recharge'] (subset),
        look, greeting: [string], gossip: [string], questLines: { [questId]: { offer: string, active: string, done: string } } }
Quest = { id, name, tier, depth, type: 'killBoss'|'fetch'|'clearArea'|'collectN'|'findNpc',
          giverId, target: { uniqueMonsterId? , itemBaseId?, objectTypeId?, count?, npcId? },
          reward: { xp, gold, itemBaseId?, uniqueItemId?, skillId? },
          text: { journal, started, progress, done }, mapStamp: 'bossRoom'|'vault'|'den'|null, spOnly: false }
```

## Flavor / Sfx / Strings

```js
flavor = { deathLines: [string], loadingTips: [string], intro: [string], outro: [string], welcome: string,
           heroNames?: [string],   // the title screen's random-name button picks from these (hidden if absent)
           levelName: (depth, tierName) => string }
SynthDescriptor = { type: 'sine'|'square'|'saw'|'triangle'|'noise', freq, slide?, dur, decay?, volume? }
strings = { life: 'Life', mana: 'Mana', gold: 'Gold', potion: 'Potion', skills: 'Skills', town: 'Town', ... }
```
`life`, `mana` and `gold` also rename those words in generated text (affix lines, potion and
gold tooltips, skill costs). Other engine messages: `goldItem` (name of a dropped gold pile),
`notEnoughMana`, `unknownSkill`, `hardcoreBadge` (HUD tag in a permadeath run).
