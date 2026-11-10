import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, hasFeature, PLAN_LIMITS } from './index';

test('free plan gets core POS features', () => {
  assert.equal(hasFeature('FREE', FEATURES.CASHIER), true);
  assert.equal(hasFeature('FREE', FEATURES.OFFLINE_MODE), true);
});

test('free plan is locked out of professional features', () => {
  assert.equal(hasFeature('FREE', FEATURES.EMPLOYEE_MANAGEMENT), false);
  assert.equal(hasFeature('FREE', FEATURES.ADVANCED_REPORTS), false);
});

test('missing plan falls back to free', () => {
  assert.equal(hasFeature(null, FEATURES.CASHIER), true);
  assert.equal(hasFeature(undefined, FEATURES.AI_INSIGHTS), false);
});

test('professional plan includes everything', () => {
  for (const f of Object.values(FEATURES)) assert.equal(hasFeature('PROFESSIONAL', f), true);
  assert.equal(PLAN_LIMITS.PROFESSIONAL.stores, null);
});
