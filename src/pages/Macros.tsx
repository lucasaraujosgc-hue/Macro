import React, { useEffect, useState, useRef } from "react";
import { Macro, MacroStep, MacroStepType, Company } from "@/types";
import { Plus, Trash2, Edit2, Play, Save, ChevronRight, GripVertical } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

import RemoteBrowser from "@/components/RemoteBrowser";

export default function Macros() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [editingMacro, setEditingMacro] = useState<Macro | null>(null);
  const [proxyUrlInput, setProxyUrlInput] = useState("https://example.com");
  const [activeProxyUrl, setActiveProxyUrl] = useState("");
  const [selectedRunMacroId, setSelectedRunMacroId] = useState<string | null>(null);
  const [selectedCompaniesForRun, setSelectedCompaniesForRun] = useState<string[]>([]);
  
  const loadMacros = () => fetch("/api/macros").then(r => r.json()).then(setMacros);
  const loadCompanies = () => fetch("/api/companies").then(r => r.json()).then(setCompanies);
  
  useEffect(() => { 
    loadMacros(); 
    loadCompanies();
  }, []);

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

  const [draggedStepIndex, setDraggedStepIndex] = useState<number | null>(null);

  const addStep = (type: MacroStepType, data: Partial<MacroStep> = {}) => {
    setEditingMacro(prev => {
      if(!prev) return prev;
      return {
        ...prev,
        steps: [...prev.steps, { id: uuidv4(), type, ...data }]
      };
    });
  };

  const duplicateStep = (step: MacroStep, index: number) => {
    if(!editingMacro) return;
    const newStep = { ...step, id: uuidv4() };
    const newSteps = [...editingMacro.steps];
    newSteps.splice(index + 1, 0, newStep);
    setEditingMacro({
      ...editingMacro,
      steps: newSteps
    });
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedStepIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedStepIndex === null || draggedStepIndex === dropIndex) return;
    if (!editingMacro) return;
    
    const newSteps = [...editingMacro.steps];
    const [draggedItem] = newSteps.splice(draggedStepIndex, 1);
    newSteps.splice(dropIndex, 0, draggedItem);
    
    setEditingMacro({
      ...editingMacro,
      steps: newSteps
    });
    setDraggedStepIndex(null);
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const updateStep = (id: string, updates: Partial<MacroStep>) => {
    setEditingMacro(prev => {
      if(!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map(s => s.id === id ? { ...s, ...updates } : s)
      };
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

  const openRunModal = (id: string) => {
    setSelectedRunMacroId(id);
    setSelectedCompaniesForRun([]);
  }

  const executeSelected = async () => {
    if (!selectedRunMacroId || selectedCompaniesForRun.length === 0) return;
    await fetch(`/api/execute/${selectedRunMacroId}`, { 
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyIds: selectedCompaniesForRun })
    });
    setSelectedRunMacroId(null);
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
              <div 
                key={step.id} 
                draggable 
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
                className={`flex items-start backdrop-blur-md p-4 rounded-xl border transition-all ${draggedStepIndex === index ? 'opacity-50 border-indigo-500 scale-95' : 'border-white/10 bg-gradient-to-r from-white/5 to-transparent'}`}
              >
                <div className="mt-1 mr-3 text-slate-500 cursor-grab hover:text-indigo-400 active:cursor-grabbing"><GripVertical className="h-5 w-5"/></div>
                <div className="flex-1 grid gap-3">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-indigo-400 font-mono text-[11px] uppercase tracking-wider">
                      {String(index + 1).padStart(2, '0')}. {step.type.toUpperCase()}
                    </span>
                    <div className="flex space-x-2">
                       <button onClick={() => duplicateStep(step, index)} className="text-slate-400 hover:text-indigo-300 transition-colors bg-white/5 hover:bg-white/10 px-2 py-1 text-xs font-semibold rounded">Duplicar</button>
                       <button onClick={() => removeStep(step.id)} className="text-slate-500 hover:text-red-400 transition-colors bg-white/5 hover:bg-white/10 p-1 rounded"><Trash2 className="h-4 w-4"/></button>
                    </div>
                  </div>
                  
                  {step.type === 'navigate' && (
                    <input type="text" placeholder="https://..." value={step.value || ''} onChange={e => updateStep(step.id, {value: e.target.value})} className="w-full text-sm bg-black/20 border-white/10 text-white placeholder-slate-600 rounded-lg border px-3 py-2 outline-none focus:border-indigo-500"/>
                  )}
                  {step.type === 'click' && (
                    <input type="text" placeholder="Seletor CSS (ex: #botao-login)" value={step.selector || ''} onChange={e => updateStep(step.id, {selector: e.target.value})} className="w-full text-sm bg-black/20 border-white/10 text-indigo-300 placeholder-slate-600 rounded-lg border px-3 py-2 font-mono outline-none focus:border-indigo-500"/>
                  )}
                  {step.type === 'type' && (
                    <div className="grid grid-cols-1 gap-3">
                      <input type="text" placeholder="Seletor CSS" value={step.selector || ''} onChange={e => updateStep(step.id, {selector: e.target.value})} className="text-sm bg-black/20 border-white/10 text-indigo-300 placeholder-slate-600 rounded-lg border px-3 py-2 font-mono outline-none focus:border-indigo-500"/>
                      <div>
                         <input type="text" placeholder="Constante ou Var (ex: {{CNPJ}}, {{RAZAO_SOCIAL}})" value={step.value || ''} onChange={e => updateStep(step.id, {value: e.target.value})} className="w-full text-sm bg-black/20 border-white/10 text-white placeholder-slate-600 rounded-lg border px-3 py-2 outline-none focus:border-indigo-500"/>
                         <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                            <span className="text-slate-500 uppercase font-semibold mr-1">Vars Disponíveis:</span>
                            {['{{CNPJ}}', '{{RAZAO_SOCIAL}}', '{{FANTASIA}}', '{{EMAIL}}', '{{TELEFONE}}', '{{IE}}', '{{IM}}'].map(v => (
                               <button key={v} onClick={() => {
                                 setEditingMacro(prev => {
                                   if (!prev) return prev;
                                   return {
                                     ...prev,
                                     steps: prev.steps.map(s => 
                                       s.id === step.id 
                                         ? { ...s, value: (s.value || '') + v }
                                         : s
                                     )
                                   };
                                 });
                               }} className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300 hover:text-indigo-400 hover:border-indigo-500/50 transition-colors">
                                  {v}
                               </button>
                            ))}
                         </div>
                      </div>
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
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-slate-400 flex-col">
                    <p className="text-sm font-medium">Nenhuma URL Carregada</p>
                    <p className="text-xs text-slate-500 mt-2">Insira a URL acima para usar o navegador remoto</p>
                  </div>
                ) : (
                  <RemoteBrowser url={activeProxyUrl} onRecordAction={addStep} />
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
                <button onClick={() => openRunModal(m.id)} className="flex items-center px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 rounded-lg text-xs font-bold uppercase tracking-wider mr-4 shadow-lg shadow-green-500/10 transition-all">
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

      {selectedRunMacroId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#020617] border border-white/10 rounded-xl max-w-lg w-full p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
            <h3 className="text-lg font-bold text-white mb-4">Selecionar Empresas</h3>
            <p className="text-xs text-slate-400 mb-6">Selecione as empresas para as quais deseja executar esta automação.</p>
            
            <div className="max-h-60 overflow-y-auto space-y-2 mb-6">
              {companies.map(c => (
                <label key={c.id} className="flex items-center space-x-4 p-3 bg-white/5 rounded-lg border border-white/5 cursor-pointer hover:bg-white/10 transition">
                  <input type="checkbox" className="form-checkbox h-4 w-4 rounded border-white/20 bg-black/20 text-indigo-500 focus:ring-indigo-500" 
                    checked={selectedCompaniesForRun.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedCompaniesForRun([...selectedCompaniesForRun, c.id]);
                      else setSelectedCompaniesForRun(selectedCompaniesForRun.filter(id => id !== c.id));
                    }}
                  />
                  <div>
                    <div className="text-sm font-bold text-white">{c.razaoSocial}</div>
                    <div className="text-xs font-mono text-slate-400 mt-0.5">{c.cnpj}</div>
                  </div>
                </label>
              ))}
              {companies.length === 0 && (
                <p className="text-center text-slate-500 text-sm py-4">Nenhuma empresa encontrada.</p>
              )}
            </div>
            
            <div className="flex justify-end space-x-3">
              <button onClick={() => setSelectedRunMacroId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/10 border border-transparent transition-colors">Cancelar</button>
              <button onClick={executeSelected} disabled={selectedCompaniesForRun.length === 0} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold shadow-lg shadow-indigo-500/20 transition-all border border-transparent">
                Iniciar Execução
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
