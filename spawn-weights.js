function pickWeighted(candidates, weightOf, random = Math.random) {
  if (!candidates.length) throw new RangeError('Cannot select from an empty spawn pool.');
  const weights = candidates.map(weightOf);
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    throw new RangeError('Spawn weights must be positive finite numbers.');
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let index = 0; index < candidates.length; index += 1) {
    roll -= weights[index];
    if (roll < 0) return candidates[index];
  }
  return candidates[candidates.length - 1];
}

module.exports = { pickWeighted };
