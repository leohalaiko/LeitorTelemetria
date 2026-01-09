// src/utils/processors.ts
import { parseWlnContent, type WlnRecord } from './wlnParser';

// --- AUXILIARES ---
const formatUnixDate = (timestamp: any) => {
    if (!timestamp || timestamp == 0) return '-';
    try {
        const timeVal = String(timestamp).length > 11 ? Number(timestamp) : Number(timestamp) * 1000;
        return new Date(timeVal).toLocaleString('pt-BR');
    } catch (e) {
        return String(timestamp);
    }
};

const calculateVolume = (final: any, start: any) => {
    const vol = (Number(final) - Number(start)) * 0.1;
    return isNaN(vol) ? 0 : Number(vol.toFixed(2));
};

// --- FUNÇÃO 1: PROCESSADOR EXCLUSIVO WLN ---
export const processWlnFile = (file: File): Promise<WlnRecord[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const text = e.target?.result;
            if (typeof text === 'string') {
                const data = parseWlnContent(text);
                resolve(data);
            } else {
                reject(new Error("Falha ao ler o conteúdo do arquivo WLN."));
            }
        };

        reader.onerror = () => {
            reject(new Error("Erro de leitura de arquivo."));
        };

        reader.readAsText(file);
    });
};

// --- FUNÇÃO 2: PROCESSADOR GERAL ---
export const processLogFile = (data: any[], mode: string, extraParams: any = {}) => {
    switch (mode) {
        case 'normal':
            return processNormalSupply(data);
        case 'travado':
            return processLockedID(data, extraParams.startId || 0);
        case 'erro':
            return processFrameError(data);
        default:
            return data;
    }
};

// --- SUB-FUNÇÕES DE LÓGICA DE NEGÓCIO ---

// 1. LÓGICA: ABASTECIMENTO NORMAL
const processNormalSupply = (data: any[]) => {
    const result: any[] = [];
    const processedSignatures = new Set();

    data.forEach((row) => {
        if (row.upar0 && row.upar6 && row.upar4) {
            const vol = calculateVolume(row.upar6, row.upar4);
            const signature = `${row.upar3}-${row.upar4}`;

            if (vol > 0.5 && !processedSignatures.has(signature)) {
                processedSignatures.add(signature);

                // Normaliza o timestamp para Milissegundos (igual ao formatUnixDate)
                const rawTs = Number(row.upar3);
                const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;

                result.push({
                    'originalTimestamp': timeMs, // <--- 1. ADICIONADO AQUI
                    'Data': formatUnixDate(row.upar3),
                    'ID Operação': row.upar0,
                    'Veículo (Cartão)': row.upar1,
                    'Frentista': row.upar2,
                    'Volume (L)': vol,
                    'Encerrante Inicial': row.upar4,
                    'Encerrante Final': row.upar6,
                    'Odômetro': row.upar10 || '-',
                    'Tipo': row.upar7 === '3' ? 'Comboio' : 'Padrão'
                });
            }
        }
    });
    return result;
};

// 2. LÓGICA: ID TRAVADO
const processLockedID = (data: any[], startIdInput: number) => {
    const uniqueSupplies: any[] = [];
    const processedSignatures = new Set();
    let currentIdCounter = Number(startIdInput);

    data.forEach(row => {
        const vol = calculateVolume(row.upar6, row.upar4);
        const signature = `${row.upar3}-${row.upar4}`;

        if (vol > 0.5 && !processedSignatures.has(signature)) {
            processedSignatures.add(signature);
            uniqueSupplies.push({ row, vol });
        }
    });

    uniqueSupplies.sort((a, b) => Number(a.row.upar3) - Number(b.row.upar3));

    return uniqueSupplies.map(item => {
        currentIdCounter++;

        // Normaliza o timestamp para Milissegundos
        const rawTs = Number(item.row.upar3);
        const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;

        return {
            'originalTimestamp': timeMs, // <--- 2. ADICIONADO AQUI
            'ID Gerado (Corrigido)': currentIdCounter,
            'ID Original (Travado)': item.row.upar0,
            'Data Inicial': formatUnixDate(item.row.upar3),
            'Data Final': formatUnixDate(item.row.upar5),
            'Veículo': item.row.upar1,
            'Volume (L)': item.vol,
            'Encerrante Inicial': item.row.upar4,
            'Encerrante Final': item.row.upar6,
            'Status': 'Recuperado'
        };
    });
};

// --- Helper para preparar os dados para o App.tsx ---
export const formatForExcel = (data: any[]) => {
    // 1. Ordena cronologicamente
    const sortedData = [...data].sort((a, b) => {
        const timeA = a.originalTimestamp || 0;
        const timeB = b.originalTimestamp || 0;
        return timeA - timeB;
    });

    // 2. Retorna os dados normalizados com o AJUSTE DO "0" EXTRA
    return sortedData.map((item) => {
        let dateObj = new Date();
        if (item.originalTimestamp) {
            dateObj = new Date(item.originalTimestamp);
        }

        const horaInicio = dateObj.toLocaleTimeString('pt-BR', { hour12: false });

        const horaFim = item['Data Final']
            ? new Date(item['Data Final']).toLocaleTimeString('pt-BR', { hour12: false })
            : horaInicio;

        // AJUSTE SOLICITADO: Multiplicar por 10 para adicionar a casa decimal "0"
        const encInicial = Number(item['Encerrante Inicial'] || 0);
        const encFinal = Number(item['Encerrante Final'] || 0);

        return {
            raw: item,
            bomba: 'S10',
            horaInicio: horaInicio,
            horaFim: horaFim,
            medidorInicial: encInicial * 10, // <--- Adiciona o "0"
            medidorFinal: encFinal * 10,     // <--- Adiciona o "0"
            placa: item['Veículo (Cartão)'] || item['Veículo'] || '',
            id: item['ID Operação'] || item['ID Original (Travado)'] || '',
            frentista: item['Frentista'] || '',
            odometro: item['Odômetro'] !== '-' ? Number(item['Odômetro']) : ''
        };
    });
};



// 3. LÓGICA: IDENTIFICADOR DE ERRO
const processFrameError = (data: any[]) => {
    const result: any[] = [];

    data.forEach((row, index) => {
        let errosEncontrados = [];

        const pwrExt = Number(row.pwr_ext);
        const pwrInt = Number(row.pwr_int);

        if (row.pwr_ext && pwrExt < 10) errosEncontrados.push(`Tensão Ext Baixa (${pwrExt}V)`);
        if (row.pwr_int && pwrInt < 2) errosEncontrados.push(`Bateria Int Baixa (${pwrInt}V)`);

        if (row.upar4 == 0) errosEncontrados.push("Encerrante Inicial Zerado (upar4=0)");
        if (row.upar6 == 0) errosEncontrados.push("Encerrante Final Zerado (upar6=0)");

        const encInicial = Number(row.upar4);
        const encFinal = Number(row.upar6);

        if (encInicial > 0 && encFinal > 0) {
            if (encFinal <= encInicial) {
                errosEncontrados.push(`Não Evoluiu (Vol: ${(encFinal-encInicial).toFixed(1)})`);
            }
        }

        if (errosEncontrados.length > 0) {
            result.push({
                'Linha Arquivo': index + 2,
                'Data': formatUnixDate(row.upar3),
                'Erros Detectados': errosEncontrados.join(', '),
                'Dados Brutos': `Ext:${pwrExt}V | Upar4:${encInicial} | Upar6:${encFinal}`
            });
        }
    });
    return result;
};