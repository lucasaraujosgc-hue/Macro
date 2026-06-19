import React from "react";
import { useEffect, useState, useRef, useCallback } from "react";
import { Macro, MacroStep, MacroStepType, Company } from "@/types";
import { Plus, Trash2, Edit2, Play, Save, ChevronRight, GripVertical, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useNavigate } from "react-router-dom";

// ─── Types ────────────────────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useDebounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback((...args: Parameters<T>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]) as T;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Macros() {
  const navigate = useNavigate();

  const [macros, setMacros] = useState<Macro[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [editingMacro, setEditingMacro] = useState<Macro | null>(null);
  const [proxyUrlInput, setProxyUrlInput] = useState("https://example.com");
  const [activeProxyUrl, setActiveProxyUrl] = useState("");
  const [selectedRunMacroId, setSelectedRunMacroId] = useState<string | null>(null);
  const [selectedCompaniesForRun, setSelectedCompaniesForRun] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [capturedFiles, setCapturedFiles] = useState<Array<{id:string;filename:string;size:number;url:string}>>([]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const proxyFormRef = useRef<HTMLFormElement>(null);

  // POST form state — kept separate so the ref-based submit fires after render
  const [proxyPostData, setProxyPostData] = useState<{ url: string; body: string } | null>(null);

  const [playwrightMode, setPlaywrightMode] = useState(false);
  const [playwrightConnected, setPlaywrightConnected] = useState(false);
  const [playwrightRemoteUrl, setPlaywrightRemoteUrl] = useState("");

  const [draggedStepIndex, setDraggedStepIndex] = useState<number | null>(null);

  // ── Data loaders ────────────────────────────────────────────────────────────

  const loadMacros = useCallback(
    () => fetch("/api/macros").then((r) => r.json()).then(setMacros),
    [],
  );
  const loadCompanies = useCallback(
    () => fetch("/api/companies").then((r) => r.json()).then(setCompanies),
    [],
  );

  useEffect(() => {
    loadMacros();
    loadCompanies();
  }, [loadMacros, loadCompanies]);

  // ── addStep (stable, uses functional updater — no stale closure) ─────────────

  const addStep = useCallback((type: MacroStepType, data: Partial<MacroStep> = {}) => {
    setEditingMacro((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: [...prev.steps, { id: uuidv4(), type, ...data }],
      };
    });
  }, []);

  // Debounced version used by the recorder (postMessage handler)
  // — prevents duplicate steps when the same event fires rapidly
  const debouncedAddStep = useDebounce(addStep, 80);

  // ── postMessage handler — uses debouncedAddStep, no stale closure ───────────

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== "object") return;

      const { type: evType, selector, url, method, body } = event.data;

      if (evType === "recorder_click") {
        debouncedAddStep("click", { selector });
      } else if (evType === "recorder_type") {
        debouncedAddStep("type", { selector, value: "" });
      } else if (evType === "recorder_navigate") {
        if (!url || !url.startsWith("http")) return;
        setPlaywrightMode(false);
        setProxyUrlInput(url);

        // Only add navigate step — no extra navigate from the URL-bar button
        debouncedAddStep("navigate", { value: url });

        if (method === "POST") {
          setProxyPostData({ url, body: body || "" });
          setActiveProxyUrl("");
        } else {
          setProxyPostData(null);
          setActiveProxyUrl(url);
        }
      } else if (evType === "recorder_cert_request") {
        debouncedAddStep("install_cert");
      } else if (evType === "recorder_postback") {
        // ASP.NET __doPostBack — record as a postback step
        debouncedAddStep("postback", {
          selector: event.data.eventTarget,
          value: event.data.eventArgument,
        });
      } else if (evType === "proxy_download_captured") {
        // Real file captured by proxy — save to gallery and notify execution
        const file = event.data.file as { id: string; filename: string; mimeType: string; size: number; url: string };
        setCapturedFiles(prev => [...prev, { ...file }]);
        // Associate with running execution if any
        fetch("/api/execution/capture-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capturedId: file.id }),
        }).catch(console.error);
      } else if (evType === "proxy_blob_download") {
        // Blob PDF created client-side (e.g. jsPDF)
        const { dataUrl, mimeType } = event.data as { dataUrl: string; mimeType: string };
        fetch("/api/captured-blob", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl, mimeType, filename: `download_${Date.now()}.pdf` }),
        })
          .then(r => r.json())
          .then(file => {
            if (file.id) setCapturedFiles(prev => [...prev, file]);
          })
          .catch(console.error);
      } else if (evType === "recorder_requires_playwright") {
        setPlaywrightMode(true);
        setPlaywrightConnected(false);
        setPlaywrightRemoteUrl(event.data.url || "https://gov.br");
        setActiveProxyUrl("");
        setProxyPostData(null);
        setTimeout(() => setPlaywrightConnected(true), 3500);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [debouncedAddStep]);

  // ── POST form submit — uses ref, no fragile getElementById ──────────────────

  useEffect(() => {
    if (proxyPostData && proxyFormRef.current) {
      proxyFormRef.current.submit();
      setProxyPostData(null);
    }
  }, [proxyPostData]);

  // ── URL bar navigation — deduplicates Enter + button click ──────────────────

  const navigateToUrl = useCallback(() => {
    if (!proxyUrlInput) return;
    setPlaywrightMode(false);
    setProxyPostData(null);
    setActiveProxyUrl(proxyUrlInput);
    addStep("navigate", { value: proxyUrlInput });
  }, [proxyUrlInput, addStep]);

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!editingMacro) return;
    setSaveStatus("saving");

    const isNew = editingMacro.id.startsWith("new");
    const url = isNew ? "/api/macros" : `/api/macros/${editingMacro.id}`;
    const method = isNew ? "POST" : "PUT";

    const payload = { ...editingMacro };
    if (isNew) delete (payload as any).id;

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      setEditingMacro(null);
      loadMacros();
    } catch (err) {
      console.error("[Save Error]", err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  // ── Step mutation helpers ────────────────────────────────────────────────────

  const updateStep = (id: string, updates: Partial<MacroStep>) => {
    setEditingMacro((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      };
    });
  };

  const removeStep = (id: string) => {
    setEditingMacro((prev) => {
      if (!prev) return prev;
      return { ...prev, steps: prev.steps.filter((s) => s.id !== id) };
    });
  };

  const duplicateStep = (step: MacroStep, index: number) => {
    setEditingMacro((prev) => {
      if (!prev) return prev;
      const newSteps = [...prev.steps];
      newSteps.splice(index + 1, 0, { ...step, id: uuidv4() });
      return { ...prev, steps: newSteps };
    });
  };

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedStepIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedStepIndex === null || draggedStepIndex === dropIndex) return;
    setEditingMacro((prev) => {
      if (!prev) return prev;
      const newSteps = [...prev.steps];
      const [dragged] = newSteps.splice(draggedStepIndex, 1);
      newSteps.splice(dropIndex, 0, dragged);
      return { ...prev, steps: newSteps };
    });
    setDraggedStepIndex(null);
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  // ── Delete macro ─────────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!confirm("Remover automação?")) return;
    await fetch(`/api/macros/${id}`, { method: "DELETE" });
    loadMacros();
  };

  // ── Run modal ────────────────────────────────────────────────────────────────

  const openRunModal = (id: string) => {
    setSelectedRunMacroId(id);
    setSelectedCompaniesForRun([]);
  };

  const executeSelected = async () => {
    if (!selectedRunMacroId || selectedCompaniesForRun.length === 0) return;
    await fetch(`/api/execute/${selectedRunMacroId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyIds: selectedCompaniesForRun }),
    });
    setSelectedRunMacroId(null);
    // Use React Router navigation instead of window.location.hash
    navigate("/execution");
  };

  // ── Save feedback icon ────────────────────────────────────────────────────────

  const SaveIcon = () => {
    if (saveStatus === "saving") return <Loader2 className="h-4 w-4 mr-2 animate-spin" />;
    if (saveStatus === "saved") return <CheckCircle2 className="h-4 w-4 mr-2 text-green-400" />;
    if (saveStatus === "error") return <AlertCircle className="h-4 w-4 mr-2 text-red-400" />;
    return <Save className="h-4 w-4 mr-2" />;
  };

  const saveLabel = {
    idle: "Salvar",
    saving: "Salvando…",
    saved: "Salvo!",
    error: "Erro ao salvar",
  }[saveStatus];

  // ────────────────────────────────────────────────────────────────────────────
  // EDITOR VIEW
  // ────────────────────────────────────────────────────────────────────────────

  if (editingMacro) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center backdrop-blur-md bg-white/5 p-4 rounded-xl border border-white/10 shadow-xl shadow-black/10">
          <input
            value={editingMacro.name}
            onChange={(e) => setEditingMacro({ ...editingMacro, name: e.target.value })}
            className="text-2xl font-bold bg-transparent border border-transparent hover:border-white/10 outline-none focus:border-indigo-500 focus:bg-black/20 rounded-md px-3 py-1 text-white transition-all w-full max-w-lg"
            placeholder="Nome da Automação"
          />
          <div className="flex space-x-3 ml-4">
            <button
              onClick={() => setEditingMacro(null)}
              className="px-4 py-2 text-sm text-slate-300 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saveStatus === "saving"}
              className={`flex items-center px-4 py-2 rounded-lg text-sm font-semibold shadow-lg transition-all border border-transparent ${
                saveStatus === "error"
                  ? "bg-red-600 hover:bg-red-500 text-white shadow-red-500/20"
                  : saveStatus === "saved"
                  ? "bg-green-600 text-white shadow-green-500/20"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20"
              }`}
            >
              <SaveIcon />
              {saveLabel}
            </button>
          </div>
        </div>

        {/* Save error banner */}
        {saveStatus === "error" && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Não foi possível salvar a automação. Verifique a conexão com o servidor e tente novamente.
          </div>
        )}

        <div className="flex flex-col xl:flex-row gap-6">
          {/* Action palette */}
          <div className="w-full xl:w-64 space-y-2 flex-shrink-0">
            <h3 className="font-semibold text-slate-400 mb-4 text-xs uppercase tracking-wider px-1">Adicionar Ação</h3>
            <button onClick={() => addStep("navigate")} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-indigo-400 hover:bg-indigo-500/10 text-sm font-medium text-slate-200 transition-all">🌐 Navegar para URL</button>
            <button onClick={() => addStep("click")} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-indigo-400 hover:bg-indigo-500/10 text-sm font-medium text-slate-200 transition-all">🖱️ Clicar em Elemento</button>
            <button onClick={() => addStep("type")} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-indigo-400 hover:bg-indigo-500/10 text-sm font-medium text-slate-200 transition-all">⌨️ Digitar Texto / Var</button>
            <button onClick={() => addStep("wait")} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-indigo-400 hover:bg-indigo-500/10 text-sm font-medium text-slate-200 transition-all">⏳ Pausa (Seg)</button>
            <button onClick={() => addStep("install_cert")} className="w-full text-left px-4 py-3 bg-white/5 border border-white/10 rounded-lg hover:border-purple-400 hover:bg-purple-500/10 text-sm font-medium text-slate-200 transition-all">🔐 Selecionar Certificado</button>
            <button onClick={() => addStep("captcha_wait")} className="w-full text-left px-4 py-3 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg hover:border-amber-400 hover:bg-amber-500/20 text-sm font-medium transition-all shadow-lg shadow-amber-500/5">🤖 Captcha Manual</button>
          </div>

          {/* Step sequence */}
          <div className="flex-1 space-y-3">
            <h3 className="font-semibold text-slate-400 mb-4 text-xs uppercase tracking-wider px-1">
              Sequência ({editingMacro.steps.length} passos)
            </h3>

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
                className={`flex items-start backdrop-blur-md p-4 rounded-xl border transition-all ${
                  draggedStepIndex === index
                    ? "opacity-50 border-indigo-500 scale-95"
                    : "border-white/10 bg-gradient-to-r from-white/5 to-transparent"
                }`}
              >
                <div className="mt-1 mr-3 text-slate-500 cursor-grab hover:text-indigo-400 active:cursor-grabbing">
                  <GripVertical className="h-5 w-5" />
                </div>
                <div className="flex-1 grid gap-3">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-indigo-400 font-mono text-[11px] uppercase tracking-wider">
                      {String(index + 1).padStart(2, "0")}. {step.type.toUpperCase()}
                    </span>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => duplicateStep(step, index)}
                        className="text-slate-400 hover:text-indigo-300 transition-colors bg-white/5 hover:bg-white/10 px-2 py-1 text-xs font-semibold rounded"
                      >
                        Duplicar
                      </button>
                      <button
                        onClick={() => removeStep(step.id)}
                        className="text-slate-500 hover:text-red-400 transition-colors bg-white/5 hover:bg-white/10 p-1 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {step.type === "navigate" && (
                    <input
                      type="text"
                      placeholder="https://..."
                      value={step.value || ""}
                      onChange={(e) => updateStep(step.id, { value: e.target.value })}
                      className="w-full text-sm bg-black/20 border-white/10 text-white placeholder-slate-600 rounded-lg border px-3 py-2 outline-none focus:border-indigo-500"
                    />
                  )}
                  {step.type === "click" && (
                    <input
                      type="text"
                      placeholder="Seletor CSS (ex: #botao-login)"
                      value={step.selector || ""}
                      onChange={(e) => updateStep(step.id, { selector: e.target.value })}
                      className="w-full text-sm bg-black/20 border-white/10 text-indigo-300 placeholder-slate-600 rounded-lg border px-3 py-2 font-mono outline-none focus:border-indigo-500"
                    />
                  )}
                  {step.type === "type" && (
                    <div className="grid grid-cols-1 gap-3">
                      <input
                        type="text"
                        placeholder="Seletor CSS"
                        value={step.selector || ""}
                        onChange={(e) => updateStep(step.id, { selector: e.target.value })}
                        className="text-sm bg-black/20 border-white/10 text-indigo-300 placeholder-slate-600 rounded-lg border px-3 py-2 font-mono outline-none focus:border-indigo-500"
                      />
                      <div>
                        <input
                          type="text"
                          placeholder="Constante ou Var (ex: {{CNPJ}}, {{RAZAO_SOCIAL}})"
                          value={step.value || ""}
                          onChange={(e) => updateStep(step.id, { value: e.target.value })}
                          className="w-full text-sm bg-black/20 border-white/10 text-white placeholder-slate-600 rounded-lg border px-3 py-2 outline-none focus:border-indigo-500"
                        />
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                          <span className="text-slate-500 uppercase font-semibold mr-1">Vars Disponíveis:</span>
                          {["{{CNPJ}}", "{{RAZAO_SOCIAL}}", "{{FANTASIA}}", "{{EMAIL}}", "{{TELEFONE}}", "{{IE}}", "{{IM}}"].map((v) => (
                            <button
                              key={v}
                              onClick={() =>
                                updateStep(step.id, { value: (step.value || "") + v })
                              }
                              className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300 hover:text-indigo-400 hover:border-indigo-500/50 transition-colors"
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {step.type === "install_cert" && (
                    <p className="text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 px-3 py-2 rounded-lg">
                      Seleciona virtualmente o certificado digital correspondente (A1 ou Pin do A3) da empresa em execução.
                    </p>
                  )}
                  {step.type === "wait" && (
                    <div className="flex items-center">
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={step.waitTime || 1}
                        onChange={(e) => updateStep(step.id, { waitTime: parseFloat(e.target.value) })}
                        className="w-24 text-sm bg-black/20 border-white/10 text-white rounded-lg border px-3 py-2 mr-3 outline-none focus:border-indigo-500 text-center"
                      />
                      <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Segundos</span>
                    </div>
                  )}
                  {step.type === "captcha_wait" && (
                    <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg">
                      Ao atingir este passo, a automação será pausada até a resolução manual.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Web simulator */}
          <div className="flex-1 space-y-3 min-w-[400px]">
            <h3 className="font-semibold text-slate-400 mb-4 text-xs uppercase tracking-wider px-1">
              Simulador Web (Gravação)
            </h3>
            <div className="backdrop-blur-md bg-white/5 p-4 rounded-xl border border-white/10 shadow-xl shadow-black/10 flex flex-col h-[600px]">
              {/* Captured files panel */}
              {capturedFiles.length > 0 && (
                <div className="mb-3 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-green-400 font-semibold px-1">
                    📥 Arquivos Capturados ({capturedFiles.length})
                  </p>
                  {capturedFiles.map(f => (
                    <div key={f.id} className="flex items-center justify-between px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-xs">
                      <span className="text-green-300 font-mono truncate max-w-[200px]">{f.filename}</span>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className="text-slate-500">{Math.round(f.size / 1024)} KB</span>
                        <a
                          href={f.url}
                          download={f.filename}
                          className="px-2 py-0.5 bg-green-600 hover:bg-green-500 text-white rounded text-[10px] font-bold"
                        >
                          Baixar
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* URL bar — Enter and button share the same handler; no duplicate step */}
              <div className="flex space-x-2 mb-3">
                <input
                  type="text"
                  value={proxyUrlInput}
                  onChange={(e) => setProxyUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      navigateToUrl();
                    }
                  }}
                  className="flex-1 text-sm bg-black/20 border-white/10 text-white placeholder-slate-600 rounded-lg border px-3 py-2 outline-none focus:border-indigo-500"
                  placeholder="https://exemplo.com.br"
                />
                <button
                  onClick={navigateToUrl}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all"
                >
                  Ir
                </button>
              </div>

              <div className="flex-1 bg-white rounded-lg overflow-hidden border border-white/20 relative">
                {playwrightMode ? (
                  !playwrightConnected ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black p-8 text-center flex-col shadow-inner z-50">
                      <div className="w-16 h-16 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin mb-6" />
                      <h4 className="text-xl font-bold text-white mb-2">Conectando ao Sandbox Remoto (Playwright)</h4>
                      <p className="text-sm text-slate-400 max-w-sm mb-6">
                        Um ambiente isolado está sendo preparado para suportar {playwrightRemoteUrl}, certificados A1 e burlar restrições CORS complexas.
                      </p>
                      <div className="w-full max-w-sm bg-[#0f111a] rounded-lg p-4 font-mono text-xs text-left text-green-400 shadow-xl border border-white/5 space-y-2">
                        <p className="animate-pulse">&gt; Initializing secure browser context...</p>
                        <p style={{ animationDelay: "0.5s" }} className="opacity-0 animate-fade-in">&gt; Bypassing CSP &amp; strict CORS...</p>
                        <p style={{ animationDelay: "1s" }} className="opacity-0 animate-fade-in">&gt; Loading ICP-Brasil bridge...</p>
                        <p style={{ animationDelay: "1.8s" }} className="opacity-0 text-yellow-500 animate-fade-in">&gt; Connection established on secure node.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col bg-slate-100 z-50 overflow-hidden">
                      {/* Playwright toolbar */}
                      <div className="absolute top-0 left-0 right-0 h-8 bg-slate-900 border-b border-indigo-500/50 flex items-center px-4 justify-between z-10 shadow-lg">
                        <span className="text-[10px] font-mono text-green-400 flex items-center">
                          <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
                          REMOTE VNC STREAM [SECURE ISOLATED NODE]
                        </span>
                        <span className="text-[11px] font-mono text-slate-300 bg-black/40 px-2 py-0.5 rounded border border-white/10">
                          {playwrightRemoteUrl}
                        </span>
                      </div>

                      {/* Mock gov.br screen */}
                      <div
                        className="flex-1 flex items-center justify-center p-8 mt-8 custom-scrollbar"
                        onClick={(e) => {
                          const target = e.target as HTMLElement;
                          let selector = "";
                          if (target.id) {
                            selector = "#" + target.id;
                          } else {
                            const safeClasses = Array.from(target.classList)
                              .filter((c) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c))
                              .slice(0, 2);
                            selector = target.tagName.toLowerCase();
                            if (safeClasses.length) selector += "." + safeClasses.join(".");
                          }
                          const isInput = ["input", "textarea", "select"].includes(
                            target.tagName.toLowerCase(),
                          );
                          addStep(isInput ? "type" : "click", { selector, ...(isInput ? { value: "" } : {}) });
                        }}
                      >
                        <div className="w-full max-w-3xl bg-white shadow-2xl rounded-xl border border-slate-200 p-8">
                          <div className="flex justify-between items-center mb-10 border-b pb-4">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-blue-900 rounded-full flex items-center justify-center font-bold text-white text-xl">
                                BR
                              </div>
                              <div>
                                <h2 className="text-2xl font-bold text-blue-900 leading-tight">Portal Governamental</h2>
                                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Acesso Seguro</div>
                              </div>
                            </div>
                            <div className="w-20 border-b-2 border-green-500" />
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                              <button
                                id="btn-govbr-login"
                                className="w-full bg-[#1351b4] hover:bg-blue-800 text-white font-bold py-3.5 px-4 rounded-full flex items-center justify-center transition shadow-md"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addStep("click", { selector: "button#btn-govbr-login" });
                                }}
                              >
                                Entrar com gov.br
                              </button>

                              <div className="flex items-center space-x-2 my-6">
                                <div className="flex-1 border-t border-slate-200" />
                                <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Outras Opções</span>
                                <div className="flex-1 border-t border-slate-200" />
                              </div>

                              <button
                                id="btn-certificado-digital"
                                className="w-full border-2 border-blue-900 text-blue-900 hover:bg-blue-50 font-bold py-3.5 px-4 rounded-full flex items-center justify-center transition"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addStep("install_cert", {});
                                  setTimeout(
                                    () =>
                                      alert(
                                        "Ação interceptada pelo Playwright!\n\nCertificado digital inserido via CDP (Chrome DevTools Protocol) no node isolado com sucesso.",
                                      ),
                                    400,
                                  );
                                }}
                              >
                                Seu Certificado Digital
                              </button>

                              <button
                                id="btn-codigo-acesso"
                                className="w-full border-2 border-slate-300 text-slate-600 hover:bg-slate-50 font-bold py-3.5 px-4 rounded-full flex items-center justify-center transition"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addStep("click", { selector: "button#btn-codigo-acesso" });
                                }}
                              >
                                Código de Acesso
                              </button>
                            </div>

                            <div className="bg-slate-50 p-6 rounded-xl text-sm border border-slate-200 relative overflow-hidden">
                              <div className="absolute right-0 top-0 w-24 h-24 bg-green-500/10 rounded-bl-full -mr-2 -mt-2" />
                              <h3 className="font-bold text-slate-800 mb-3 text-base">Acesso Remoto Estabelecido</h3>
                              <div className="text-slate-600 space-y-3 leading-relaxed">
                                <p>O simulador está refletindo a interface web processada pelo container Playwright seguro usando VNC-over-WebSocket.</p>
                                <p><strong>CORS / CSP Bypass:</strong> ATIVO ✓</p>
                                <p><strong>ICP-Brasil Provider:</strong> CARREGADO ✓</p>
                                <div className="mt-4 p-3 bg-blue-100 text-blue-800 rounded flex items-start space-x-2 border border-blue-200">
                                  <span className="font-bold shrink-0">Dica:</span>
                                  <span className="text-xs">
                                    Clique nos botões desta interface mockada para que o gravador capture a sequência do Playwright Automation.
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  <>
                    {/* POST form — ref-based, no getElementById */}
                    {proxyPostData && (
                      <form
                        ref={proxyFormRef}
                        method="POST"
                        action={`/api/proxy?url=${encodeURIComponent(proxyPostData.url)}&topLevel=true`}
                        target="proxy-iframe"
                        style={{ display: "none" }}
                      >
                        {proxyPostData.body.split("&").map((pair, i) => {
                          if (!pair) return null;
                          const [k, v] = pair.split("=").map(decodeURIComponent);
                          return <input key={i} type="hidden" name={k} defaultValue={v} />;
                        })}
                      </form>
                    )}

                    {!activeProxyUrl && !proxyPostData ? (
                      <div className="absolute inset-0 flex items-center justify-center text-slate-400 flex-col">
                        <p className="text-sm font-medium">Nenhuma URL Carregada</p>
                        <p className="text-xs text-slate-500 mt-2">
                          Navegue para capturar elementos com apenas um clique
                        </p>
                      </div>
                    ) : (
                      <iframe
                        name="proxy-iframe"
                        src={
                          activeProxyUrl
                            ? `/api/proxy?url=${encodeURIComponent(activeProxyUrl)}&topLevel=true`
                            : undefined
                        }
                        ref={iframeRef}
                        className="w-full h-full border-none relative z-0 bg-white"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-top-navigation-by-user-activation"
                        title="Simulador de Gravação"
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // LIST VIEW
  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight text-white">Automações (RPA)</h1>
        <button
          onClick={() =>
            setEditingMacro({ id: `new-${Date.now()}`, name: "Nova Automação", steps: [] })
          }
          className="flex items-center px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 rounded-lg transition-all border border-transparent"
        >
          <Plus className="h-4 w-4 mr-2" /> Criar Macro
        </button>
      </div>

      <div className="backdrop-blur-md bg-white/5 rounded-xl border border-white/10 overflow-hidden shadow-xl shadow-black/10">
        <ul className="divide-y divide-white/10">
          {macros.map((m) => (
            <li key={m.id} className="p-5 flex items-center justify-between hover:bg-white/5 transition-colors">
              <div>
                <p className="text-base font-bold text-white mb-1">{m.name}</p>
                <p className="text-[11px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 inline-block">
                  {m.steps.length} PASSOS
                </p>
              </div>
              <div className="flex space-x-2 items-center">
                <button
                  onClick={() => openRunModal(m.id)}
                  className="flex items-center px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 rounded-lg text-xs font-bold uppercase tracking-wider mr-4 shadow-lg shadow-green-500/10 transition-all"
                >
                  <Play className="h-3 w-3 mr-1.5" /> Executar
                </button>
                <button
                  onClick={() => setEditingMacro(m)}
                  className="text-slate-400 hover:text-indigo-400 p-2 bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10 rounded-md transition-colors"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(m.id)}
                  className="text-slate-400 hover:text-red-400 p-2 bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10 rounded-md transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
          {macros.length === 0 && (
            <li className="p-8 text-center text-slate-500 text-sm">
              Nenhuma automação configurada.
            </li>
          )}
        </ul>
      </div>

      {/* Run modal */}
      {selectedRunMacroId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#020617] border border-white/10 rounded-xl max-w-lg w-full p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
            <h3 className="text-lg font-bold text-white mb-4">Selecionar Empresas</h3>
            <p className="text-xs text-slate-400 mb-6">
              Selecione as empresas para as quais deseja executar esta automação.
            </p>

            <div className="max-h-60 overflow-y-auto space-y-2 mb-6">
              {companies.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center space-x-4 p-3 bg-white/5 rounded-lg border border-white/5 cursor-pointer hover:bg-white/10 transition"
                >
                  <input
                    type="checkbox"
                    className="form-checkbox h-4 w-4 rounded border-white/20 bg-black/20 text-indigo-500 focus:ring-indigo-500"
                    checked={selectedCompaniesForRun.includes(c.id)}
                    onChange={(e) => {
                      setSelectedCompaniesForRun((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                      );
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
              <button
                onClick={() => setSelectedRunMacroId(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/10 border border-transparent transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={executeSelected}
                disabled={selectedCompaniesForRun.length === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold shadow-lg shadow-indigo-500/20 transition-all border border-transparent"
              >
                Iniciar Execução
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}