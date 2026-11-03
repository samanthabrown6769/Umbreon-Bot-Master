World Boss damage update

index.js: apply worldboss-damage.patch (or edit the two constants by hand):
  const WORLD_BOSS_PLAYER_DAMAGE_MULTIPLIER = 1.5;   // was 3
  const WORLD_BOSS_COUNTER_DAMAGE_MULTIPLIER = 2;    // was 3

README.md (World Boss section), replace:
  "counterattacks after each move for 3x normal move damage. Player moves deal 3x their normal World Boss damage."
with:
  "counterattacks after each move for 2x normal move damage. Player moves deal 1.5x their normal World Boss damage."
