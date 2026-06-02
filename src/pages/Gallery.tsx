import { useEffect, useState } from "react";
import { DownloadedFile, Company, Macro } from "@/types";
import { Download, Search, FileSymlink, Calendar, FileBox, Filter, HardDriveDownload } from "lucide-react";

export default function Gallery() {
  const [files, setFiles] = useState<DownloadedFile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);

  const [filterCompany, setFilterCompany] = useState("");
  const [filterMacro, setFilterMacro] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = async () => {
    const [resFiles, resCompanies, resMacros] = await Promise.all([
      fetch("/api/files").then(r => r.json()),
      fetch("/api/companies").then(r => r.json()),
      fetch("/api/macros").then(r => r.json())
    ]);
    
    // Auto-generate some dummy files if completely empty for demonstration
    if (resFiles.length === 0) {
      const dummyFiles = [
         { id: "1", filename: "relatorio_mensal.pdf", size: 1024 * 1024 * 2.5, createdAt: new Date().toISOString(), companyId: resCompanies[0]?.id, macroId: resMacros[0]?.id },
         { id: "2", filename: "das_competencia.pdf", size: 1024 * 512, createdAt: new Date(Date.now() - 86400000).toISOString(), companyId: resCompanies[0]?.id, macroId: resMacros[0]?.id },
         { id: "3", filename: "planilha_fechamento.xlsx", size: 1024 * 1024 * 1.2, createdAt: new Date(Date.now() - 86400000 * 2).toISOString() }
      ];
      setFiles(dummyFiles as any);
    } else {
      setFiles(resFiles);
    }
    
    setCompanies(resCompanies);
    setMacros(resMacros);
  };

  useEffect(() => {
    loadData();
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getCompanyInfo = (companyId?: string) => {
    const c = companies.find(c => c.id === companyId);
    return c ? `${c.razaoSocial}` : 'Desconhecida';
  };

  const getMacroInfo = (macroId?: string) => {
    const m = macros.find(m => m.id === macroId);
    return m ? m.name : 'Desconhecida';
  };

  const filteredFiles = files.filter(f => {
    const matchCompany = filterCompany ? f.companyId === filterCompany : true;
    const matchMacro = filterMacro ? f.macroId === filterMacro : true;
    const matchDate = filterDate ? new Date(f.createdAt).toISOString().split('T')[0] === filterDate : true;
    const matchSearch = filterDate ? true : true; // handled below
    const searchLow = searchQuery.toLowerCase();
    const matchText = f.filename.toLowerCase().includes(searchLow) || getCompanyInfo(f.companyId).toLowerCase().includes(searchLow);
    
    return matchCompany && matchMacro && matchDate && matchText;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto text-white">
      <div className="mb-8">
        <h1 className="text-3xl font-bold font-sans tracking-tight mb-2">Galeria de Arquivos</h1>
        <p className="text-slate-400">Gerencie e visualize arquivos e relatórios baixados pelas automações.</p>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 shadow-lg flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
           <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Buscar Arquivo</label>
           <div className="relative">
             <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
             <input type="text" placeholder="Nome do arquivo..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-black/20 border border-white/10 rounded-lg text-sm focus:border-indigo-500 outline-none transition-colors" />
           </div>
        </div>

        <div className="w-48">
           <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Data</label>
           <div className="relative">
             <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm tracking-widest text-slate-300 focus:border-indigo-500 outline-none css-date-icon-hidden" />
           </div>
        </div>

        <div className="w-56">
           <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Empresa</label>
           <select value={filterCompany} onChange={e=>setFilterCompany(e.target.value)} className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm text-slate-300 focus:border-indigo-500 outline-none appearance-none">
              <option value="">Todas as Empresas</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
           </select>
        </div>

        <div className="w-56">
           <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Automação (RPA)</label>
           <select value={filterMacro} onChange={e=>setFilterMacro(e.target.value)} className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm text-slate-300 focus:border-indigo-500 outline-none appearance-none">
              <option value="">Todas as Automações</option>
              {macros.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
           </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredFiles.map(file => (
          <div key={file.id} className="bg-gradient-to-br from-[#1e1e2f] to-[#151522] border border-white/10 rounded-xl p-5 hover:border-indigo-500/50 transition-all group flex flex-col h-full shadow-xl">
             <div className="flex justify-between items-start mb-4">
                <div className="h-10 w-10 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                    <FileBox className="h-5 w-5" />
                </div>
                <button className="text-slate-500 hover:text-white transition-colors" title="Download">
                  <HardDriveDownload className="h-5 w-5" />
                </button>
             </div>
             
             <h3 className="font-semibold text-white truncate mb-1" title={file.filename}>{file.filename}</h3>
             
             <div className="mt-4 space-y-2 text-sm text-slate-400 font-mono">
               <div className="flex items-center">
                 <Filter className="h-3 w-3 mr-2" />
                 <span className="truncate">{formatSize(file.size)}</span>
               </div>
               <div className="flex items-center">
                 <Calendar className="h-3 w-3 mr-2 text-blue-400" />
                 <span>{formatDate(file.createdAt)}</span>
               </div>
               <div className="flex items-center">
                 <FileSymlink className="h-3 w-3 mr-2 text-emerald-400" />
                 <span className="truncate">{getMacroInfo(file.macroId)}</span>
               </div>
             </div>

             <div className="mt-auto pt-4 flex items-center border-t border-white/5">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-500 truncate">{getCompanyInfo(file.companyId)}</span>
             </div>
          </div>
        ))}
      </div>

      {filteredFiles.length === 0 && (
        <div className="text-center py-20 bg-white/5 rounded-xl border border-white/5 border-dashed">
           <FileBox className="h-10 w-10 text-slate-600 mx-auto mb-4" />
           <p className="text-slate-400">Nenhum arquivo encontrado.</p>
        </div>
      )}
    </div>
  );
}
