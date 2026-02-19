import Papa from 'papaparse';
import { parseWlnContent, type WlnRecord } from './wlnParser';

const generateUID = () => Math.random().toString(36).substring(2, 11) + Date.now().toString(36);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatUnixDate = (timestamp: any) => {
    if (!timestamp || timestamp === 0 || isNaN(Number(timestamp))) return '-';
    try {
        const timeVal = String(timestamp).length > 11 ? Number(timestamp) : Number(timestamp) * 1000;
        return new Date(timeVal).toLocaleString('pt-BR');
    } catch {
        return String(timestamp);
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const calculateVolume = (final: any, start: any) => {
    const vol = (Number(final) - Number(start)) * 0.1;
    return isNaN(vol) ? 0 : Number(vol.toFixed(2));
};

const enrichWlnData = (data: WlnRecord[]) => {
    const chronological = [...data].sort((a, b) => a.timestamp - b.timestamp);
    let lastPumpOnTs = 0;

    chronological.forEach(row => {
        const io = row['i/o'] || row['io'];
        if (typeof io === 'string') {
            if (io.includes('/e') || io.endsWith('e')) {
                lastPumpOnTs = row.timestamp;
            }
        }

        if (row.upar0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (row as any)._originalUpar3 = row.upar3 ? Number(row.upar3) : 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (row as any)._originalUpar5 = row.upar5 ? Number(row.upar5) : 0;

            if (!row.upar3 || Number(row.upar3) === 0) {
                row.upar3 = lastPumpOnTs > 0 ? lastPumpOnTs : row.timestamp - (2 * 60 * 1000);
            }
            if (!row.upar5 || Number(row.upar5) === 0) {
                row.upar5 = row.timestamp;
            }
        }
    });

    return chronological;
};

export const processWlnFile = (file: File): Promise<WlnRecord[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result;
            if (typeof text === 'string') {
                const parsed = parseWlnContent(text);
                const enriched = enrichWlnData(parsed);
                resolve(enriched);
            } else {
                reject(new Error("Falha ao ler WLN."));
            }
        };
        reader.readAsText(file);
    });
};

interface TankRecord {
    timestamp: number;
    volume: number;
    rawDate: string;
}

export const parseTankFile = (file: File): Promise<TankRecord[]> => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true, delimiter: ";", skipEmptyLines: true,
            transformHeader: (h) => h.trim().replace(/"/g, ''),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            complete: (results: any) => {
                const records: TankRecord[] = [];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                results.data.forEach((row: any) => {
                    const horaStr = row['Hora'] || row['Horário'] || row['Data'] || row['Time'];
                    const volStr = row['Estoque S10 Dura+'] || row['Tanque 1 - S10'] || row['Volume'] || row['Estoque'];
                    if (horaStr && volStr) {
                        try {
                            const parts = horaStr.split(' ');
                            if(parts.length < 2) return;
                            const [datePart, timePart] = parts;
                            const [dia, mes, ano] = datePart.split('.');
                            const isoDate = `${ano}-${mes}-${dia}T${timePart}`;
                            const ts = new Date(isoDate).getTime();

                            let cleanVolStr = String(volStr).replace(/[lL]\s*$/, '').trim();
                            cleanVolStr = cleanVolStr.replace(',', '.');
                            const volClean = parseFloat(cleanVolStr);

                            if (!isNaN(ts) && !isNaN(volClean) && volClean > 0) {
                                records.push({ timestamp: ts, volume: volClean, rawDate: horaStr });
                            }
                        } catch {
                            // ignora
                        }
                    }
                });
                records.sort((a, b) => a.timestamp - b.timestamp);
                resolve(records);
            },
            error: (err: unknown) => reject(err)
        });
    });
};

const findClosestRecord = (records: TankRecord[], targetTs: number): TankRecord | null => {
    if (records.length === 0) return null;
    return records.reduce((prev, curr) => (Math.abs(curr.timestamp - targetTs) < Math.abs(prev.timestamp - targetTs) ? curr : prev));
};

// ==========================================
// 🚀 CONCILIAÇÃO ATUALIZADA (REGRA DOS IDs DO MANGOTE PURA)
// ==========================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const reconciliateData = (wlnData: any[], tankData: TankRecord[], mode: string = 'transcricao') => {
    const processedIDs = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];

    // 1. Encontra o Maior ID do arquivo inteiro (A numeração da bomba principal)
    const validUpar0s = wlnData.map(r => Number(r.upar0)).filter(id => !isNaN(id) && id > 0);
    const maxUpar0 = validUpar0s.length > 0 ? Math.max(...validUpar0s) : 0;

    // 2. Filtra as linhas dependendo do módulo selecionado
    const validRows = wlnData.filter(row => {
        const id = Number(row.upar0);
        if (!id || isNaN(id)) return false;

        // Se o maior ID da bomba for maior que 50, consideramos "Comboio" qualquer ID menor que a metade desse valor
        const isSmallId = maxUpar0 > 50 ? (id < maxUpar0 * 0.5) : false;

        if (mode === 'comboio') {
            return isSmallId; // Pega APENAS os IDs minúsculos (Comboio)
        } else {
            return !isSmallId; // Pega APENAS os IDs normais (Bico Normal - Transcrição)
        }
    });

    validRows.forEach(row => {
        const idOperacao = String(row.upar0);
        if (processedIDs.has(idOperacao)) return;
        processedIDs.add(idOperacao);

        const startTs = String(row.upar3).length > 11 ? Number(row.upar3) : Number(row.upar3) * 1000;
        const endTs = String(row.upar5).length > 11 ? Number(row.upar5) : Number(row.upar5) * 1000;

        // Cruzamento temporal direto com o Tanque usando a própria hora da trama
        const tankStart = findClosestRecord(tankData, startTs);
        const tankEnd = findClosestRecord(tankData, endTs);

        let volumeCalculado = 0;
        if (tankStart && tankEnd) {
            volumeCalculado = tankStart.volume - tankEnd.volume;
            if (volumeCalculado < 0) volumeCalculado = 0;
        }

        results.push({
            _uid: generateUID(),
            'originalTimestamp': startTs || 0,
            'Data': formatUnixDate(row.upar3),
            'Data Final': formatUnixDate(row.upar5 || endTs/1000),
            'ID Operação': row.upar0,
            'Veículo (Cartão)': row.upar1 || '',
            'Frentista': row.upar2 || '',
            'Volume (L)': Number(volumeCalculado.toFixed(2)),
            'Encerrante Inicial Bruto': Number(row.upar4) || 0,
            'Encerrante Final Bruto': Number(row.upar6) || 0,
            'Odômetro': row.upar10 || '-',
            'Tipo': mode === 'comboio' ? 'Comboio (Mangote)' : 'Conciliado'
        });
    });

    return results.sort((a, b) => b.originalTimestamp - a.originalTimestamp);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const processLogFile = (data: any[], mode: string, extraParams: Record<string, any> = {}) => {
    switch (mode) {
        case 'normal': return processNormalSupply(data);
        case 'travado': return processLockedID(data, extraParams.startId || 0);
        case 'transcricao': return processManualTranscript(data);
        default: return data;
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processNormalSupply = (data: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = [];
    const processedSignatures = new Set();
    data.forEach((row) => {
        if (row.upar0 && row.upar6 && row.upar4) {
            const vol = calculateVolume(row.upar6, row.upar4);
            const signature = `${row.upar3}-${row.upar4}`;
            if (vol > 0.5 && !processedSignatures.has(signature)) {
                processedSignatures.add(signature);
                const rawTs = Number(row.upar3) || 0;
                const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;
                result.push({
                    _uid: generateUID(),
                    'originalTimestamp': timeMs,
                    'Data': formatUnixDate(row.upar3),
                    'Data Final': formatUnixDate(row.upar5),
                    'ID Operação': row.upar0,
                    'Veículo (Cartão)': row.upar1,
                    'Frentista': row.upar2,
                    'Volume (L)': vol,
                    'Encerrante Inicial Bruto': row.upar4,
                    'Encerrante Final Bruto': row.upar6,
                    'Odômetro': row.upar10 || '-',
                    'Tipo': 'Normal'
                });
            }
        }
    });
    return result.sort((a, b) => a.originalTimestamp - b.originalTimestamp);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processLockedID = (data: any[], startIdInput: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    uniqueSupplies.sort((a, b) => (Number(a.row.upar3) || 0) - (Number(b.row.upar3) || 0));

    const finalData = uniqueSupplies.map(item => {
        currentIdCounter++;
        const rawTs = Number(item.row.upar3) || 0;
        const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;
        return {
            _uid: generateUID(),
            'originalTimestamp': timeMs,
            'ID Gerado (Corrigido)': currentIdCounter,
            'ID Original (Travado)': item.row.upar0,
            'Data Inicial': formatUnixDate(item.row.upar3),
            'Data Final': formatUnixDate(item.row.upar5),
            'Veículo': item.row.upar1,
            'Volume (L)': item.vol,
            'Encerrante Inicial Bruto': item.row.upar4,
            'Encerrante Final Bruto': item.row.upar6,
            'Status': 'Recuperado'
        };
    });
    return finalData.sort((a, b) => a.originalTimestamp - b.originalTimestamp);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processManualTranscript = (data: any[]) => {
    const result = data.filter(row => row.upar0).map(row => {
        const rawTs = Number(row.upar3) || 0;
        const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;
        return {
            _uid: generateUID(),
            'originalTimestamp': timeMs,
            'Data': formatUnixDate(row.upar3),
            'Data Final': row.upar5 ? formatUnixDate(row.upar5) : formatUnixDate(row.upar3),
            'ID Operação': row.upar0,
            'Veículo (Cartão)': row.upar1 || '',
            'Frentista': row.upar2 || '',
            'Volume (L)': calculateVolume(row.upar6 || 0, row.upar4 || 0),
            'Encerrante Inicial Bruto': row.upar4 || 0,
            'Encerrante Final Bruto': row.upar6 || 0,
            'Odômetro': row.upar10 || '-',
            'Tipo': 'Manual'
        };
    });
    return result.sort((a, b) => b.originalTimestamp - a.originalTimestamp);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const formatForExcel = (data: any[], mode: string) => {
    const sortedData = [...data].sort((a, b) => {
        const timeA = Number(a.originalTimestamp) || 0;
        const timeB = Number(b.originalTimestamp) || 0;
        return timeA - timeB;
    });

    let medidorCorrente = 0;
    for (const item of sortedData) {
        const med = Number(item['Encerrante Inicial Bruto'] || item['Encerrante Inicial'] || 0);
        if (med > 0) { medidorCorrente = med; break; }
    }

    const mappedData = sortedData.map((item) => {
        let dateObj = new Date();
        if (item.originalTimestamp && item.originalTimestamp > 0) {
            dateObj = new Date(item.originalTimestamp);
        }

        const horaInicio = (item.originalTimestamp && item.originalTimestamp > 0)
            ? dateObj.toLocaleTimeString('pt-BR', { hour12: false })
            : '-';

        let horaFim = horaInicio;
        if (item['Data Final'] && item['Data Final'] !== '-') {
            const parts = item['Data Final'].split(' ');
            if (parts.length > 1) horaFim = parts[1];
        }

        let medidorInicialDaLinha = 0;
        let medidorFinalDaLinha = 0;

        if (mode === 'transcricao' || mode === 'comboio') {
            medidorInicialDaLinha = medidorCorrente;
            medidorCorrente += Math.round((item['Volume (L)'] || 0) * 100);
            medidorFinalDaLinha = medidorCorrente;
        } else {
            medidorInicialDaLinha = Number(item['Encerrante Inicial Bruto'] || item['Encerrante Inicial'] || 0);
            medidorFinalDaLinha = Number(item['Encerrante Final Bruto'] || item['Encerrante Final'] || 0);
        }

        return {
            _uid: item._uid,
            raw: item,
            dataStr: item['Data'] || item['Data Inicial'],
            bomba: 'S10',
            horaInicio: horaInicio,
            horaFim: horaFim,
            medidorInicial: medidorInicialDaLinha,
            medidorFinal: medidorFinalDaLinha,
            placa: item['Veículo (Cartão)'] || item['Veículo'] || '',
            id: item['ID Operação'] || item['ID Original (Travado)'] || '',
            frentista: item['Frentista'] || '',
            odometro: item['Odômetro'] !== '-' ? Number(item['Odômetro']) : '',
            volumeConciliado: item['Volume (L)'],
            originalTimestamp: item.originalTimestamp
        };
    });

    if (mode === 'transcricao' || mode === 'comboio') {
        return mappedData.sort((a, b) => (Number(b.originalTimestamp) || 0) - (Number(a.originalTimestamp) || 0));
    }
    return mappedData;
};

// ==========================================
// 🚀 MOTOR DE DIAGNÓSTICO
// ==========================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const runDiagnostics = (rawData: any[]) => {
    const supplies = rawData.filter(row => row.upar0 && Number(row.upar0) > 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniqueSupplies: any[] = [];
    const processedSignatures = new Set();

    supplies.forEach(row => {
        const currentId = Number(row.upar0);
        const encIni = Number(row.upar4) || 0;
        const origUpar3 = row._originalUpar3 !== undefined ? row._originalUpar3 : Number(row.upar3);

        const signature = `${currentId}-${origUpar3}-${encIni}`;
        if (!processedSignatures.has(signature)) {
            processedSignatures.add(signature);
            uniqueSupplies.push(row);
        }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const diagnostics: any[] = [];
    let lastId: number | null = null;
    let lastTime: number | null = null;
    let lastEncIni: number | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formatContextRow = (row: any) => {
        if (!row) return null;
        const origUpar3 = row._originalUpar3 !== undefined ? row._originalUpar3 : Number(row.upar3);
        const encIni = Number(row.upar4) || 0;
        const encFim = Number(row.upar6) || 0;
        let vol = calculateVolume(encFim, encIni);
        if (vol < 0) vol = 0;

        return {
            id: row.upar0,
            inicio: formatUnixDate(origUpar3 > 0 ? origUpar3 : row.upar3),
            encIni,
            encFim,
            vol,
            pwr: row.pwr_ext !== undefined ? `${row.pwr_ext}V` : '-'
        };
    };

    uniqueSupplies.forEach((row, index, array) => {
        const errors: string[] = [];
        const warnings: string[] = [];

        const currentId = Number(row.upar0);
        const encIni = Number(row.upar4) || 0;
        const encFim = Number(row.upar6) || 0;
        const origUpar3 = row._originalUpar3 !== undefined ? row._originalUpar3 : Number(row.upar3);
        const origUpar5 = row._originalUpar5 !== undefined ? row._originalUpar5 : Number(row.upar5);

        if (lastId === currentId) {
            if (lastTime !== origUpar3 || lastEncIni !== encIni) {
                errors.push(`ID Travado (A placa não incrementou o ID. Gerou o mesmo ID ${currentId} para um novo abastecimento)`);
            }
        }
        lastId = currentId;
        lastTime = origUpar3;
        lastEncIni = encIni;

        if (encIni === 0) errors.push("Encerrante Inicial Zerado (upar4 = 0)");
        if (encFim === 0) errors.push("Encerrante Final Zerado (upar6 = 0)");
        if (encIni > 0 && encFim > 0 && encIni === encFim) {
            errors.push("Encerrante Travado (Inicial é igual ao Final, o fluxômetro não registrou volume)");
        }

        if (!origUpar3 || origUpar3 === 0) {
            errors.push("Hora Inicial Zerada (O upar3 chegou corrompido/zerado da telemetria)");
        }
        if (!origUpar5 || origUpar5 === 0) {
            errors.push("Hora Final Zerada (O upar5 chegou corrompido/zerado da telemetria)");
        }

        const pwrExt = row.pwr_ext !== undefined ? Number(row.pwr_ext) : null;
        const pwrInt = row.pwr_int !== undefined ? Number(row.pwr_int) : null;

        if (pwrExt !== null) {
            if (pwrExt < 7) {
                errors.push(`Queda de Energia Elétrica: Tensão da automação caiu para nível crítico (${pwrExt}V).`);
            } else if (pwrExt < 10) {
                warnings.push(`Oscilação de Energia: Tensão da automação abaixo do ideal (${pwrExt}V).`);
            }
        }

        if (pwrInt !== null) {
            if (pwrInt < 3) {
                errors.push(`Falha no Galileosky: Tensão interna do equipamento crítica (${pwrInt}V).`);
            }
        }

        let vol = calculateVolume(encFim, encIni);
        if (vol < 0) vol = 0;

        const prevRow = index > 0 ? array[index - 1] : null;
        const nextRow = index < array.length - 1 ? array[index + 1] : null;

        diagnostics.push({
            uid: row._uid || Math.random().toString(36),
            id: currentId,
            placa: row.upar1 || 'N/A',
            dataInicio: formatUnixDate(origUpar3 > 0 ? origUpar3 : row.upar3),
            volumeCalculado: vol,
            errors,
            warnings,
            isOk: errors.length === 0 && warnings.length === 0,
            hasWarningOnly: errors.length === 0 && warnings.length > 0,
            context: {
                prev: formatContextRow(prevRow),
                current: formatContextRow(row),
                next: formatContextRow(nextRow)
            }
        });
    });

    return diagnostics;
};