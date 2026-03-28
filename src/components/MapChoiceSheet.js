import React from 'react';

export default function MapChoiceSheet({ shrine, onClose }) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />
      {/* Bottom sheet */}
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl z-50 p-4 pb-8 animate-slide-up">
        <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
        <p className="text-center text-gray-600 mb-4">地図アプリを選択</p>
        <div className="space-y-2">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${parseFloat(shrine.lat)},${parseFloat(shrine.lng)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-center font-medium transition-colors"
            onClick={onClose}
          >
            Google Maps
          </a>
          <a
            href={`https://maps.apple.com/?ll=${parseFloat(shrine.lat)},${parseFloat(shrine.lng)}&q=${encodeURIComponent(shrine.name)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-center font-medium transition-colors"
            onClick={onClose}
          >
            Apple Maps
          </a>
        </div>
        <button
          onClick={onClose}
          className="w-full mt-4 py-3 text-blue-500 font-medium"
        >
          キャンセル
        </button>
      </div>
    </>
  );
}
