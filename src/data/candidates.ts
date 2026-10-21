import type { Candidate, Segment } from '@/lib/types';

/**
 * Partner perk catalog. Names are real New York-area businesses and titles; every number here is
 * an ILLUSTRATIVE assumption (editable in the UI), not market data. No Qloo ids live in the repo.
 */
export const CANDIDATES: readonly Candidate[] = [
  // place (restaurants and cafes)
  { id: 'katz', name: "Katz's Delicatessen", domain: 'place', unitCost: 6, billing: 'per_use', friction: 1 },
  { id: 'joes_pizza', name: "Joe's Pizza", domain: 'place', unitCost: 3, billing: 'per_use', friction: 1 },
  { id: 'shake_shack', name: 'Shake Shack', domain: 'place', unitCost: 4, billing: 'per_use', friction: 1 },
  { id: 'levain', name: 'Levain Bakery', domain: 'place', unitCost: 3, billing: 'per_use', friction: 1 },
  { id: 'russ_daughters', name: 'Russ & Daughters', domain: 'place', unitCost: 8, billing: 'per_use', friction: 1.2 },
  // tv_show (a streaming perk is scored by the title it unlocks)
  { id: 'succession', name: 'Succession', domain: 'tv_show', unitCost: 2, billing: 'fixed', friction: 1 },
  { id: 'the_bear', name: 'The Bear', domain: 'tv_show', unitCost: 2, billing: 'fixed', friction: 1 },
  { id: 'severance', name: 'Severance', domain: 'tv_show', unitCost: 2, billing: 'fixed', friction: 1 },
  { id: 'ted_lasso', name: 'Ted Lasso', domain: 'tv_show', unitCost: 2, billing: 'fixed', friction: 1 },
  { id: 'bridgerton', name: 'Bridgerton', domain: 'tv_show', unitCost: 2, billing: 'fixed', friction: 1 },
  // brand
  { id: 'aesop', name: 'Aesop', domain: 'brand', unitCost: 12, billing: 'per_use', friction: 1.2 },
  { id: 'nike', name: 'Nike', domain: 'brand', unitCost: 10, billing: 'per_use', friction: 1 },
  { id: 'lululemon', name: 'Lululemon', domain: 'brand', unitCost: 12, billing: 'per_use', friction: 1 },
  { id: 'peloton', name: 'Peloton', domain: 'brand', unitCost: 5, billing: 'fixed', friction: 1.5 },
  { id: 'warby_parker', name: 'Warby Parker', domain: 'brand', unitCost: 15, billing: 'per_use', friction: 1.2 },
  // book
  { id: 'atomic_habits', name: 'Atomic Habits', domain: 'book', unitCost: 4, billing: 'per_use', friction: 1 },
  { id: 'dune', name: 'Dune', domain: 'book', unitCost: 4, billing: 'per_use', friction: 1 },
  { id: 'sapiens', name: 'Sapiens', domain: 'book', unitCost: 4, billing: 'per_use', friction: 1 },
  { id: 'midnight_library', name: 'The Midnight Library', domain: 'book', unitCost: 4, billing: 'per_use', friction: 1 },
  { id: 'evelyn_hugo', name: 'The Seven Husbands of Evelyn Hugo', domain: 'book', unitCost: 4, billing: 'per_use', friction: 1 },
] as const;

/** Example segments. Chip tokens are opaque; the server maps them to Qloo entity ids from the precache. */
export const EXAMPLE_SEGMENTS: readonly Segment[] = [
  {
    id: 'example_a',
    label: 'Example A: late-20s Brooklyn',
    age: '25_to_29',
    interests: [
      { token: 'a1', name: 'Fleabag' },
      { token: 'a2', name: 'Phoebe Bridgers' },
      { token: 'a3', name: 'Glossier' },
    ],
  },
  {
    id: 'example_b',
    label: 'Example B: 55+ Upper East Side',
    age: '55_and_older',
    interests: [
      { token: 'b1', name: 'Downton Abbey' },
      { token: 'b2', name: 'Frank Sinatra' },
      { token: 'b3', name: 'Tiffany & Co.' },
    ],
  },
] as const;

export const DEFAULT_BUDGET = 75_000;
export const DEFAULT_MEMBERS = 10_000;
