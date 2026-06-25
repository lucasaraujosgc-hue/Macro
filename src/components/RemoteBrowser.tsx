import React, { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface RemoteBrowserProps {
  url: string;
  onRecordAction: (type: any, data: any) => void;
}

export default function RemoteBrowser({ url, onRecordAction }: RemoteBrowserProps) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(url);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (url) {
      goto(url);
    }
  }, [url]);

  const goto = async (targetUrl: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/browser/goto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl })
      });
      const data = await res.json();
      if (data.screenshot) setScreenshot(data.screenshot);
      if (data.url) setCurrentUrl(data.url);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Record action for macro
    onRecordAction("click", { selector: `RemoteClick(x:${Math.round(x)}, y:${Math.round(y)})` });

    setLoading(true);
    try {
      const res = await fetch("/api/browser/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y })
      });
      const data = await res.json();
      if (data.screenshot) setScreenshot(data.screenshot);
      if (data.url) setCurrentUrl(data.url);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleWheel = async (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    try {
      const res = await fetch("/api/browser/scroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deltaY: e.deltaY })
      });
      const data = await res.json();
      if (data.screenshot) setScreenshot(data.screenshot);
      if (data.url) setCurrentUrl(data.url);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt") return;
    
    // We only record text typing when the user uses the side panel, 
    // but we can send real-time keystrokes to the remote browser for interaction.
    setLoading(true);
    try {
      const res = await fetch("/api/browser/type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: e.key, text: e.key.length === 1 ? e.key : undefined })
      });
      const data = await res.json();
      if (data.screenshot) setScreenshot(data.screenshot);
      if (data.url) setCurrentUrl(data.url);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="relative w-full h-full overflow-hidden bg-slate-900 flex flex-col focus:outline-none" 
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="bg-slate-800 text-slate-300 text-xs px-3 py-1.5 flex justify-between items-center border-b border-slate-700">
        <span className="truncate flex-1">{currentUrl}</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin ml-2 text-indigo-400" />}
      </div>
      
      <div className="flex-1 overflow-auto relative flex justify-center bg-black/50">
        {screenshot ? (
          <img 
            ref={imgRef}
            src={screenshot} 
            alt="Remote Browser" 
            onClick={handleClick}
            className="max-w-none origin-top-left cursor-crosshair"
            draggable={false}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 flex-col space-y-4">
            {loading ? (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p>Conectando ao navegador remoto...</p>
              </>
            ) : (
              <p>Aguardando URL</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
