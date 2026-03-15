/**
 * Pure utility functions for shrine data transformation.
 * Extracted from App.js so they can be tested independently and reused.
 */

/** Canonical region display order for the list view. */
export const REGION_ORDER = [
  '北海道・東北',
  '関東',
  '北陸',
  '東海',
  '近畿',
  '中国・四国',
  '九州・沖縄',
];

/**
 * Build a Mapbox-ready GeoJSON FeatureCollection from shrine data.
 *
 * @param {Array<{id: number, name: string, prefecture: string, province: string, lat: number, lng: number}>} shrines
 * @param {Set<number>} visitedSet - Set of visited shrine IDs
 * @returns {GeoJSON.FeatureCollection}
 */
export function generateGeoJSON(shrines, visitedSet) {
  return {
    type: 'FeatureCollection',
    features: shrines.map(shrine => ({
      type: 'Feature',
      properties: {
        id: shrine.id,
        name: shrine.name,
        prefecture: shrine.prefecture,
        province: shrine.province,
        visited: visitedSet.has(shrine.id),
      },
      geometry: {
        type: 'Point',
        coordinates: [shrine.lng, shrine.lat],
      },
    })),
  };
}

/**
 * Group an array of shrines into a nested map: region → prefecture → shrine[].
 * Shrines without a region fall under '不明'.
 *
 * @param {Array} shrines
 * @returns {{ [region: string]: { [prefecture: string]: Array } }}
 */
export function groupByRegionAndPrefecture(shrines) {
  return shrines.reduce((acc, shrine) => {
    const region = shrine.region || '不明';
    const prefecture = shrine.prefecture || '不明';
    if (!acc[region]) acc[region] = {};
    if (!acc[region][prefecture]) acc[region][prefecture] = [];
    acc[region][prefecture].push(shrine);
    return acc;
  }, {});
}

/**
 * Compute per-region statistics including prefecture-level breakdowns.
 * Regions are returned in REGION_ORDER; regions not in REGION_ORDER are omitted.
 *
 * @param {Array} shrines
 * @param {Set<number>} visitedSet
 * @returns {Array<{
 *   region: string,
 *   total: number,
 *   visited: number,
 *   percentage: number,
 *   prefectures: Array<{ prefecture: string, shrines: Array, total: number, visited: number }>
 * }>}
 */
export function computeRegionStats(shrines, visitedSet) {
  const byRegionPref = groupByRegionAndPrefecture(shrines);
  const sortedRegions = REGION_ORDER.filter(r => byRegionPref[r]);

  return sortedRegions.map(region => {
    const prefMap = byRegionPref[region];
    const prefectureList = Object.keys(prefMap).sort();

    let regionTotal = 0;
    let regionVisited = 0;

    const prefectures = prefectureList.map(prefecture => {
      const shrineList = prefMap[prefecture];
      const visitedCount = shrineList.filter(s => visitedSet.has(s.id)).length;
      regionTotal += shrineList.length;
      regionVisited += visitedCount;
      return {
        prefecture,
        shrines: shrineList,
        total: shrineList.length,
        visited: visitedCount,
      };
    });

    return {
      region,
      total: regionTotal,
      visited: regionVisited,
      percentage: regionTotal > 0
        ? Math.round((regionVisited / regionTotal) * 100)
        : 0,
      prefectures,
    };
  });
}

/**
 * Compute overall visit statistics.
 * Guards against division-by-zero when the shrine list is empty.
 *
 * @param {Array} shrines
 * @param {Set<number>} visitedSet
 * @returns {{ total: number, visited: number, percentage: number }}
 */
export function computeStats(shrines, visitedSet) {
  const total = shrines.length;
  const visited = visitedSet.size;
  const percentage = total > 0 ? Math.round((visited / total) * 100) : 0;
  return { total, visited, percentage };
}
