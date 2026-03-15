import React from 'react';

export default function MergeConflictDialog({ dialog, onMergeAll, onUseCloud, onUseLocal }) {
  if (!dialog || dialog.type !== 'conflict') return null;

  const total = dialog.onlyLocalCount + dialog.onlyCloudCount + dialog.commonCount;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-3">
          データの競合が見つかりました
        </h3>
        <div className="text-sm text-gray-600 mb-4 space-y-1 bg-gray-50 rounded-lg p-3">
          <p>・このデバイスのみ: <span className="font-medium text-gray-900">{dialog.onlyLocalCount}件</span></p>
          <p>・クラウドのみ: <span className="font-medium text-gray-900">{dialog.onlyCloudCount}件</span></p>
          <p>・両方に存在: <span className="font-medium text-gray-900">{dialog.commonCount}件</span></p>
        </div>
        <div className="space-y-3">
          <button
            onClick={onMergeAll}
            className="w-full py-3 px-4 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            <div className="font-medium">すべて合併する（推奨）</div>
            <div className="text-xs text-green-100 mt-0.5">
              合計 {total}件になります
            </div>
          </button>

          <button
            onClick={onUseCloud}
            className="w-full py-3 px-4 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-left"
          >
            <div className="font-medium">クラウドのみ使用</div>
            <div className="text-xs text-red-500 mt-0.5">
              このデバイスの {dialog.onlyLocalCount}件 は削除されます
            </div>
          </button>

          <button
            onClick={onUseLocal}
            className="w-full py-3 px-4 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-left"
          >
            <div className="font-medium">このデバイスのみ使用</div>
            <div className="text-xs text-red-500 mt-0.5">
              クラウドの {dialog.onlyCloudCount}件 は削除されます
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
