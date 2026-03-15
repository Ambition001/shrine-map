/**
 * Tests for src/utils/shrineUtils.js
 *
 * All functions are pure (no I/O, no side effects), so tests are
 * straightforward input → output assertions.
 */

import {
  REGION_ORDER,
  generateGeoJSON,
  groupByRegionAndPrefecture,
  computeRegionStats,
  computeStats,
} from '../utils/shrineUtils';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const kanto1 = { id: 1, name: '氷川神社', prefecture: '埼玉県', province: '武蔵国', region: '関東', lat: 35.8, lng: 139.6 };
const kanto2 = { id: 2, name: '寒川神社', prefecture: '神奈川県', province: '相模国', region: '関東', lat: 35.3, lng: 139.4 };
const tohoku1 = { id: 3, name: '鹽竈神社', prefecture: '宮城県', province: '陸前国', region: '北海道・東北', lat: 38.3, lng: 141.0 };
const noRegion = { id: 4, name: '謎の神社', prefecture: '不明県', province: '不明国', lat: 35.0, lng: 135.0 };

// ---------------------------------------------------------------------------
// REGION_ORDER
// ---------------------------------------------------------------------------

describe('REGION_ORDER', () => {
  test('contains exactly 7 canonical regions', () => {
    expect(REGION_ORDER).toHaveLength(7);
  });

  test('starts with 北海道・東北 and ends with 九州・沖縄', () => {
    expect(REGION_ORDER[0]).toBe('北海道・東北');
    expect(REGION_ORDER[REGION_ORDER.length - 1]).toBe('九州・沖縄');
  });
});

// ---------------------------------------------------------------------------
// generateGeoJSON
// ---------------------------------------------------------------------------

describe('generateGeoJSON', () => {
  test('returns a GeoJSON FeatureCollection', () => {
    const result = generateGeoJSON([kanto1], new Set());
    expect(result.type).toBe('FeatureCollection');
    expect(Array.isArray(result.features)).toBe(true);
  });

  test('produces one feature per shrine', () => {
    const result = generateGeoJSON([kanto1, kanto2, tohoku1], new Set());
    expect(result.features).toHaveLength(3);
  });

  test('sets visited: true only for shrines in the visited set', () => {
    const visited = new Set([1, 3]);
    const result = generateGeoJSON([kanto1, kanto2, tohoku1], visited);

    const byId = Object.fromEntries(result.features.map(f => [f.properties.id, f.properties.visited]));
    expect(byId[1]).toBe(true);
    expect(byId[2]).toBe(false);
    expect(byId[3]).toBe(true);
  });

  test('stores coordinates as [lng, lat] (GeoJSON convention)', () => {
    const result = generateGeoJSON([kanto1], new Set());
    const [lng, lat] = result.features[0].geometry.coordinates;
    expect(lng).toBe(kanto1.lng);
    expect(lat).toBe(kanto1.lat);
  });

  test('includes name and prefecture in feature properties', () => {
    const result = generateGeoJSON([kanto1], new Set());
    const props = result.features[0].properties;
    expect(props.name).toBe('氷川神社');
    expect(props.prefecture).toBe('埼玉県');
    expect(props.province).toBe('武蔵国');
  });

  test('returns empty features array for empty shrine list', () => {
    const result = generateGeoJSON([], new Set());
    expect(result.features).toHaveLength(0);
  });

  test('returns all features with visited: false when visited set is empty', () => {
    const result = generateGeoJSON([kanto1, kanto2], new Set());
    expect(result.features.every(f => f.properties.visited === false)).toBe(true);
  });

  test('returns all features with visited: true when all shrines are visited', () => {
    const shrines = [kanto1, kanto2];
    const visited = new Set([1, 2]);
    const result = generateGeoJSON(shrines, visited);
    expect(result.features.every(f => f.properties.visited === true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// groupByRegionAndPrefecture
// ---------------------------------------------------------------------------

describe('groupByRegionAndPrefecture', () => {
  test('groups shrines by region then prefecture', () => {
    const result = groupByRegionAndPrefecture([kanto1, kanto2, tohoku1]);
    expect(result['関東']['埼玉県']).toContain(kanto1);
    expect(result['関東']['神奈川県']).toContain(kanto2);
    expect(result['北海道・東北']['宮城県']).toContain(tohoku1);
  });

  test('places shrines without region under 不明', () => {
    const result = groupByRegionAndPrefecture([noRegion]);
    expect(result['不明']).toBeDefined();
    expect(result['不明']['不明県']).toContain(noRegion);
  });

  test('returns empty object for empty input', () => {
    expect(groupByRegionAndPrefecture([])).toEqual({});
  });

  test('multiple shrines in the same prefecture are all included', () => {
    const kanto3 = { ...kanto1, id: 99, name: '別の神社' };
    const result = groupByRegionAndPrefecture([kanto1, kanto3]);
    expect(result['関東']['埼玉県']).toHaveLength(2);
  });

  test('does not mutate the input array', () => {
    const input = [kanto1, kanto2];
    const copy = [...input];
    groupByRegionAndPrefecture(input);
    expect(input).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// computeRegionStats
// ---------------------------------------------------------------------------

describe('computeRegionStats', () => {
  const shrines = [kanto1, kanto2, tohoku1];

  test('only includes regions present in the shrine list', () => {
    const result = computeRegionStats(shrines, new Set());
    const regions = result.map(r => r.region);
    expect(regions).toContain('関東');
    expect(regions).toContain('北海道・東北');
    // Regions not in the data must be absent
    expect(regions).not.toContain('近畿');
  });

  test('regions are returned in REGION_ORDER sequence', () => {
    const result = computeRegionStats(shrines, new Set());
    const regions = result.map(r => r.region);
    // 北海道・東北 comes before 関東 in REGION_ORDER
    expect(regions.indexOf('北海道・東北')).toBeLessThan(regions.indexOf('関東'));
  });

  test('total counts match number of shrines in the region', () => {
    const result = computeRegionStats(shrines, new Set());
    const kanto = result.find(r => r.region === '関東');
    expect(kanto.total).toBe(2); // kanto1 + kanto2
  });

  test('visited counts match the provided visited set', () => {
    const visited = new Set([1]); // only kanto1
    const result = computeRegionStats(shrines, visited);
    const kanto = result.find(r => r.region === '関東');
    expect(kanto.visited).toBe(1);
    expect(kanto.total).toBe(2);
  });

  test('percentage is rounded to nearest integer', () => {
    const visited = new Set([1]); // 1 of 2 in Kanto → 50%
    const result = computeRegionStats(shrines, visited);
    const kanto = result.find(r => r.region === '関東');
    expect(kanto.percentage).toBe(50);
  });

  test('percentage is 0 when no shrines are visited', () => {
    const result = computeRegionStats(shrines, new Set());
    result.forEach(r => expect(r.percentage).toBe(0));
  });

  test('percentage is 100 when all shrines in a region are visited', () => {
    const visited = new Set([1, 2]);
    const result = computeRegionStats(shrines, visited);
    const kanto = result.find(r => r.region === '関東');
    expect(kanto.percentage).toBe(100);
  });

  test('prefecture list within each region is sorted alphabetically', () => {
    // Add a second prefecture in Kanto that sorts before 埼玉県
    const kantoExtra = { id: 5, name: '神田明神', prefecture: '東京都', province: '武蔵国', region: '関東', lat: 35.7, lng: 139.7 };
    const result = computeRegionStats([kanto1, kanto2, kantoExtra], new Set());
    const kanto = result.find(r => r.region === '関東');
    const prefNames = kanto.prefectures.map(p => p.prefecture);
    expect(prefNames).toEqual([...prefNames].sort());
  });

  test('each prefecture entry includes shrines array, total and visited', () => {
    const result = computeRegionStats([kanto1], new Set([1]));
    const pref = result.find(r => r.region === '関東').prefectures[0];
    expect(pref.prefecture).toBe('埼玉県');
    expect(pref.total).toBe(1);
    expect(pref.visited).toBe(1);
    expect(pref.shrines).toContain(kanto1);
  });

  test('returns empty array when shrine list is empty', () => {
    expect(computeRegionStats([], new Set())).toEqual([]);
  });

  test('shrines without a region (不明) are excluded from output (not in REGION_ORDER)', () => {
    const result = computeRegionStats([noRegion], new Set());
    const regions = result.map(r => r.region);
    expect(regions).not.toContain('不明');
  });
});

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------

describe('computeStats', () => {
  test('returns correct total from shrine array length', () => {
    const { total } = computeStats([kanto1, kanto2, tohoku1], new Set());
    expect(total).toBe(3);
  });

  test('returns correct visited count from Set size', () => {
    const { visited } = computeStats([kanto1, kanto2, tohoku1], new Set([1, 3]));
    expect(visited).toBe(2);
  });

  test('calculates percentage rounded to nearest integer', () => {
    // 1 of 3 = 33.33... → rounds to 33
    const { percentage } = computeStats([kanto1, kanto2, tohoku1], new Set([1]));
    expect(percentage).toBe(33);
  });

  test('returns 0% when nothing is visited', () => {
    const { percentage } = computeStats([kanto1, kanto2], new Set());
    expect(percentage).toBe(0);
  });

  test('returns 100% when everything is visited', () => {
    const { percentage } = computeStats([kanto1, kanto2], new Set([1, 2]));
    expect(percentage).toBe(100);
  });

  test('returns 0% (not NaN) when shrine list is empty', () => {
    const { total, visited, percentage } = computeStats([], new Set());
    expect(total).toBe(0);
    expect(visited).toBe(0);
    expect(percentage).toBe(0);
    expect(Number.isNaN(percentage)).toBe(false);
  });

  test('rounds 50% correctly', () => {
    const { percentage } = computeStats([kanto1, kanto2], new Set([1]));
    expect(percentage).toBe(50);
  });
});
