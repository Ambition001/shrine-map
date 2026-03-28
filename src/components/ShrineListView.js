import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';

export default function ShrineListView({ regionStats, visitedShrines, onToggleVisit, onFocusShrine }) {
  const [collapsedRegions, setCollapsedRegions] = useState(new Set());
  const [collapsedPrefectures, setCollapsedPrefectures] = useState(new Set());

  const toggleRegion = (region, prefectures) => {
    const isCurrentlyCollapsed = collapsedRegions.has(region);

    setCollapsedRegions(prev => {
      const next = new Set(prev);
      if (next.has(region)) {
        next.delete(region);
      } else {
        next.add(region);
      }
      return next;
    });

    // When expanding a region, also clear collapsed state for its prefectures
    if (isCurrentlyCollapsed) {
      setCollapsedPrefectures(prev => {
        const updated = new Set(prev);
        prefectures.forEach(p => updated.delete(`${region}-${p.prefecture}`));
        return updated;
      });
    }
  };

  const togglePrefecture = (region, prefecture) => {
    const key = `${region}-${prefecture}`;
    setCollapsedPrefectures(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="absolute inset-0 overflow-auto p-4 space-y-4 bg-gray-50">
      {regionStats.map(({ region, total, visited, percentage, prefectures }) => {
        const isRegionCollapsed = collapsedRegions.has(region);

        return (
          /* region names come from REGION_ORDER — stable string constants, safe as keys */
          <div key={region}>
            {/* Region header */}
            <div
              className="bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg p-3 mb-3 shadow cursor-pointer"
              onClick={() => toggleRegion(region, prefectures)}
            >
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2">
                  {isRegionCollapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
                  <h2 className="text-lg font-bold">{region}</h2>
                </div>
                <div className="text-sm">
                  {visited}/{total}社 ({percentage}%)
                </div>
              </div>
              <div className="w-full bg-red-900 rounded-full h-1.5">
                <div
                  className="bg-yellow-400 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>

            {/* Prefecture list (hidden when region is collapsed) */}
            {!isRegionCollapsed && (
              <div className="space-y-3 ml-2">
                {prefectures.map(({ prefecture, shrines: prefectureShrines, total, visited }) => {
                  const isCollapsed = collapsedPrefectures.has(`${region}-${prefecture}`);

                  return (
                    <div key={`${region}-${prefecture}`}>
                      {/* Prefecture header */}
                      <div
                        className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-2 pl-1 border-l-2 border-red-400 cursor-pointer hover:text-gray-900"
                        onClick={() => togglePrefecture(region, prefecture)}
                      >
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        <span>{prefecture}</span>
                        <span className="text-gray-500 font-normal">({visited}/{total})</span>
                      </div>

                      {/* Shrine list (hidden when prefecture is collapsed) */}
                      {!isCollapsed && (
                        <div className="space-y-2">
                          {prefectureShrines.map(shrine => {
                            const isVisited = visitedShrines.has(shrine.id);
                            return (
                              <div
                                key={shrine.id}
                                className="bg-white rounded-lg shadow p-3 hover:shadow-md transition-shadow ml-4"
                              >
                                <div className="flex items-start justify-between">
                                  <div
                                    className="flex-1 cursor-pointer"
                                    onClick={() => onFocusShrine(shrine)}
                                  >
                                    <div className="flex items-center gap-2 mb-1">
                                      <h3 className="font-bold text-gray-900">{shrine.name}</h3>
                                      {isVisited && (
                                        <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">
                                          参拝済
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-500">{shrine.province}</p>
                                  </div>
                                  <button
                                    onClick={() => onToggleVisit(shrine.id)}
                                    className={`p-2 rounded-full ${
                                      isVisited ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                                    }`}
                                  >
                                    <Check size={20} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
