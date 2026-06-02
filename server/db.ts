import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');

export interface Company {
  id: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  inscricaoEstadual: string;
  inscricaoMunicipal: string;
  email: string;
  telefone: string;
  observacoes: string;
  certificadoPrincipalId?: string;
  certificadosAlternativosIds: string[];
}

export interface Certificate {
  id: string;
  filename: string;
  // In a real app we'd keep the actual content securely encrypted
  passwordEncrypted: string; 
  titular: string;
  cpfCnpj: string;
  serial: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  type: 'PF' | 'PJ';
}

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
}

export type MacroStepType = 'navigate' | 'click' | 'type' | 'wait' | 'captcha_wait';

export interface MacroStep {
  id: string;
  type: MacroStepType;
  selector?: string;
  value?: string; // used for 'type' or url for 'navigate' or field map for 'type'
  waitTime?: number;
}

export interface DBSchema {
  companies: Company[];
  certificates: Certificate[];
  macros: Macro[];
}

const defaultDB: DBSchema = {
  companies: [],
  certificates: [],
  macros: []
};

// Initialize DB
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify(defaultDB, null, 2), 'utf-8');
}

function readDB(): DBSchema {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading DB:", error);
    return defaultDB;
  }
}

function writeDB(data: DBSchema) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export const db = {
  getCompanies: () => readDB().companies,
  addCompany: (c: Company) => {
    const data = readDB();
    data.companies.push(c);
    writeDB(data);
  },
  updateCompany: (id: string, c: Partial<Company>) => {
    const data = readDB();
    const index = data.companies.findIndex(xc => xc.id === id);
    if (index > -1) {
      data.companies[index] = { ...data.companies[index], ...c };
      writeDB(data);
    }
  },
  deleteCompany: (id: string) => {
    const data = readDB();
    data.companies = data.companies.filter(c => c.id !== id);
    writeDB(data);
  },

  getCertificates: () => readDB().certificates,
  addCertificate: (cert: Certificate) => {
    const data = readDB();
    data.certificates.push(cert);
    writeDB(data);
  },
  deleteCertificate: (id: string) => {
    const data = readDB();
    data.certificates = data.certificates.filter(c => c.id !== id);
    writeDB(data);
  },

  getMacros: () => readDB().macros,
  getMacro: (id: string) => readDB().macros.find(m => m.id === id),
  addMacro: (m: Macro) => {
    const data = readDB();
    data.macros.push(m);
    writeDB(data);
  },
  updateMacro: (id: string, m: Partial<Macro>) => {
    const data = readDB();
    const index = data.macros.findIndex(xm => xm.id === id);
    if (index > -1) {
      data.macros[index] = { ...data.macros[index], ...m };
      writeDB(data);
    }
  },
  deleteMacro: (id: string) => {
    const data = readDB();
    data.macros = data.macros.filter(c => c.id !== id);
    writeDB(data);
  }
};
