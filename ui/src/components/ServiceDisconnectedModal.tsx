import React, { useEffect } from "react";
import { RefreshCw, WifiOff, X } from "lucide-react";

interface ServiceDisconnectedModalProps {
  isOpen: boolean;
  isReconnecting?: boolean;
  onReconnect: () => void | Promise<void>;
  onClose: () => void;
}

/** Shown once per disconnection. The dashboard stays offline and empty until the
 *  service answers again, so the notice never hides task data that does not exist. */
export const ServiceDisconnectedModal: React.FC<ServiceDisconnectedModalProps> = ({
  isOpen,
  isReconnecting = false,
  onReconnect,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        className="bg-zinc-950 rounded-lg border border-rose-900/70 max-w-md w-full flex flex-col overflow-hidden shadow-2xl font-mono text-xs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-disconnected-title"
      >
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
          <div className="flex items-center space-x-2.5 min-w-0">
            <WifiOff className="w-4 h-4 shrink-0 text-rose-400" />
            <h2
              id="service-disconnected-title"
              className="text-xs font-bold text-zinc-100 uppercase tracking-wider truncate"
            >
              WebUI 服务已断开
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isReconnecting}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors disabled:opacity-50"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 leading-relaxed text-zinc-300">
          无法连接到 MileStack 服务。当前不显示任务数据，请确认 milestack serve 仍在运行后重试。
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isReconnecting}
            className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 rounded transition-colors disabled:opacity-50"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => void onReconnect()}
            disabled={isReconnecting}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-rose-100 bg-rose-700/80 hover:bg-rose-600/80 border border-rose-600/70 rounded transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? "animate-spin" : ""}`} />
            {isReconnecting ? "正在重新连接..." : "重新连接"}
          </button>
        </div>
      </div>
    </div>
  );
};