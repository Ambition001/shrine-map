import React from 'react';
import { X } from 'lucide-react';

export default function StatusBanners({
  syncMessage,
  user,
  authLoading,
  showLoginPrompt,
  onDismissLoginPrompt,
  syncError,
  isOnline,
}) {
  return (
    <>
      {syncMessage && (
        <div className="bg-green-500 text-white px-4 py-2 text-sm text-center">
          ✓ {syncMessage}
        </div>
      )}

      {!user && !authLoading && showLoginPrompt && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-800 text-center relative">
          <span>ログインすると記録をクラウドに保存できます</span>
          <button
            onClick={onDismissLoginPrompt}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-yellow-600 hover:text-yellow-800 p-1"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {syncError && (
        <div className="bg-red-500 text-white px-4 py-2 text-sm text-center">
          ⚠ {syncError}
        </div>
      )}

      {!isOnline && (
        <div className="bg-orange-500 text-white px-4 py-2 text-sm text-center">
          オフラインモード - データは後で同期されます
        </div>
      )}
    </>
  );
}
