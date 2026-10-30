import { createHash } from 'node:crypto';

export const stableCourseId = (ruleId, code, name, branch = '') =>
  `${ruleId}/c-${createHash('sha256').update(JSON.stringify([code ?? null, name.normalize('NFKC'), branch])).digest('hex').slice(0, 16)}`;
export const stableGroupId = (bundleId, group) => `${bundleId.replace(/:import-\d+$/, '')}/g-${createHash('sha256')
  .update(JSON.stringify([group.title, [...group.acceptableCourseCodes].sort(), group.minCount ?? null, group.minCreditUnits ?? null]))
  .digest('hex').slice(0, 16)}`;
