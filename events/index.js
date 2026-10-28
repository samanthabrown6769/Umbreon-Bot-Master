const EVENTS = [
  require('./halloween-2026'),
  require('./november-2026'),
].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

// The open event, otherwise the next upcoming one, otherwise the most recent one.
function getCurrentEvent(now = Date.now()) {
  return EVENTS.find((event) => now >= Date.parse(event.startsAt) && now < Date.parse(event.endsAt))
    || EVENTS.find((event) => Date.parse(event.startsAt) > now)
    || EVENTS[EVENTS.length - 1];
}

module.exports = { EVENTS, getCurrentEvent };
