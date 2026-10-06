import { describe, expect, test } from 'bun:test';
import { defaultRiderLook, monoPaint, paintFor, sanitizeLook, shade } from '../src/game/rider.ts';
import { scenes } from '../src/game/scenes.ts';

describe('rider look', () => {
  test('sanitize fills in defaults for missing or bad values', () => {
    expect(sanitizeLook(undefined)).toEqual(defaultRiderLook);
    expect(sanitizeLook('nope')).toEqual(defaultRiderLook);
    const look = sanitizeLook({
      helmet: 'yes', helmetColor: 'red', jerseyColor: '#ABCDEF', frameColor: '#12345', spokes: 'square',
      pants: 'tights', sleeves: 'long', tyreColor: 'javascript:alert(1)',
    });
    expect(look.helmet).toBe(true);
    expect(look.helmetColor).toBe(defaultRiderLook.helmetColor);
    expect(look.jerseyColor).toBe('#abcdef');
    expect(look.frameColor).toBe(defaultRiderLook.frameColor);
    expect(look.tyreColor).toBe(defaultRiderLook.tyreColor);
    expect(look.spokes).toBe('classic');
    expect(look.pants).toBe('tights');
    expect(look.sleeves).toBe('long');
  });

  test('sanitize keeps a valid look unchanged', () => {
    const custom = {
      ...defaultRiderLook, helmet: false, spokes: 'disc' as const, jerseyColor: '#00ff88', tyreColor: '#ffffff',
    };
    expect(sanitizeLook(custom)).toEqual(custom);
  });

  test('shade darkens, lightens and leaves other formats alone', () => {
    expect(shade('#808080', 0.5)).toBe('#404040');
    expect(shade('#808080', 3)).toBe('#ffffff');
    expect(shade('#000000', 0.5)).toBe('#000000');
    expect(shade('rgba(1,2,3,0.5)', 0.5)).toBe('rgba(1,2,3,0.5)');
  });

  test('paint follows the look', () => {
    const look = { ...defaultRiderLook, jerseyColor: '#112233', pantsColor: '#445566', pants: 'tights' as const, helmet: false, spokes: 'tri' as const };
    const p = paintFor(look);
    expect(p.jersey).toBe('#112233');
    expect(p.pants).toBe('#445566');
    expect(p.farPants).toBe(shade('#445566', 0.6));
    expect(p.pantsLength).toBe('tights');
    expect(p.hasHelmet).toBe(false);
    expect(p.spokes).toBe('tri');
  });

  test('a scene override changes colours but not shapes', () => {
    const look = { ...defaultRiderLook, helmet: false, spokes: 'disc' as const, sleeves: 'long' as const };
    const p = paintFor(look, scenes.tron.riderOverride);
    expect(p.frame).toBe('#22d3ee');
    expect(p.jersey).not.toBe(look.jerseyColor);
    expect(p.hasHelmet).toBe(false);
    expect(p.spokes).toBe('disc');
    expect(p.sleeves).toBe('long');
    expect(paintFor(look, scenes.rain.riderOverride).frame).toBe(look.frameColor);
  });

  test('ghost paint is one colour with the same shapes', () => {
    const look = { ...defaultRiderLook, spokes: 'five' as const, pants: 'tights' as const };
    const p = monoPaint(look, '#a5d8ff');
    for (const key of ['frame', 'tyre', 'spoke', 'disc', 'jersey', 'pants', 'skin', 'farPants', 'farSkin', 'helmet', 'hair', 'parts', 'shoe'] as const) {
      expect(p[key]).toBe('#a5d8ff');
    }
    expect(p.spokes).toBe('five');
    expect(p.pantsLength).toBe('tights');
  });
});

describe('robot pacemaker', () => {
  test('uses light metal with the scene accent normally, and all-neon in neon scenes', () => {
    const { robotColors } = require('../src/game/rider.ts');
    expect(robotColors('#ffd43b', false)).toEqual({ metal: '#b9c3cd', dark: '#4a545f', accent: '#ffd43b' });
    const neon = robotColors('#a3e635', true);
    expect(neon.metal).toBe('#a3e635');
    expect(neon.accent).toBe('#ffffff');
    expect(neon.dark).toBe(shade('#a3e635', 0.5));
  });
});
