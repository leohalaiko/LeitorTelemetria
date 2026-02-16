import Papa from 'papaparse';
import { parseWlnContent, type WlnRecord } from './wlnParser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatUnixDate = (timestamp: any) => {
    if (!timestamp || timestamp === 0) return '-';
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

export const processWlnFile = (file: File): Promise<WlnRecord[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result;
            if (typeof text === 'string') {
                resolve(parseWlnContent(text));
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const reconciliateData = (wlnData: any[], tankData: TankRecord[]) => {
    const processedIDs = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];
    const validRows = wlnData.filter(row => row.upar0 && Number(row.upar0) > 0);

    validRows.forEach(row => {
        const idOperacao = String(row.upar0);
        if (processedIDs.has(idOperacao)) return;
        processedIDs.add(idOperacao);

        const startTs = String(row.upar3).length > 11 ? Number(row.upar3) : Number(row.upar3) * 1000;
        let endTs = 0;
        if (row.upar5 && Number(row.upar5) > 0) {
            endTs = String(row.upar5).length > 11 ? Number(row.upar5) : Number(row.upar5) * 1000;
        } else {
            endTs = startTs + (4 * 60 * 1000);
        }

        const tankStart = findClosestRecord(tankData, startTs);
        const tankEnd = findClosestRecord(tankData, endTs);

        let volumeCalculado = 0;
        if (tankStart && tankEnd) {
            volumeCalculado = tankStart.volume - tankEnd.volume;
            if (volumeCalculado < 0) volumeCalculado = 0;
        }

        results.push({
            'originalTimestamp': startTs,
            'Data': formatUnixDate(row.upar3),
            'Data Final': formatUnixDate(row.upar5 || endTs/1000),
            'ID Operação': row.upar0,
            'Veículo (Cartão)': row.upar1 || '',
            'Frentista': row.upar2 || '',
            'Volume (L)': Number(volumeCalculado.toFixed(2)),
            'Encerrante Inicial Bruto': Number(row.upar4) || 0,
            'Encerrante Final Bruto': Number(row.upar6) || 0,
            'Odômetro': row.upar10 || '-',
            'Tipo': 'Conciliado'
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
                const rawTs = Number(row.upar3);
                const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;
                result.push({
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
    uniqueSupplies.sort((a, b) => Number(a.row.upar3) - Number(b.row.upar3));
    const finalData = uniqueSupplies.map(item => {
        currentIdCounter++;
        const rawTs = Number(item.row.upar3);
        const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;
        return {
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
        const rawTs = Number(row.upar3);
        const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;
        return {
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
        const timeA = a.originalTimestamp || 0;
        const timeB = b.originalTimestamp || 0;
        return timeA - timeB;
    });

    let medidorCorrente = 0;
    for (const item of sortedData) {
        const med = Number(item['Encerrante Inicial Bruto'] || item['Encerrante Inicial'] || 0);
        if (med > 0) { medidorCorrente = med; break; }
    }

    const mappedData = sortedData.map((item) => {
        let dateObj = new Date();
        if (item.originalTimestamp) dateObj = new Date(item.originalTimestamp);

        const horaInicio = dateObj.toLocaleTimeString('pt-BR', { hour12: false });
        let horaFim = horaInicio;
        if (item['Data Final'] && item['Data Final'] !== '-') {
            const parts = item['Data Final'].split(' ');
            if (parts.length > 1) horaFim = parts[1];
        }

        let medidorInicialDaLinha = 0;
        let medidorFinalDaLinha = 0;

        if (mode === 'transcricao') {
            medidorInicialDaLinha = medidorCorrente;
            medidorCorrente += Math.round((item['Volume (L)'] || 0) * 100);
            medidorFinalDaLinha = medidorCorrente;
        } else {
            medidorInicialDaLinha = Number(item['Encerrante Inicial Bruto'] || item['Encerrante Inicial'] || 0);
            medidorFinalDaLinha = Number(item['Encerrante Final Bruto'] || item['Encerrante Final'] || 0);
        }

        return {
            raw: item,
            dataStr: item['Data'] || item['Data Inicial'], // Data enviada pra tela
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

    if (mode === 'transcricao') {
        return mappedData.sort((a, b) => (b.originalTimestamp || 0) - (a.originalTimestamp || 0));
    }
    return mappedData;
};