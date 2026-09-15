// How many wishes live on one "wall" before a new wall begins.
// This keeps any single page from ever having to render an unbounded
// number of ribbons, no matter how large the wish count grows.
const WISHES_PER_WALL = parseInt(process.env.WISHES_PER_WALL || '500', 10);

function totalWalls(total) {
  return Math.max(1, Math.ceil(total / WISHES_PER_WALL));
}

function wallBounds(wallIndex) {
  const start = (wallIndex - 1) * WISHES_PER_WALL + 1;
  const end = wallIndex * WISHES_PER_WALL;
  return { start, end };
}

module.exports = { WISHES_PER_WALL, totalWalls, wallBounds };
