/** Public surface of the calculation engine. Pure functions; safe to import from server and client code. */
export { runEngine } from './engine';
export { DEFAULT_CONFIG, mergeConfig, configFromRequest } from './config';
export { neutralCost, usageRate, monthlyCost, fitValue } from './cost';
export { hashInputs } from './hash';
export { compareBundles, compareSegments, diffBundles, spearman } from './compare';
export { midRankPercentiles, tierOf } from './percentile';
export { solveKnapsack } from './knapsack';
export { EngineInputError, validateRunInput } from './validate';
export type * from './types';
