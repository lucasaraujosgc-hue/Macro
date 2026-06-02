import { useEffect, useState } from "react";
import { Macro, MacroStep, MacroStepType } from "@/types";
import { Plus, Trash2, Edit2, Play, Save, ChevronRight, GripVertical } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

export default function Macros() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [editingMacro, setEditingMacro] = useState<Macro | null>(null);
  const [proxyUrlInput, setProxyUrlInput] = useState("https://example.com");
  const [activeProxyUrl, setActiveProxyUrl] = useState("");

  const loadMacros = () => fetch("/api/macros").then(r => r.json()).then(setMacros);
  useEffect(() => { loadMacros(); }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Must check for event.data existence to avoid errors on generic postMessages
      if (!event.data || typeof event.data !== 'object') return;
      
      // If we aren't editing, we still might want to capture, but the handler logic uses editingMacro.
      // Wait, since we are using functional state update in addStep, we can actually just call it if editingMacro is set.
      if (!editingMacro) return;

      if (event.data.type === 'recorder_click') {
        addStep('click', { selector: event.data.selector });
      } else if (event.data.type === 'recorder_navigate') {
        const url = event.data.url;
        setProxyUrlInput(url);
        setActiveProxyUrl(url);
        addStep('navigate', { value: url });
      } else if (event.data.type === 'recorder_cert_request') {
        addStep('install_cert');
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [editingMacro]);

  const handleSave = async () => {
    if(!editingMacro) return;
    const url = editingMacro.id.startsWith("new") ? "/api/macros" : `/api/macros/${editingMacro.id}`;
    const method = editingMacro.id.startsWith("new") ? "POST" : "PUT";
    
    // remove dummy id for creation
    const payload = { ...editingMacro };
    if (payload.id.startsWith("new")) {
      // @ts-ignore
      delete payload.id;
    }

    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setEditingMacro(null);
    loadMacros();
  };

  const addStep = (type: MacroStepType, data: Partial<MacroStep> = {}) => {
    setEditingMacro(prev => {
      if(!prev) return prev;
      return {
        ...prev,
        steps: [...prev.steps, { id: uuidv4(), type, ...data }]
      };
    });
  };

  const updateStep = (id: string, updates: Partial<MacroStep>) => {
    if(!editingMacro) return;
    setEditingMacro({
      ...editingMacro,
      steps: editingMacro.steps.map(s => s.id === id ? { ...s, ...updates } : s)
    });
  };

  const removeStep = (id: string) => {
    if(!editingMacro) return;
    setEditingMacro({
      ...editingMacro,
      steps: editingMacro.steps.filter(s => s.id !== id)
    });
  }

  const handleDelete = async (id: string) => {
    if(!confirm("Remover automação?")) return;
    await fetch(`/api/macros/${id}`, { method: "DELETE" });
    loadMacros();
  }

  const startExecution = async (id: string) => {
    await fetch(`/api/execute/${id}`, { method: "POST" });
    window.location.hash = "#/execution";
  }

  if (editingMacro) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center backdrop-blur-md bg-white/5 p-4 rounded-xl border border-white/10 shadow-xl shadow-black/10">
          <input 
            value={editingMacro.name} 
            onChange={e => setEditingMacro({...editingMacro, name: e.target.value})}
            className="text-2xl font-bold bg-transparent border border-transparent hover:border-white/10 outline-none focus:border-indigo-500 focus:bg-black/20 rounded-md px-3 py-1 text-white transition-all w-full max-w-lg"
            placeholder="Nome da Automação"
          />
          <div className="flex space-x-3 ml-4">
            <button onClick={() => setEditingMacro(null)} className="px-4 py-2 text-sm text-slate-300 hover:bg-white/10 rounded-lg border border-white/10 transition-colors">Cancelar</button>
            <button onClick={handleSave} className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 text-sm font-semibold shadow-lg shadow-indigo-500/20 transition-all border border-transparent"><Save className="h-4 w-4 mr-2"/> Salvar</button>
          </div>
        </div>

        <div className="flex flex-col xl:flex-row gap-6">
          <div className="w-full xl:w-64 space-y-2 flex-shrink-0">
            <h3 className="font-semibold text-slate-400 mb-4 text-xs uppercase tracking-wider px-1">Adicionar Ação</h3>
            <button onClick={()=>addStep('navigate')} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-indigo-400 hover:bg-indigo-500/10 text-sm font-medium text-slate-200 transition-all">🌐 Navegar para URL</button>
            <button onClick={()=>addStep('click')} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-indigo-400 hover:bg-indigo-500/10 text-sm font-medium text-slate-200 transition-all">🖱️ Clicar em Elemento</button>
            <button onClick={()=>addStep('type')} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-indigo-400 hover:bg-indigo-500/10 text-sm font-medium text-slate-200 transition-all">⌨️ Digitar Texto / Var</button>
            <button onClick={()=>addStep('wait')} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-indigo-400 hover:bg-indigo-500/10 text-sm font-medium text-slate-200 transition-all">⏳ Pausa (Seg)</button>
            <button onClick={()=>addStep('install_cert')} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-purple-400 hover:bg-purple-500/10 text-sm font-medium text-slate-200 transition-all">🔐 Selecionar Certificado</button>
            <button onClick={()=>addStep('captcha_wait')} className="w-full text-left px-4 py-3 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg hover:border-amber-400 hover:bg-amber-500/20 text-sm font-medium transition-all shadow-lg shadow-amber-500/5">🤖 Captcha Manual</button>
          </div>

          <div className="flex-1 space-y-3">
            <h3 className="font-semibold text-slate-400 mb-4 text-xs uppercase tracking-wider px-1">Sequência ({editingMacro.steps.length} passos)</h3>
            
            {editingMacro.steps.length === 0 && (
              <div className="p-12 text-center border-2 border-dashed border-white/10 bg-white/5 rounded-xl text-slate-500 text-sm">
                Adicione ações no painel à esquerda para construir sua automação.
              </div>
            )}

            {editingMacro.steps.map((step, index) => (
              <div key={step.id} className="flex items-start backdrop-blur-md p-4 rounded-xl border border-white/10 bg-gradient-to-r from-white/5 to-transparent">
                <div className="mt-1 mr-3 text-slate-500"><GripVertical className="h-5 w-5"/></div>
                <div className="flex-1 grid gap-3">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-indigo-400 font-mono text-[11px] uppercase tracking-wider">
                      {String(index + 1).padStart(2, '0')}. {step.type.toUpperCase()}
                    </span>
                    <button onClick={() => removeStep(step.id)} className="text-slate-500 hover:text-red-400 transition-colors bg-white/5 hover:bg-white/10 p-1.5 rounded"><Trash2 className="h-4 w-4"/></button>
                  </div>
                  
                  {step.type === 'navigate' && (
                    <input type="text" placeholder="https://..." value={step.value || ''} onChange={e => updateStep(step.id, {value: e.target.value})} className="w-full text-sm bg-black/20 border-white/10 text-white placeholder-slate-600 rounded-lg border px-3 py-2 outline-none focus:border-indigo-500"/>
                  )}
                  {step.type === 'click' && (
                    <input type="text" placeholder="Seletor CSS (ex: #botao-login)" value={step.selector || ''} onChange={e => updateStep(step.id, {selector: e.target.value})} className="w-full text-sm bg-black/20 border-white/10 text-indigo-300 placeholder-slate-600 rounded-lg border px-3 py-2 font-mono outline-none focus:border-indigo-500"/>
                  )}
                  {step.type === 'type' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input type="text" placeholder="Seletor CSS" value={step.selector || ''} onChange={e => updateStep(step.id, {selector: e.target.value})} className="text-sm bg-black/20 border-white/10 text-indigo-300 placeholder-slate-600 rounded-lg border px-3 py-2 font-mono outline-none focus:border-indigo-500"/>
                      <input type="text" placeholder="Constante ou Var (ex: {{CNPJ}}, {{RAZAO_SOCIAL}})" value={step.value || ''} onChange={e => updateStep(step.id, {value: e.target.value})} className="text-sm bg-black/20 border-white/10 text-white placeholder-slate-600 rounded-lg border px-3 py-2 outline-none focus:border-indigo-500"/>
                    </div>
                  )}
                  {step.type === 'install_cert' && (
                    <p className="text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 px-3 py-2 rounded-lg">
                      Seleciona virtualmente o certificado digital correspondente (A1 ou Pin do A3) da empresa em execução.
                    </p>
                  )}
                  {step.type === 'wait' && (
                    <div className="flex items-center">
                      <input type="number" min="0.1" step="0.1" value={step.waitTime || 1} onChange={e => updateStep(step.id, {waitTime: parseFloat(e.target.value)})} className="w-24 text-sm bg-black/20 border-white/10 text-white rounded-lg border px-3 py-2 mr-3 outline-none focus:border-indigo-500 text-center"/> <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Segundos</span>
                    </div>
                  )}
                  {step.type === 'captcha_wait' && (
                    <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg">
                      Ao atingir este passo, a automação será pausada até a resolução manual.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex-1 space-y-3 min-w-[400px]">
            <h3 className="font-semibold text-slate-400 mb-4 text-xs uppercase tracking-wider px-1">Simulador Web (Gravação)</h3>
            <div className="backdrop-blur-md bg-white/5 p-4 rounded-xl border border-white/10 shadow-xl shadow-black/10 flex flex-col h-[600px]">
              <div className="flex space-x-2 mb-3">
                <input 
                  type="text" 
                  value={proxyUrlInput} 
                  onChange={e => setProxyUrlInput(e.target.value)} 
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                       setActiveProxyUrl(proxyUrlInput);
                       addStep('navigate', { value: proxyUrlInput });
                    }
                  }}
                  className="flex-1 text-sm bg-black/20 border-white/10 text-white placeholder-slate-600 rounded-lg border px-3 py-2 outline-none focus:border-indigo-500"
                  placeholder="https://exemplo.com.br" 
                />
                <button 
                  onClick={() => {
                    setActiveProxyUrl(proxyUrlInput);
                    addStep('navigate', { value: proxyUrlInput });
                  }}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all">
                  Ir
                </button>
              </div>
              <div className="flex-1 bg-white rounded-lg overflow-hidden border border-white/20 relative">
                {!activeProxyUrl ? (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400 flex-col">
                    <p className="text-sm font-medium">Nenhuma URL Carregada</p>
                    <p className="text-xs text-slate-500 mt-2">Navegue para capturar elementos com apenas um clique</p>
                  </div>
                ) : (
                  <iframe 
                    src={`/api/proxy?url=${encodeURIComponent(activeProxyUrl)}`} 
                    className="w-full h-full border-none"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    title="Simulador de Gravação"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight text-white">Automações (RPA)</h1>
        <button onClick={() => setEditingMacro({ id: `new-${Date.now()}`, name: "Nova Automação", steps: [] })} className="flex items-center px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 rounded-lg transition-all border border-transparent">
          <Plus className="h-4 w-4 mr-2" /> Criar Macro
        </button>
      </div>

      <div className="backdrop-blur-md bg-white/5 rounded-xl border border-white/10 overflow-hidden shadow-xl shadow-black/10">
        <ul className="divide-y divide-white/10">
          {macros.map(m => (
            <li key={m.id} className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors">
              <div>
                <p className="text-base font-bold text-white mb-1">{m.name}</p>
                <p className="text-[11px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 inline-block">{m.steps.length} PASSOS</p>
              </div>
              <div className="flex space-x-2 items-center">
                <button onClick={() => startExecution(m.id)} className="flex items-center px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 rounded-lg text-xs font-bold uppercase tracking-wider mr-4 shadow-lg shadow-green-500/10 transition-all">
                  <Play className="h-3 w-3 mr-1.5" /> Executar
                </button>
                <button onClick={() => setEditingMacro(m)} className="text-slate-400 hover:text-indigo-400 p-2 bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10 rounded-md transition-colors"><Edit2 className="h-4 w-4" /></button>
                <button onClick={() => handleDelete(m.id)} className="text-slate-400 hover:text-red-400 p-2 bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10 rounded-md transition-colors"><Trash2 className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
          {macros.length === 0 && <li className="p-8 text-center text-slate-500 text-sm">Nenhuma automação configurada.</li>}
        </ul>
      </div>
    </div>
  );
}
