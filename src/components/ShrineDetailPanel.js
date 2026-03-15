import React from 'react';
import { Check, X, MapPin, ExternalLink } from 'lucide-react';

export default function ShrineDetailPanel({ shrine, isVisited, onToggle, onClose, onMapChoice }) {
  return (
    <div className="absolute bottom-4 left-4 right-4 bg-white rounded-lg shadow-xl p-4 z-10">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{shrine.name}</h3>
          <p className="text-xs text-gray-500">{shrine.reading}</p>
          <p className="text-sm text-gray-600">{shrine.province} ・ {shrine.prefecture}</p>
          {shrine.goshuinHours && (
            <p className="text-sm text-gray-600">
              <span className="font-medium">御朱印受付:</span> {shrine.goshuinHours}
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onToggle(shrine.id)}
          className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
            isVisited
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-red-500 text-white hover:bg-red-600'
          }`}
        >
          {isVisited ? (
            <span className="flex items-center justify-center gap-2">
              <Check size={18} /> 参拝済み
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <MapPin size={18} /> 参拝済みとしてマーク
            </span>
          )}
        </button>
        <button
          onClick={onMapChoice}
          className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors flex items-center gap-2 font-medium"
        >
          <ExternalLink size={18} />
          地図
        </button>
      </div>
    </div>
  );
}
