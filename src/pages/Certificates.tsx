import React from "react";
import { useEffect, useState } from "react";
import { Certificate } from "@/types";
import { Upload, Trash2, KeyRound } from "lucide-react";
import { parseISO } from "date-fns";

export default function Certificates() {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loadCerts = () => {
    fetch("/api/certificates").then(r => r.json()).then(setCertificates).catch(console.error);
  }

  useEffect(() => {
    loadCerts();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !password) return;

    setIsUploading(true);
    setError("");

    const formData = new FormData();
    formData.append("pfx", selectedFile);
    formData.append("password", password);

    try {
      const res = await fetch("/api/certificates/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro no upload");
      }

      setSelectedFile(null);
      setPassword("");
      loadCerts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover este certificado?")) return;
    await fetch(`/api/certificates/${id}`, { method: "DELETE" });
    loadCerts();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-white">Certificados A1 (.pfx)</h1>

      <div className="backdrop-blur-md bg-white/5 p-6 rounded-xl border border-white/10 shadow-xl shadow-black/10">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-6 flex items-center">
          <Upload className="h-4 w-4 mr-2 text-indigo-400" /> Upload de Certificado
        </h2>
        
        {error && <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm">{error}</div>}
        
        <form onSubmit={handleUpload} className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Arquivo .PFX</label>
            <input 
              type="file" 
              accept=".pfx,.p12"
              required
              onChange={e => setSelectedFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-xs file:font-bold file:uppercase file:tracking-wider
                file:bg-indigo-500/20 file:text-indigo-400 file:border file:border-indigo-500/30
                hover:file:bg-indigo-500/30 border border-white/10 bg-black/20 rounded-md py-1.5 px-2 outline-none
              "
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Senha</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="block w-full rounded-md bg-black/20 border border-white/10 text-white placeholder-slate-500 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              placeholder="Senha do certificado"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={isUploading || !selectedFile || !password}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-lg shadow-indigo-500/20 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-indigo-500 disabled:opacity-50 transition-all"
            >
              {isUploading ? "Processando..." : "Validar e Salvar"}
            </button>
          </div>
        </form>
      </div>

      <div className="backdrop-blur-md bg-white/5 rounded-xl border border-white/10 overflow-hidden shadow-xl shadow-black/10">
        <div className="px-6 py-4 border-b border-white/10 bg-white/5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Certificados Cadastrados</h3>
        </div>
        <ul className="divide-y divide-white/10">
          {certificates.length === 0 ? (
            <li className="p-8 text-center text-slate-500 text-sm">Nenhum certificado cadastrado.</li>
          ) : (
            certificates.map((cert) => (
              <li key={cert.id} className="p-5 sm:p-6 flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-start flex-1 min-w-0">
                  <div className="p-2 bg-green-500/10 border border-green-500/20 rounded mr-4 mt-1">
                    <KeyRound className="h-5 w-5 text-green-400" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
                    <div>
                      <p className="text-sm font-bold text-white truncate">{cert.titular}</p>
                      <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-wider">CPF/CNPJ: <span className="text-slate-300">{cert.cpfCnpj}</span> ({cert.type})</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 uppercase tracking-wider">Série: <span className="text-slate-300 font-mono">{cert.serial}</span></p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400 uppercase tracking-wider">Arquivo: <span className="text-slate-300 normal-case">{cert.filename}</span></p>
                      <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-wider">Validade: <span className="text-slate-300">{parseISO(cert.validFrom).toLocaleDateString()}</span> a <span className="font-bold text-red-400">{parseISO(cert.validTo).toLocaleDateString()}</span></p>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate uppercase tracking-wider">Emissor: <span className="text-slate-300 normal-case">{cert.issuer}</span></p>
                    </div>
                  </div>
                </div>
                <div className="ml-4 flex-shrink-0">
                  <button type="button" onClick={() => handleDelete(cert.id)} className="text-slate-500 hover:text-red-400 p-2 bg-white/5 hover:bg-white/10 rounded border border-white/5 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
