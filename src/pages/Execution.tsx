import { useEffect, useState } from "react";
import { MonitorPlay, ShieldAlert, Cpu } from "lucide-react";

export default function Execution() {
  const [execution, setExecution] = useState<any>(null);
  const [captchaText, setCaptchaText] = useState("");

  const loadExecution = () => fetch("/api/execution").then(r => r.json()).then(setExecution);

  useEffect(() => {
    loadExecution();
    const interval = setInterval(loadExecution, 2000);
    return () => clearInterval(interval);
  }, []);

  const resolveCaptcha = async () => {
    if(!captchaText) return;
    await fetch("/api/execution/resolve-captcha", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text: captchaText})
    });
    setCaptchaText("");
    loadExecution();
  };

  if (!execution) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-500 text-sm backdrop-blur-md bg-white/5 border border-white/10 rounded-xl shadow-xl shadow-black/10">
        Nenhuma execução ativa no momento. Inicie uma Macro na página de Automações.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center">
          <MonitorPlay className="w-6 h-6 mr-3 text-indigo-400" />
          Execução Ao Vivo
        </h1>
        <div className="flex items-center space-x-3 bg-black/20 px-3 py-1.5 rounded-full border border-white/5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Status</span>
          {execution.status === "running" && <span className="inline-flex items-center px-2 py-0.5 rounded border border-indigo-500/30 text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-400"><span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse mr-1.5"></span> Em andamento</span>}
          {execution.status === "paused" && <span className="inline-flex items-center px-2 py-0.5 rounded border border-amber-500/30 text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400"><span className="w-1.5 h-1.5 bg-amber-400 rounded-full mr-1.5"></span> Pausado (Aguardando)</span>}
          {execution.status === "completed" && <span className="inline-flex items-center px-2 py-0.5 rounded border border-green-500/30 text-[10px] font-bold uppercase tracking-wider bg-green-500/20 text-green-400"><span className="w-1.5 h-1.5 bg-green-400 rounded-full mr-1.5"></span> Concluído</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-auto lg:h-[600px]">
        {/* Terminal/Logs */}
        <div className="col-span-1 bg-black/40 backdrop-blur-md rounded-xl p-6 font-mono text-xs overflow-y-auto shadow-inner shadow-black/50 border border-white/10 flex flex-col h-[400px] lg:h-full">
          <div className="text-[10px] text-slate-600 mb-4 uppercase tracking-wider font-sans font-bold flex justify-between items-center">
            <span>Console Output</span>
            <span>Node #01</span>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto">
            {execution.logs.map((l: string, i: number) => {
              let colorClass = "text-slate-300";
              if (l.toLowerCase().includes("error") || l.toLowerCase().includes("fail")) colorClass = "text-red-400";
              else if (l.toLowerCase().includes("paused") || l.toLowerCase().includes("captcha") || l.toLowerCase().includes("certificado")) colorClass = "text-amber-400";
              else if (l.toLowerCase().includes("started") || l.toLowerCase().includes("completed")) colorClass = "text-green-400";
              else if (l.toLowerCase().includes("executing")) colorClass = "text-indigo-300";

              return <div key={i} className={colorClass}>&gt; {l}</div>;
            })}
            {execution.status === "running" && (
              <div className="animate-pulse mt-2 text-slate-500">_</div>
            )}
          </div>
        </div>

        {/* Viewport/Browser Mock */}
        <div className="col-span-1 lg:col-span-2 flex flex-col bg-[#0f111a] rounded-xl border border-white/10 overflow-hidden shadow-xl h-[500px] lg:h-full relative">
           {/* Browser OS bar */}
           <div className="bg-[#1e1e2f] border-b border-white/5 py-2 px-4 flex items-center space-x-3">
              <div className="flex space-x-1.5">
                 <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                 <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                 <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
              </div>
              <div className="flex-1 max-w-lg mx-auto bg-black/30 text-slate-400 flex items-center px-3 py-1 rounded-md text-[11px] font-mono border border-black/50 truncate">
                 <Cpu className="w-3 h-3 mr-2 opacity-50" /> 
                 {execution.currentUrl || 'about:blank'}
              </div>
           </div>

           {/* Inner View */}
           <div className="flex-1 flex bg-white/5 relative items-center justify-center overflow-hidden">
               {execution.currentUrl && execution.currentUrl !== 'about:blank' ? (
                   // Since real screenshot streaming isn't fully implemented in the demo backend,
                   // we show the proxy iframe or a mocked scanner overlay on top of the iframe.
                   <div className="w-full h-full relative">
                       <iframe 
                           src={`/api/proxy?url=${encodeURIComponent(execution.currentUrl)}&topLevel=true`} 
                           className="w-full h-full border-none opacity-50 grayscale select-none pointer-events-none"
                           title="Browser Simulador"
                       />
                       {/* Removing 'Coletando Dados' overlay as requested */}
                   </div>
               ) : (
                   <div className="text-center text-slate-500 space-y-3">
                       <MonitorPlay className="w-12 h-12 mx-auto opacity-20" />
                       <p className="text-xs font-mono uppercase tracking-widest">Navegador em Standby</p>
                   </div>
               )}

               {/* Captcha Overlay */}
               {execution.status === "paused" && execution.screenshot && (
                 <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
                    <div className="w-full max-w-sm backdrop-blur-xl bg-amber-500/10 p-6 rounded-xl border border-amber-500/20 border-t-4 border-t-amber-500 shadow-2xl flex flex-col pt-5 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                        <ShieldAlert className="w-24 h-24 text-amber-500" />
                      </div>

                      <h3 className="font-bold text-amber-400 mb-1 tracking-tight">Intervenção Manual</h3>
                      <p className="text-xs text-slate-400 mb-6 leading-relaxed bg-black/50 p-2 rounded border border-white/5">Resolva o obstáculo para prosseguir.</p>
                      
                      <div className="border border-white/10 rounded-lg p-2 mb-6 flex justify-center bg-black/40 shadow-inner">
                         <img src={execution.screenshot} alt="Captcha" className="max-w-full h-auto rounded opacity-80 mix-blend-screen" />
                      </div>

                      <div className="mt-auto space-y-3 z-10">
                        <input 
                          type="text" 
                          value={captchaText}
                          onChange={e => setCaptchaText(e.target.value)}
                          className="w-full bg-black/50 border-white/10 text-white rounded-lg border px-4 py-3 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none placeholder-slate-600 transition-all text-center font-mono tracking-widest uppercase" 
                          placeholder="Código / PIN / Captcha"
                        />
                        <button 
                          onClick={resolveCaptcha}
                          disabled={!captchaText}
                          className="w-full bg-amber-600 text-white font-bold text-sm py-3 px-4 rounded-lg hover:bg-amber-500 disabled:opacity-50 disabled:hover:bg-amber-600 transition-all shadow-lg shadow-amber-600/20 border border-transparent"
                        >
                          Enviar e Retomar
                        </button>
                      </div>
                    </div>
                 </div>
               )}
           </div>
        </div>
      </div>
    </div>
  );
}
