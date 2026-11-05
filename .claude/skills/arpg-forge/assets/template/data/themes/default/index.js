/**
 * Hollow Vigil: the default theme. Merges every content module into one
 * object in the shape THEME_SCHEMA describes. `maxDepth` is lifted out of
 * world.js for convenience.
 */
import meta from './meta.js';
import palette from './palette.js';
import tilesets from './tilesets.js';
import world from './world.js';
import classes from './classes.js';
import monsters from './monsters.js';
import items from './items.js';
import skills from './skills.js';
import objects from './objects.js';
import npcs from './npcs.js';
import quests from './quests.js';
import flavor from './flavor.js';
import sfx from './sfx.js';
import strings from './strings.js';

export default {
  meta,
  palette,
  tilesets,
  tiers: world.tiers,
  town: world.town,
  maxDepth: world.maxDepth,
  classes,
  monsters: monsters.monsters,
  uniqueMonsters: monsters.uniques,
  items,
  skills,
  objects: objects.objects,
  altarEffects: objects.altarEffects,
  npcs,
  quests,
  flavor,
  sfx,
  strings,
};
