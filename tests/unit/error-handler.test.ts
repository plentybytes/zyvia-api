/**
 * Unit tests for the RFC 7807 error handler utility.
 */
import { describe, it, expect } from 'vitest';
import { buildProblem } from '../../src/middleware/error-handler.js';

describe('buildProblem', () => {
  it('builds a valid RFC 7807 Problem Details object', () => {
    const problem = buildProblem(404, 'Record not found', '/v1/records/abc');
    expect(problem.type).toMatch(/^https:\/\/zyvia\.api\/errors\//);
    expect(problem.title).toBe('Not Found');
    expect(problem.status).toBe(404);
    expect(problem.detail).toBe('Record not found');
    expect(problem.instance).toBe('/v1/records/abc');
  });

  it('accepts a custom title override', () => {
    const problem = buildProblem(409, 'Duplicate key', '/v1/records', 'Conflict');
    expect(problem.title).toBe('Conflict');
  });

  it('generates a type URI with kebab-case slug', () => {
    const problem = buildProblem(422, 'Bad input', '/v1/upload');
    expect(problem.type).toBe('https://zyvia.api/errors/unprocessable-entity');
  });

  it('includes all five required RFC 7807 fields', () => {
    const problem = buildProblem(500, 'Unexpected error', '/v1/health');
    const keys = Object.keys(problem);
    expect(keys).toContain('type');
    expect(keys).toContain('title');
    expect(keys).toContain('status');
    expect(keys).toContain('detail');
    expect(keys).toContain('instance');
  });
});
