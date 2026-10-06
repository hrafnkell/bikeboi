// Riding scenes: colours and effects for the renderer.

import type { PaintOverride } from './rider.ts';

export type SceneId = 'day' | 'sunset' | 'alpine' | 'rain' | 'midnight' | 'tron';

export interface Palette {
  skyTop: string;
  skyBottom: string;
  /** Sun or moon. */
  orb: string;
  far: string;
  mid: string;
  ground: string;
  groundDeep: string;
  road: string;
  dash: string;
  tree: string;
  trunk: string;
  /** Neon scenes: edge colour for ridges, road and scenery. */
  outline: string;
  /** Neon scenes: second edge colour. */
  accent: string;
}

export interface Scene {
  id: SceneId;
  name: string;
  palette: Palette;
  sky: 'sun' | 'moon' | 'overcast' | 'synth';
  /** Wireframe look: outlined ridges, grid ground, glowing road. */
  neon: boolean;
  rain: boolean;
  stars: boolean;
  headlight: boolean;
  /** Colours forced on the rider in this scene; null uses the rider's own look. */
  riderOverride: PaintOverride | null;
  ghost: string;
}

const natural = { outline: '#ffffff', accent: '#ffffff' };

export const scenes: Record<SceneId, Scene> = {
  day: {
    id: 'day', name: 'Day', sky: 'sun', neon: false, rain: false, stars: false, headlight: false,
    palette: {
      skyTop: '#3a86c8', skyBottom: '#cfe8f7', orb: '#fff6c2', far: '#8fb3c9', mid: '#5f9a6b',
      ground: '#6a994e', groundDeep: '#274c2b', road: '#44474f', dash: 'rgba(255,255,255,0.55)',
      tree: '#386641', trunk: '#5b4332', ...natural,
    },
    riderOverride: null, ghost: '#a5d8ff',
  },
  sunset: {
    id: 'sunset', name: 'Sunset', sky: 'sun', neon: false, rain: false, stars: false, headlight: false,
    palette: {
      skyTop: '#2b3a67', skyBottom: '#f7b267', orb: '#ffe3a3', far: '#5b5f97', mid: '#3d5a80',
      ground: '#4f772d', groundDeep: '#1f3318', road: '#3a3d45', dash: 'rgba(255,255,255,0.55)',
      tree: '#31572c', trunk: '#4a3728', ...natural,
    },
    riderOverride: null, ghost: '#a5d8ff',
  },
  alpine: {
    id: 'alpine', name: 'Alpine', sky: 'sun', neon: false, rain: false, stars: false, headlight: false,
    palette: {
      skyTop: '#27496d', skyBottom: '#dbe9f4', orb: '#ffffff', far: '#9fb4c7', mid: '#6b7f8f',
      ground: '#7a8b5a', groundDeep: '#353f2b', road: '#40434a', dash: 'rgba(255,255,255,0.55)',
      tree: '#2f5241', trunk: '#4d3b2c', ...natural,
    },
    riderOverride: null, ghost: '#a5d8ff',
  },
  rain: {
    id: 'rain', name: 'Rain', sky: 'overcast', neon: false, rain: true, stars: false, headlight: false,
    palette: {
      skyTop: '#353d4a', skyBottom: '#8b95a3', orb: '#c9d1db', far: '#5e6978', mid: '#47545c',
      ground: '#48683f', groundDeep: '#1a281c', road: '#2a2d34', dash: 'rgba(255,255,255,0.4)',
      tree: '#2b4a34', trunk: '#3a2e25', ...natural,
    },
    riderOverride: null, ghost: '#a5d8ff',
  },
  midnight: {
    id: 'midnight', name: 'Midnight', sky: 'moon', neon: false, rain: false, stars: true, headlight: true,
    palette: {
      skyTop: '#02040c', skyBottom: '#15244a', orb: '#eef2f7', far: '#101a30', mid: '#0b1322',
      ground: '#12301f', groundDeep: '#040906', road: '#1a1d25', dash: 'rgba(255,255,255,0.5)',
      tree: '#0a2017', trunk: '#17120e', ...natural,
    },
    riderOverride: null, ghost: '#a5d8ff',
  },
  tron: {
    id: 'tron', name: 'Tron', sky: 'synth', neon: true, rain: false, stars: true, headlight: false,
    palette: {
      skyTop: '#04010d', skyBottom: '#1d0638', orb: '#ffd166', far: '#0a0320', mid: '#070217',
      ground: '#070313', groundDeep: '#000000', road: '#0a0f24', dash: '#22d3ee',
      tree: '#e879f9', trunk: '#e879f9', outline: '#22d3ee', accent: '#e879f9',
    },
    riderOverride: {
      frame: '#22d3ee', tyre: '#22d3ee', spoke: 'rgba(34,211,238,0.55)', disc: '#0b2b3a',
      jersey: '#e0fbff', pants: '#67e8f9', skin: '#a5f3fc', farPants: '#0e7490', farSkin: '#0e7490',
      helmet: '#22d3ee', hair: '#22d3ee', parts: '#67e8f9', shoe: '#e0fbff',
    },
    ghost: '#ff9f1c',
  },
};

export const sceneList: Scene[] = Object.values(scenes);

export function findScene(id: string | undefined, fallback: SceneId = 'day'): Scene {
  return (id && (scenes as Record<string, Scene>)[id]) || scenes[fallback];
}
