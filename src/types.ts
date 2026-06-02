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
  titular: string;
  cpfCnpj: string;
  serial: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  type: 'PF' | 'PJ';
}

export type MacroStepType = 'navigate' | 'click' | 'type' | 'wait' | 'captcha_wait';

export interface MacroStep {
  id: string;
  type: MacroStepType;
  selector?: string;
  value?: string;
  waitTime?: number;
}

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
}
