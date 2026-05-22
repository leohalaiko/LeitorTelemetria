import Papa from 'papaparse';
import ExcelJS from 'exceljs';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPumpIoState = (row: any) => String(row?.['i/o'] || row?.io || '').trim().toLowerCase();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isPumpOnRow = (row: any) => ['0/e', '11/e', '13/e'].includes(getPumpIoState(row));

const enrichWlnData = (data: WlnRecord[]) => {
    const chronological = [...data].sort((a, b) => a.timestamp - b.timestamp);
    let lastPumpOnTs = 0;

    chronological.forEach(row => {
        if (isPumpOnRow(row)) lastPumpOnTs = row.timestamp;
        row._lastPumpOnTs = lastPumpOnTs;

        if (row.upar3 && Number(row.upar3) > 0) row._originalUpar3 = Number(row.upar3);
        if (row.upar5 && Number(row.upar5) > 0) row._originalUpar5 = Number(row.upar5);
    });

    return chronological;
};

export const processWlnFile = async (file: File) => {
    try {
        const content = await file.text();
        const records = parseWlnContent(content);
        return enrichWlnData(records);
    } catch (error) {
        console.error("Erro ao processar arquivo WLN:", error);
        throw new Error("Falha na leitura do arquivo WLN.");
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseDateString = (dateInput: any) => {
    if (!dateInput || dateInput === '-') return 0;
    try {
        const safeStr = String(dateInput);
        const parts = safeStr.split(/[\s/.:]+/);
        if (parts.length >= 5) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            const hours = parseInt(parts[3], 10);
            const minutes = parseInt(parts[4], 10);
            const seconds = parts.length > 5 ? parseInt(parts[5], 10) : 0;
            return new Date(year, month, day, hours, minutes, seconds).getTime();
        }
    } catch { return 0; }
    return 0;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const calculateVolFromLevel = (startTime: number, endTime: number, tankData: any[], nextStartTime: number = Infinity, rawWlnData: any[] = [], mode: string = 'normal') => {

    // 1. TRADUTOR DE HORA DO EXCEL (Resolve o bug do DD.MM.YYYY)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseExcelDate = (dateStr: any) => {
        if (!dateStr || dateStr === '-') return 0;
        const s = String(dateStr).trim();
        // Procura o padrão "19.05.2026 23:36:58"
        const match = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
            // Converte para milissegundos reais (Mês no JS começa em 0, por isso -1)
            return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6])).getTime();
        }
        return new Date(s).getTime() || 0;
    };

    // 2. Extração segura do nível
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getLvl = (r: any) => {
        const keys = Object.keys(r);
        const targetKey = keys.find(k => k.toLowerCase().includes('estoque s10') || k.toLowerCase().includes('tanque 1 - s10') || k.toLowerCase().includes('estoque')) || keys[1];
        const val = Number(String(r[targetKey] || 0).replace(',', '.'));
        return isNaN(val) ? 0 : val;
    };

    const validRows = tankData.filter(r => parseExcelDate(r['Hora'] || r['Date']) > 0 && getLvl(r) > 0);
    if (validRows.length === 0) return 0;

    // 3. Acha o Nível de Início
    let startRow = validRows[0];
    let minStartDiff = Infinity;
    validRows.forEach(row => {
        const rowTime = parseExcelDate(row['Hora'] || row['Date']);
        const startDiff = Math.abs(rowTime - startTime);
        if (startDiff <= minStartDiff) {
            minStartDiff = startDiff;
            startRow = row;
        }
    });

    const levelStart = getLvl(startRow);
    let lowestLvl = levelStart;

    // 4. O RELÓGIO DE PACIÊNCIA (Agora o tempo real funciona!)
    // 8 minutos (480.000ms) se for sem_encerrante, senão 3 minutos (180.000ms)
    const patienceTime = (mode === 'sem_encerrante') ? 480000 : 180000;
    const maxWatchTime = endTime + patienceTime;

    const rowsAfter = validRows.filter(r => parseExcelDate(r['Hora'] || r['Date']) >= endTime);
    rowsAfter.sort((a, b) => parseExcelDate(a['Hora'] || a['Date']) - parseExcelDate(b['Hora'] || b['Date']));

    // 5. O LAÇO DA VERDADE
    for (let i = 0; i < rowsAfter.length; i++) {
        const rowTime = parseExcelDate(rowsAfter[i]['Hora'] || rowsAfter[i]['Date']);
        const currentLvl = getLvl(rowsAfter[i]);

        // 🚨 GATILHO TEMPORAL: Bateu os 8 minutos da linha do Excel? Freia!
        if (rowTime > maxWatchTime) {
            break;
        }

        // 🚨 RADAR LÓGICO: O próximo abastecimento oficial começou
        if (rowTime >= nextStartTime) {
            break;
        }

        // 🚨 RADAR FÍSICO (AGORA COM CARÊNCIA DE 60 SEGUNDOS)
        if (mode === 'sem_encerrante' && rawWlnData && rawWlnData.length > 0) {

            // Dá 1 minuto para a placa "respirar" e desligar o relé fisicamente
            const gracePeriodEnd = endTime + 60000;

            const pumpTurnedOn = rawWlnData.some(wlnRow => {
                const wlnTime = String(wlnRow.timestamp || wlnRow.upar3).length > 11 ? Number(wlnRow.timestamp || wlnRow.upar3) : Number(wlnRow.timestamp || wlnRow.upar3) * 1000;
                const io = String(wlnRow['i/o'] || wlnRow.io || '').trim().toLowerCase();
                const isPumpOn = ['0/e', '11/e', '13/e'].includes(io);

                // O Radar só dispara se a bomba estiver ligada DEPOIS da carência
                return isPumpOn && wlnTime > gracePeriodEnd && wlnTime <= rowTime;
            });

            if (pumpTurnedOn) {
                break;
            }
        }

        // 🚀 O VERDADEIRO FUNDO DO POÇO
        if (currentLvl < lowestLvl) {
            lowestLvl = currentLvl;
        }
    }

    if (lowestLvl >= levelStart) return 0;
    return Math.max(0, Number((levelStart - lowestLvl).toFixed(2)));
};

void calculateVolFromLevel;

// 🚀 LEITOR DE TANQUE BLINDADO (Filtro Estrito: Apenas "Estoque S10 Dura+")
export const parseTankFile = async (file: File): Promise<any[]> => {
    const name = file.name.toLowerCase();

    // Suporte para XLSX
    if (name.endsWith('.xlsx')) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any[] = [];

        workbook.eachSheet((ws) => {
            let headers: string[] = [];
            let headerRowIndex = -1;

            ws.eachRow((row, rowNumber) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rowValues = row.values as any[];
                if (headerRowIndex === -1) {
                    const hasHora = rowValues.some(v => String(v || '').includes('Hora') || String(v || '').includes('Date'));
                    if (hasHora) {
                        headerRowIndex = rowNumber;
                        row.eachCell((cell, colNumber) => {
                            headers[colNumber] = cell.text ? String(cell.text).trim() : `Col${colNumber}`;
                        });
                    }
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const rowData: any = {};
                    row.eachCell((cell, colNumber) => {
                        if (headers[colNumber]) {
                            rowData[headers[colNumber]] = cell.text ? String(cell.text).trim() : '';
                        }
                    });

                    // 🚀 FILTRO ESTRITO: Ignora outros tanques, pega APENAS o Estoque S10 Dura+
                    const volStr = rowData['Estoque S10 Dura+'];
                    if (volStr) {
                        const ts = parseDateString(rowData['Hora'] || rowData['Date']);
                        const cleanVolStr = String(volStr).replace(/[lL]\s*$/, '').trim().replace(',', '.');
                        const volClean = parseFloat(cleanVolStr);

                        if (!isNaN(ts) && !isNaN(volClean)) {
                            data.push({ timestamp: ts, volume: volClean, rawDate: rowData['Hora'] });
                        }
                    }
                }
            });
        });
        return data.sort((a, b) => a.timestamp - b.timestamp);
    } else {
        // Suporte para CSV
        return new Promise<any[]>((resolve, reject) => {
            Papa.parse(file, {
                header: true, skipEmptyLines: true, delimiter: ";",
                transformHeader: h => h ? String(h).trim().replace(/^\uFEFF/, '') : '',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                complete: (results: any) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const records: any[] = [];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    results.data.forEach((row: any) => {
                        // 🚀 FILTRO ESTRITO: Pega APENAS o Estoque S10 Dura+
                        const volStr = row['Estoque S10 Dura+'];
                        if (volStr) {
                            const ts = parseDateString(row['Hora'] || row['Horário'] || row['Data'] || row['Time']);
                            const cleanVolStr = String(volStr).replace(/[lL]\s*$/, '').trim().replace(',', '.');
                            const volClean = parseFloat(cleanVolStr);
                            if (!isNaN(ts) && !isNaN(volClean)) {
                                records.push({ timestamp: ts, volume: volClean, rawDate: row['Hora'] });
                            }
                        }
                    });
                    records.sort((a, b) => a.timestamp - b.timestamp);
                    resolve(records);
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                error: (err: any) => reject(err)
            });
        });
    }
};

// 🚀 A NOVA LÓGICA HÍBRIDA DE CONCILIAÇÃO
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// 🚀 A NOVA LÓGICA HÍBRIDA DE CONCILIAÇÃO
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const reconciliateData = (wlnData: any[], tankData: any[], mode: string = 'transcricao') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];

    const getClosest = (targetTs: number) => {
        if (!tankData || tankData.length === 0) return null;
        return tankData.reduce((prev, curr) => Math.abs(curr.timestamp - targetTs) < Math.abs(prev.timestamp - targetTs) ? curr : prev);
    };

    const calculateTankVolume = (startTs: number, endTs: number) => {
        const tankStart = getClosest(startTs);
        const tankEnd = getClosest(endTs);
        let volumeCalculado = 0;
        if (tankStart && tankEnd) {
            volumeCalculado = tankStart.volume - tankEnd.volume;
            if (volumeCalculado < 0) volumeCalculado = 0;
        }
        return Number(volumeCalculado.toFixed(2));
    };

    // =======================================================================
    // MODO SEM ENCERRANTE (Unindo Tramas, Nível Estabilizado e Fantasmas)
    // =======================================================================
    if (mode === 'sem_encerrante' || mode === 'travado') {
        let currentIdCounter = 0;
        const mergedEvents: any[] = [];

        // PASSO 1: Lógica Normal Perfeita (Pega os Abastecimentos Oficiais)
        const processedSignatures = new Set();
        wlnData.forEach(row => {
            const id = Number(row.upar0);
            const start = Number(row.upar3);
            const end = Number(row.upar5);
            const signature = `${id}-${start}-${end}`;

            if (id > 0 && start > 0 && end > 0 && !processedSignatures.has(signature)) {
                processedSignatures.add(signature);
                const startTs = String(start).length > 11 ? start : start * 1000;
                const endTs = String(end).length > 11 ? end : end * 1000;

                mergedEvents.push({
                    isGhost: false,
                    id: id,
                    startTs: startTs,
                    endTs: endTs,
                    row: row
                });
            }
        });

        // PASSO 2: 🚀 Chama o Módulo de Energia e Rastreia Fantasmas
        const sortedWln = [...wlnData].sort((a, b) => a.timestamp - b.timestamp);
        const energySupplies = processEnergyRecovery(sortedWln);
        const ghosts = energySupplies.filter(s => String(s.Status || s.Tipo).includes('Furo de Trama'));

        ghosts.forEach(ghost => {
            const ghostStart = ghost.originalTimestamp;

            // Verifica duplicidade: Algum abastecimento normal ocorreu no mesmo minuto?
            const isDuplicate = mergedEvents.some(m => Math.abs(m.startTs - ghostStart) < 120000); // 2 minutos de margem

            if (!isDuplicate) {
                mergedEvents.push({
                    isGhost: true,
                    id: 0,
                    startTs: ghostStart,
                    endTs: ghost.endTimestamp || ghostStart,
                    ghostObj: ghost
                });
            }
        });

        // 🚀 A CORREÇÃO MESTRA: Organiza a linha do tempo ANTES de calcular os volumes!
        mergedEvents.sort((a, b) => a.startTs - b.startTs);

        // 🚀 O LAÇO MANTÉM-SE EXATAMENTE IGUAL
        mergedEvents.forEach((evt, index, array) => {
            currentIdCounter++;

            // Agora sim, o array[index + 1] será realmente o abastecimento do futuro!
            const nextStartTime = (index + 1 < array.length) ? array[index + 1].startTs : Infinity;

            // Passamos a artilharia pesada: nextStartTime, wlnData (para o Radar Físico) e o mode
            const vol = calculateVolFromLevel(evt.startTs, evt.endTs, tankData, nextStartTime, wlnData, mode);

            if (evt.isGhost) {
                results.push({
                    _uid: generateUID(),
                    'originalTimestamp': evt.startTs,
                    'ID Gerado (Corrigido)': currentIdCounter,
                    'ID Original (Travado)': 0,
                    'Data': formatUnixDate(evt.startTs / 1000),
                    'Data Final': formatUnixDate(evt.endTs / 1000),
                    'ID Operacao': currentIdCounter,
                    'Veiculo (Cartão)': evt.ghostObj['Veiculo'] || '',
                    'Frentista': evt.ghostObj['Frentista'] || '',
                    'Odometro': evt.ghostObj['Odometro'] || '-',
                    'Volume (L)': vol,
                    'Encerrante Inicial Bruto': 0,
                    'Encerrante Final Bruto': 0,
                    'Tipo': 'Recuperado Sem Trama (Nível Excel)'
                });
            } else {
                const row = evt.row;
                results.push({
                    _uid: generateUID(),
                    'originalTimestamp': evt.startTs,
                    'ID Gerado (Corrigido)': currentIdCounter,
                    'ID Original (Travado)': row.upar0,
                    'Data': formatUnixDate(row.upar3),
                    'Data Final': formatUnixDate(row.upar5),
                    'ID Operacao': row.upar0 || currentIdCounter,
                    'Veiculo (Cartão)': row.upar1 || '',
                    'Frentista': row.upar2 || '',
                    'Odometro': row.upar10 || '-',
                    'Volume (L)': vol,
                    'Encerrante Inicial Bruto': Number(row.upar4) || 0,
                    'Encerrante Final Bruto': Number(row.upar6) || 0,
                    'Tipo': 'Conciliado (Nível Excel)'
                });
            }
        });

        return results.sort((a, b) => b.originalTimestamp - a.originalTimestamp);
    }

    // =======================================================================
    // MODO TRANSCRIÇÃO E COMBOIO (Mantidos 100% Intactos)
    // =======================================================================
    const processedIDs = new Set<string>();
    const validUpar0s = wlnData.map(r => Number(r.upar0)).filter(id => !isNaN(id) && id > 0);
    const maxUpar0 = validUpar0s.length > 0 ? Math.max(...validUpar0s) : 0;

    const validRows = wlnData.filter(row => {
        const id = Number(row.upar0);
        if (!id || isNaN(id)) return false;
        if ((mode === 'transcricao' || mode === 'sem_encerrante') && (!Number(row.upar3) || !Number(row.upar5))) return false;
        const isSmallId = maxUpar0 > 50 ? (id < maxUpar0 * 0.5) : false;
        if (mode === 'comboio') return isSmallId;
        return !isSmallId;
    });

    validRows.forEach(row => {
        const idOperacao = (mode === 'transcricao' || mode === 'sem_encerrante')
            ? `${row.upar0}-${row.upar3}-${row.upar5}-${row.upar1 || ''}-${row.upar2 || ''}`
            : String(row.upar0);
        if (processedIDs.has(idOperacao)) return;
        processedIDs.add(idOperacao);

        const startTs = String(row.upar3).length > 11 ? Number(row.upar3) : Number(row.upar3) * 1000;
        const endTs = String(row.upar5).length > 11 ? Number(row.upar5) : Number(row.upar5) * 1000;

        results.push({
            _uid: generateUID(),
            'originalTimestamp': startTs || 0,
            'Data': formatUnixDate(row.upar3),
            'Data Final': formatUnixDate(row.upar5 || endTs/1000),
            'ID Operacao': row.upar0,
            'Veiculo (Cartão)': row.upar1 || '',
            'Frentista': row.upar2 || '',
            'Odometro': row.upar10 || '-',
            'Volume (L)': calculateTankVolume(startTs, endTs),
            'Encerrante Inicial Bruto': mode === 'transcricao' ? 0 : (Number(row.upar4) || 0),
            'Encerrante Final Bruto': mode === 'transcricao' ? 0 : (Number(row.upar6) || 0),
            'Tipo': mode === 'comboio' ? 'Comboio (Mangote)' : 'Conciliado'
        });
    });

    return results.sort((a, b) => b.originalTimestamp - a.originalTimestamp);
};


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const processLogFile = (data: any[], mode: string, options?: { startId?: number }) => {
    if (!data || data.length === 0) return [];
    const cleanedData = [...data].sort((a, b) => a.timestamp - b.timestamp);

    switch (mode) {
        case 'travado': return processLockedID(cleanedData, options?.startId || 0);
        case 'normal': return processNormalSupply(cleanedData);
        case 'energia': return processEnergyRecovery(cleanedData);
        default: return cleanedData;
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processNormalSupply = (data: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = [];
    const processedIDs = new Set<string>();

    let inSupply = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentSupply: any = null;
    let globalLastCan = 0;

    let lastValidId = 0;
    let virtualBaseId = -1;
    let virtualCounter = 0;

    let floatingPlaca = '';
    let floatingFrentista = '';

    let highestSeenId = 0;

    const getNextVirtualId = () => {
        if (lastValidId !== virtualBaseId) {
            virtualBaseId = lastValidId;
            virtualCounter = lastValidId > 0 ? (lastValidId * 1000) + 999 : 999999;
        } else {
            virtualCounter++;
        }
        return virtualCounter;
    };

    const getFallbackIni = (startIndex: number) => {
        for (let j = startIndex; j >= 0; j--) {
            const can = Number(data[j].can_r23);
            if (can > 0) return can;
        }
        return 0;
    };

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const can = Number(row.can_r23) || 0;
        const id = Number(row.upar0) || 0;

        if (id > 0) {
            if (highestSeenId > 0 && id < highestSeenId - 100) {
                processedIDs.clear();
            }
            if (id > highestSeenId) highestSeenId = id;
            lastValidId = id;
        }

        const gprs = String(row.gprs_answer || '').toLowerCase();
        const hasReset = gprs.includes('reset');

        const pId = String(row.upar1 || '');
        const fId = String(row.upar2 || '');
        const tId = String(row.trailer_id_code || '');

        if (pId && pId !== '0') floatingPlaca = pId;
        if (fId && fId !== '0') floatingFrentista = fId;

        if (tId && tId !== '0') {
            if (!floatingPlaca || floatingPlaca === tId) {
                floatingPlaca = tId;
            } else if (floatingPlaca !== tId) {
                floatingFrentista = tId;
            }
        }

        if (!inSupply) {
            const isNewTrama = id > 0 && !processedIDs.has(String(id));
            const isNewRaw = id === 0 && can > globalLastCan;

            if (isNewTrama || isNewRaw) {
                inSupply = true;
                const encInicial = isNewTrama ? (Number(row.upar4) || can || getFallbackIni(i)) : (globalLastCan || can || getFallbackIni(i));

                currentSupply = {
                    id: isNewTrama ? id : 0,
                    placa: floatingPlaca,
                    frentista: floatingFrentista,
                    encIni: encInicial,
                    maxCan: can > 0 ? can : encInicial,
                    resetOccurred: false,
                    startRow: row,
                    lastCanChangeIndex: i
                };
                if (isNewTrama) processedIDs.add(String(id));
            }
        }

        if (inSupply && currentSupply) {

            if (currentSupply.id === 0 && id > 0) {
                if (!processedIDs.has(String(id))) {
                    currentSupply.id = id;
                    currentSupply.startRow = row;
                    processedIDs.add(String(id));
                }
            }

            if (floatingPlaca && !currentSupply.placa) currentSupply.placa = floatingPlaca;
            if (floatingFrentista && !currentSupply.frentista) currentSupply.frentista = floatingFrentista;

            if (can > currentSupply.maxCan) {
                currentSupply.maxCan = can;
                currentSupply.lastCanChangeIndex = i;
            }

            let isEnd = false;
            let encFim = currentSupply.maxCan;
            let endRow = row;

            if (hasReset) {
                currentSupply.resetOccurred = true;
                isEnd = true;
                encFim = currentSupply.maxCan;
                endRow = row;
            }

            if (!isEnd) {
                if (!currentSupply.resetOccurred && id === currentSupply.id && Number(row.upar6) > 0) {
                    isEnd = true;
                    encFim = Number(row.upar6);

                    for (let look = 1; look <= 5; look++) {
                        if (i + look < data.length) {
                            const lookCan = Number(data[i + look].can_r23) || 0;
                            if (lookCan > encFim) encFim = lookCan;
                        }
                    }
                    endRow = row;
                } else {
                    const msgsSinceChange = i - currentSupply.lastCanChangeIndex;
                    if (msgsSinceChange >= 15 && currentSupply.maxCan > currentSupply.encIni) {

                        let pendingTrama = false;
                        for (let look = 1; look <= 30; look++) {
                            if (i + look < data.length) {
                                const lookId = Number(data[i + look].upar0) || 0;
                                const lookUpar6 = Number(data[i + look].upar6) || 0;
                                if (lookUpar6 > 0 && (currentSupply.id === 0 || lookId === currentSupply.id)) {
                                    pendingTrama = true;
                                    break;
                                }
                            }
                        }

                        if (!pendingTrama) {
                            isEnd = true;
                            encFim = currentSupply.maxCan;
                            endRow = data[currentSupply.lastCanChangeIndex];
                        }
                    } else if (id > 0 && id !== currentSupply.id && !processedIDs.has(String(id))) {
                        isEnd = true;
                        encFim = currentSupply.maxCan;
                        endRow = data[i > 0 ? i - 1 : 0];
                        i--;
                    }
                }
            }

            if (isEnd) {
                let vol = calculateVolume(encFim, currentSupply.encIni);
                if (vol > 0.5) {
                    let finalId = currentSupply.id;

                    if (finalId === 0) {
                        finalId = getNextVirtualId();
                    }

                    const rawTs = Number(currentSupply.startRow.upar3) || currentSupply.startRow.timestamp;
                    const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;

                    result.push({
                        _uid: generateUID(),
                        'originalTimestamp': timeMs,
                        'Data': formatUnixDate(currentSupply.startRow.upar3 || currentSupply.startRow.timestamp),
                        'Data Final': formatUnixDate(endRow.upar5 || endRow.timestamp),
                        'ID Operacao': finalId,
                        'Veiculo (Cartão)': currentSupply.placa,
                        'Frentista': currentSupply.frentista,
                        'Odometro': currentSupply.startRow.upar10 || '-',
                        'Volume (L)': vol,
                        'Encerrante Inicial Bruto': currentSupply.encIni,
                        'Encerrante Final Bruto': encFim,
                        'Tipo': currentSupply.resetOccurred ? 'Recuperado (Reset)' : 'Normal'
                    });
                }

                inSupply = false;
                currentSupply = null;
                floatingPlaca = '';
                floatingFrentista = '';
                globalLastCan = encFim;
            }
        }

        if (!inSupply && can > 0) {
            globalLastCan = can;
        }
    }

    if (inSupply && currentSupply && currentSupply.maxCan > currentSupply.encIni) {
        let vol = calculateVolume(currentSupply.maxCan, currentSupply.encIni);
        if (vol > 0.5) {
            const finalId = currentSupply.id === 0 ? getNextVirtualId() : currentSupply.id;

            const rawTs = Number(currentSupply.startRow.upar3) || currentSupply.startRow.timestamp;
            const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;
            result.push({
                _uid: generateUID(), 'originalTimestamp': timeMs,
                'Data': formatUnixDate(currentSupply.startRow.upar3 || currentSupply.startRow.timestamp),
                'Data Final': formatUnixDate(currentSupply.startRow.upar5 || currentSupply.startRow.timestamp),
                'ID Operacao': finalId, 'Veiculo (Cartão)': currentSupply.placa, 'Frentista': currentSupply.frentista,
                'Odometro': currentSupply.startRow.upar10 || '-',
                'Volume (L)': vol, 'Encerrante Inicial Bruto': currentSupply.encIni, 'Encerrante Final Bruto': currentSupply.maxCan,
                'Tipo': currentSupply.resetOccurred ? 'Recuperado (Reset)' : 'Normal'
            });
        }
    }

    return result.sort((a, b) => a.originalTimestamp - b.originalTimestamp);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processLockedID = (data: any[], startIdInput: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = [];
    let currentIdCounter = Number(startIdInput);
    let inSupply = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentSupply: any = null;

    let floatingPlaca = '';
    let floatingFrentista = '';

    const pumpOnStates = new Set(['0/e', '11/e', '13/e']);
    const pumpOffStates = new Set(['0/f', '12/f', '10/f']);

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const io = String(row['i/o'] || row['io'] || '').toLowerCase();
        const idTrama = Number(row.upar0 || 0);

        const pId = String(row.upar1 || '');
        const fId = String(row.upar2 || '');
        const tId = String(row.trailer_id_code || '');
        if (pId && pId !== '0') floatingPlaca = pId;
        if (fId && fId !== '0') floatingFrentista = fId;
        if (tId && tId !== '0') {
            if (!floatingPlaca || floatingPlaca === tId) floatingPlaca = tId;
            else floatingFrentista = tId;
        }

        const isStart = pumpOnStates.has(io);
        const isStop = pumpOffStates.has(io);

        if (!inSupply && isStart) {
            inSupply = true;
            currentSupply = {
                id: 0,
                placa: floatingPlaca,
                frentista: floatingFrentista,
                startRow: row,
                summaryRow: null,
                encIni: 0,
                encFim: 0,
                lastActivityIndex: i
            };
        }

        if (inSupply && currentSupply) {
            if (isStart || idTrama > 0) {
                currentSupply.lastActivityIndex = i;
            }
            if (idTrama > 0 && currentSupply.id === 0) {
                currentSupply.id = idTrama;
            }
            if (idTrama > 0 && (Number(row.upar4) > 0 || Number(row.upar6) > 0)) {
                currentSupply.summaryRow = row;
                currentSupply.encIni = Number(row.upar4) || currentSupply.encIni || 0;
                currentSupply.encFim = Number(row.upar6) || currentSupply.encFim || 0;
            }
            if (floatingPlaca && !currentSupply.placa) currentSupply.placa = floatingPlaca;
            if (floatingFrentista && !currentSupply.frentista) currentSupply.frentista = floatingFrentista;

            const msgsSinceStart = i - currentSupply.lastActivityIndex;
            if (isStop || msgsSinceStart >= 15) {
                if (!currentSupply.summaryRow) {
                    for (let look = 1; look <= 5; look++) {
                        const lookRow = data[i + look];
                        if (!lookRow) break;
                        if (Number(lookRow.upar0) > 0 && (Number(lookRow.upar4) > 0 || Number(lookRow.upar6) > 0)) {
                            currentSupply.summaryRow = lookRow;
                            currentSupply.id = currentSupply.id || Number(lookRow.upar0) || 0;
                            currentSupply.encIni = Number(lookRow.upar4) || currentSupply.encIni || 0;
                            currentSupply.encFim = Number(lookRow.upar6) || currentSupply.encFim || 0;
                            break;
                        }
                    }
                }
                currentIdCounter++;
                const summaryRow = currentSupply.summaryRow || row;
                const rawTs = Number(summaryRow.upar3) || Number(currentSupply.startRow.upar3) || currentSupply.startRow.timestamp;
                const endTs = Number(summaryRow.upar5) || Number(row.upar5) || row.timestamp;
                const encIni = Number(currentSupply.encIni) || Number(summaryRow.upar4) || 0;
                const encFim = Number(currentSupply.encFim) || Number(summaryRow.upar6) || 0;
                const volume = Math.max(0, calculateVolume(encFim, encIni));

                result.push({
                    _uid: generateUID(),
                    'originalTimestamp': String(rawTs).length > 11 ? rawTs : rawTs * 1000,
                    'endTimestamp': String(endTs).length > 11 ? endTs : endTs * 1000,
                    'ID Gerado (Corrigido)': currentIdCounter,
                    'ID Original (Travado)': currentSupply.id,
                    'Data Inicial': formatUnixDate(currentSupply.startRow.upar3 || rawTs),
                    'Data Final': formatUnixDate(row.upar5 || endTs),
                    'Veiculo': currentSupply.placa || '-',
                    'Frentista': currentSupply.frentista || '-',
                    'Odometro': currentSupply.startRow.upar10 || '-',
                    'Volume (L)': volume,
                    'Encerrante Inicial Bruto': encIni,
                    'Encerrante Final Bruto': encFim,
                    'Status': 'Recuperado (I/O + Nivel Excel)'
                });

                inSupply = false;
                currentSupply = null;
                floatingPlaca = '';
                floatingFrentista = '';
            }
        }
    }
    return result.sort((a, b) => a.originalTimestamp - b.originalTimestamp);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processEnergyRecovery = (data: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = [];
    let inSupply = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentSupply: any = null;
    let globalLastCan = 0;

    let lastValidId = 0;
    let virtualBaseId = -1;
    let virtualCounter = 0;

    let floatingPlaca = '';
    let floatingFrentista = '';

    const getNextVirtualId = () => {
        if (lastValidId !== virtualBaseId) {
            virtualBaseId = lastValidId;
            virtualCounter = lastValidId > 0 ? (lastValidId * 1000) + 999 : 999999;
        } else {
            virtualCounter++;
        }
        return virtualCounter;
    };

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const can = Number(row.can_r23) || 0;
        const currentId = Number(row.upar0) || 0;

        if (currentId > 0) lastValidId = currentId;

        const pId = String(row.upar1 || '');
        const fId = String(row.upar2 || '');
        const tId = String(row.trailer_id_code || '');

        if (pId && pId !== '0') floatingPlaca = pId;
        if (fId && fId !== '0') floatingFrentista = fId;

        if (tId && tId !== '0') {
            if (!floatingPlaca || floatingPlaca === tId) {
                floatingPlaca = tId;
            } else if (floatingPlaca !== tId) {
                floatingFrentista = tId;
            }
        }

        if (can > 0 && globalLastCan === 0) {
            globalLastCan = can;
        }

        if (!inSupply && can > globalLastCan) {
            inSupply = true;
            currentSupply = {
                id: currentId,
                encIni: globalLastCan,
                maxCan: can,
                startRow: row,
                lastCanChangeIndex: i,
                placa: floatingPlaca,
                frentista: floatingFrentista
            };
        }

        if (inSupply && currentSupply) {

            if (currentSupply.id === 0 && currentId > 0) {
                currentSupply.id = currentId;
                currentSupply.startRow = row;
            }
            if (floatingPlaca && !currentSupply.placa) currentSupply.placa = floatingPlaca;
            if (floatingFrentista && !currentSupply.frentista) currentSupply.frentista = floatingFrentista;

            if (can > currentSupply.maxCan) {
                currentSupply.maxCan = can;
                currentSupply.lastCanChangeIndex = i;
            }

            const gprs = String(row.gprs_answer || '').toLowerCase();
            const hasReset = gprs.includes('reset');

            let isEnd = false;
            let encFim = currentSupply.maxCan;
            let endRow = row;

            if (hasReset) {
                isEnd = true;
                encFim = currentSupply.maxCan;
                endRow = row;
            }

            // REGRA 1: Parada Física (5 Mensagens)
            const msgsSinceChange = i - currentSupply.lastCanChangeIndex;

            if (!isEnd && msgsSinceChange >= 5 && currentSupply.maxCan > currentSupply.encIni) {

                // REGRA 2: Verificação de TRAMA (15 Mensagens)
                let pendingTrama = false;
                for (let look = 1; look <= 15; look++) {
                    if (i + look < data.length) {
                        const lookId = Number(data[i + look].upar0) || 0;
                        if (lookId > 0 && (currentSupply.id === 0 || lookId === currentSupply.id)) {
                            pendingTrama = true;
                            break;
                        }
                    }
                }

                // Se não tem trama no horizonte de 15 msgs, é Fantasma! Reconstrói com dados brutos.
                if (!pendingTrama) {
                    isEnd = true;
                    encFim = currentSupply.maxCan;
                    endRow = data[currentSupply.lastCanChangeIndex];
                }
            }

            if (isEnd) {
                let vol = calculateVolume(encFim, currentSupply.encIni);
                if (vol > 0.5) {
                    const rawTs = Number(currentSupply.startRow.upar3) || currentSupply.startRow.timestamp;
                    const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;

                    const endRawTs = Number(endRow.upar5) || endRow.timestamp;
                    const endMs = String(endRawTs).length > 11 ? endRawTs : endRawTs * 1000;

                    const isRecovered = currentSupply.id === 0;
                    const finalId = isRecovered ? getNextVirtualId() : currentSupply.id;
                    const statusText = isRecovered ? 'Recuperado (Furo de Trama)' : 'Normal (Malha Fechada)';

                    result.push({
                        _uid: generateUID(),
                        'originalTimestamp': timeMs,
                        'endTimestamp': endMs, // 🚀 TAG INJETADA
                        'Data Inicial': formatUnixDate(currentSupply.startRow.upar3 || currentSupply.startRow.timestamp),
                        'Data Final': formatUnixDate(endRow.upar5 || endRow.timestamp),
                        'ID Operacao': finalId,
                        'Veiculo': currentSupply.placa || '-',
                        'Frentista': currentSupply.frentista || '-',
                        'Odometro': currentSupply.startRow.upar10 || '-',
                        'Volume (L)': vol,
                        'Encerrante Inicial Bruto': currentSupply.encIni,
                        'Encerrante Final Bruto': encFim,
                        'Status': statusText
                    });
                }
                inSupply = false;
                currentSupply = null;
                globalLastCan = encFim;
                floatingPlaca = '';
                floatingFrentista = '';
            }
        }

        if (!inSupply && can > 0) {
            globalLastCan = can;
        }
    }

    if (inSupply && currentSupply && currentSupply.maxCan > currentSupply.encIni) {
        let vol = calculateVolume(currentSupply.maxCan, currentSupply.encIni);
        if (vol > 0.5) {
            const rawTs = Number(currentSupply.startRow.upar3) || currentSupply.startRow.timestamp;
            const timeMs = String(rawTs).length > 11 ? rawTs : rawTs * 1000;

            const endRawTs = Number(currentSupply.startRow.upar5) || currentSupply.startRow.timestamp;
            const endMs = String(endRawTs).length > 11 ? endRawTs : endRawTs * 1000;

            const isRecovered = currentSupply.id === 0;

            result.push({
                _uid: generateUID(),
                'originalTimestamp': timeMs,
                'endTimestamp': endMs, // 🚀 TAG INJETADA
                'Data Inicial': formatUnixDate(currentSupply.startRow.upar3 || currentSupply.startRow.timestamp),
                'Data Final': formatUnixDate(currentSupply.startRow.upar5 || currentSupply.startRow.timestamp),
                'ID Operacao': isRecovered ? getNextVirtualId() : currentSupply.id,
                'Veiculo': currentSupply.placa || '-',
                'Frentista': currentSupply.frentista || '-',
                'Odometro': currentSupply.startRow.upar10 || '-',
                'Volume (L)': vol, 'Encerrante Inicial Bruto': currentSupply.encIni, 'Encerrante Final Bruto': currentSupply.maxCan,
                'Status': isRecovered ? 'Recuperado (Furo de Trama)' : 'Normal (Malha Fechada)'
            });
        }
    }

    return result.sort((a, b) => a.originalTimestamp - b.originalTimestamp);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const formatForExcel = (data: any[], mode: string) => {
    let syntheticMeter = 0;
    const shouldSyntheticMeter = mode === 'transcricao' || mode === 'sem_encerrante';
    const sortedData = shouldSyntheticMeter
        ? [...data].sort((a, b) => (Number(a.originalTimestamp) || 0) - (Number(b.originalTimestamp) || 0))
        : data;

    const formatted = sortedData.map(item => {
        let inicioStr = '-';
        let fimStr = '-';
        let dataStr = '-';

        const rawDataInicio = item['Data'] || item['Data Inicial'];
        const rawDataFim = item['Data Final'];

        if (rawDataInicio && rawDataInicio !== '-') {
            const safeInicio = String(rawDataInicio);
            const parts = safeInicio.split(' ');
            if (parts.length > 1) {
                dataStr = parts[0];
                inicioStr = parts[1];
            } else {
                inicioStr = safeInicio;
            }
        }

        if (rawDataFim && rawDataFim !== '-') {
            const safeFim = String(rawDataFim);
            const parts = safeFim.split(' ');
            fimStr = parts.length > 1 ? parts[1] : safeFim;
        }

        const volume = Number(item['Volume (L)']) || 0;
        const medidorInicial = shouldSyntheticMeter ? syntheticMeter : (item['Encerrante Inicial Bruto'] || '-');
        if (shouldSyntheticMeter) syntheticMeter += Math.round(volume * 100);
        const medidorFinal = shouldSyntheticMeter ? syntheticMeter : (item['Encerrante Final Bruto'] || '-');

        return {
            _uid: item._uid,
            originalTimestamp: item.originalTimestamp,
            raw: item,
            dataStr,
            horaInicio: inicioStr,
            horaFim: fimStr,
            id: item['ID Operacao'] || item['ID Gerado (Corrigido)'] || '-',
            placa: item['Veiculo (Cartão)'] || item['Veiculo'] || '-',
            frentista: item['Frentista'] || '-',
            odometro: item['Odometro'] || '-',
            volumeConciliado: volume,
            medidorInicial,
            medidorFinal,
            tipo: item['Tipo'] || item['Status'] || '-'
        };
    });

    return shouldSyntheticMeter
        ? formatted.sort((a, b) => (Number(b.originalTimestamp) || 0) - (Number(a.originalTimestamp) || 0))
        : formatted;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const runDiagnostics = (rawData: any[]) => {
    const supplies = rawData.filter(row => row.upar0 && Number(row.upar0) > 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniqueSupplies: any[] = [];
    const processedSignatures = new Set();

    const resetEvents = rawData.filter(r => String(r.gprs_answer || '').toLowerCase().includes('reset'));
    void resetEvents;

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

        const startIndex = rawData.indexOf(row);
        let hasResetInWindow = false;
        if (startIndex !== -1) {
            for (let i = startIndex; i < Math.min(startIndex + 150, rawData.length); i++) {
                if (String(rawData[i].gprs_answer || '').toLowerCase().includes('reset')) {
                    hasResetInWindow = true;
                    break;
                }
                if (rawData[i].upar6 && Number(rawData[i].upar6) > 0 && rawData[i].upar0 === row.upar0) {
                    break;
                }
            }
        }

        if (hasResetInWindow) {
            errors.push("🚨 O dispositivo reiniciou no meio da operação! (gprs_answer=Reset)");
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
