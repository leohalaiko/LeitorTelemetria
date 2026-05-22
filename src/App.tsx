import { useState } from 'react';
// @ts-ignore
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
// @ts-ignore
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, Download, FileSpreadsheet, Settings, X, Fuel, Edit3, CheckCircle, AlertOctagon, Trash2, ZapOff, Calculator, CloudDownload, ChevronDown, FolderArchive } from 'lucide-react';

import { processLogFile, processWlnFile, formatForExcel, parseTankFile, reconciliateData, runDiagnostics } from './utils/processors';
import { ModeSelector } from './components/ModeSelector';
import { FileUpload } from './components/FileUpload';

function App() {
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [processedData, setProcessedData] = useState<any[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [diagnosticData, setDiagnosticData] = useState<any[]>([]);

    const [isProcessing, setIsProcessing] = useState(false);
    const [startIdInput, setStartIdInput] = useState<string>("");

    const [wlnFile, setWlnFile] = useState<File | null>(null);
    const [tankFile, setTankFile] = useState<File | null>(null);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pumpName, setPumpName] = useState("");
    const [fileNameClient, setFileNameClient] = useState("");

    const [templateFile, setTemplateFile] = useState<File | null>(null);
    const [needsManualMolde, setNeedsManualMolde] = useState(false);
    const [isPumpDropdownOpen, setIsPumpDropdownOpen] = useState(false);

    const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
    const [downloadTarget, setDownloadTarget] = useState<{ type: 'all' | 'single'; dateStr?: string; rows?: any[] } | null>(null);

    // ==========================================
    // 🚀 MOTOR DE TRADUÇÃO AUTOMÁTICA
    // ==========================================
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const translateCardsToPlates = (data: any[], dictionary?: Record<string, string>) => {
        let dict = dictionary;
        if (!dict) {
            const savedDict = localStorage.getItem('ats_dicionario_cartoes');
            if (savedDict) {
                try { dict = JSON.parse(savedDict); } catch { /* ignore */ }
            }
        }
        if (!dict) return data;

        return data.map(item => {
            const cartao = String(item['Veículo (Cartão)'] || item['Veículo'] || '').trim();
            if (cartao && dict![cartao]) {
                return {
                    ...item,
                    'Veículo (Cartão)': dict![cartao],
                    'Veículo': dict![cartao]
                };
            }
            return item;
        });
    };

    // ==========================================
    // 🚀 INTEGRAÇÃO ATS (GRAPHQL)
    // ==========================================
    const [atsPlacas, setAtsPlacas] = useState<string[]>([]);
    const [atsBombas, setAtsBombas] = useState<string[]>([]);
    const [isSyncingAts, setIsSyncingAts] = useState(false);

    const handleSyncATS = async () => {
        setIsSyncingAts(true);
        try {
            const response = await fetch('/api/ats');
            if (!response.ok) throw new Error("Falha na API interna");

            const { bombas, cartoes } = await response.json();

            const nomesBombas = bombas
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((a: any) => a.name)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .filter((nome: any) => {
                    if (!nome) return false;
                    return String(nome).toLowerCase().includes('bomba');
                });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const placasValidas = cartoes.filter((c: any) => c.asset && c.asset.name).map((c: any) => c.asset.name);

            const dicionarioCartoes: Record<string, string> = {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cartoes.forEach((c: any) => {
                if (c.externalIdentifier && c.asset?.name) {
                    dicionarioCartoes[String(c.externalIdentifier)] = c.asset.name;
                }
            });

            localStorage.setItem('ats_dicionario_cartoes', JSON.stringify(dicionarioCartoes));
            localStorage.setItem('ats_lista_bombas', JSON.stringify(nomesBombas));

            setAtsBombas([...new Set(nomesBombas)] as string[]);
            setAtsPlacas([...new Set(placasValidas)] as string[]);
            setProcessedData(prev => translateCardsToPlates(prev, dicionarioCartoes));

            toast.success(`Sincronizado! ${nomesBombas.length} Bombas e ${placasValidas.length} Placas carregadas.`);
        } catch (error) {
            console.error(error);
            toast.error("Erro ao sincronizar ATS. Verifique as configurações do servidor.");
        } finally {
            setIsSyncingAts(false);
        }
    };

    useState(() => {
        const bombasList = localStorage.getItem('ats_lista_bombas');
        if (bombasList) {
            try { setAtsBombas(JSON.parse(bombasList)); } catch { /* ignore */ }
        }
    });

    const displayData = formatForExcel(processedData, currentMode || 'normal');

    const groupedData: Record<string, any[]> = {};
    displayData.forEach(item => {
        const dataStrApenas = (item.dataStr?.split(' ')[0] || 'Sem_Data').replace(/,/g, '');
        if (!groupedData[dataStrApenas]) {
            groupedData[dataStrApenas] = [];
        }
        groupedData[dataStrApenas].push(item);
    });

    const totalVolume = displayData.reduce((acc, row) => acc + (Number(row.volumeConciliado) || 0), 0);
    let totalEncerrante = 0;
    if (displayData.length > 0) {
        const firstEnc = Number(displayData[0].medidorInicial) || 0;
        const lastEnc = Number(displayData[displayData.length - 1].medidorFinal) || 0;
        const multiplier = (currentMode === 'transcricao' || currentMode === 'comboio') ? 0.01 : 0.1;
        totalEncerrante = Math.max(0, (lastEnc - firstEnc) * multiplier);
    }
    const diferencaLitros = Math.abs(totalEncerrante - totalVolume);
    const hasDivergence = diferencaLitros > 0.5;

    const handleRowEdit = (uid: string, fieldName: string, value: string | number) => {
        setProcessedData(prev => prev.map(item => {
            if (item._uid === uid) {
                const updatedItem = { ...item };

                if (fieldName === 'Placa') {
                    // Corrigido: Sem acento para casar com o formatForExcel
                    updatedItem['Veiculo'] = value;
                    updatedItem['Veiculo (Cartão)'] = value;
                } else if (fieldName === 'Frentista') {
                    updatedItem['Frentista'] = value;
                } else if (fieldName === 'Odômetro') {
                    // Corrigido: Sem acento
                    updatedItem['Odometro'] = value;
                } else if (fieldName === 'Volume (L)') {
                    updatedItem['Volume (L)'] = value;
                    updatedItem.volumeConciliado = value;
                } else if (fieldName === 'ID') {
                    // Corrigido: Sem acento
                    updatedItem['ID Operacao'] = value;
                    updatedItem['ID Gerado (Corrigido)'] = value;
                } else if (fieldName === 'EncInicial' || fieldName === 'EncFinal') {
                    const isIni = fieldName === 'EncInicial';
                    const newIni = isIni ? Number(value) || 0 : (Number(updatedItem['Encerrante Inicial Bruto']) || Number(updatedItem.medidorInicial) || 0);
                    const newFim = !isIni ? Number(value) || 0 : (Number(updatedItem['Encerrante Final Bruto']) || Number(updatedItem.medidorFinal) || 0);

                    const novoVol = Number(((newFim - newIni) * 0.1).toFixed(2));

                    updatedItem['Encerrante Inicial Bruto'] = newIni;
                    updatedItem.medidorInicial = newIni;
                    updatedItem['Encerrante Final Bruto'] = newFim;
                    updatedItem.medidorFinal = newFim;
                    updatedItem['Volume (L)'] = Math.max(0, novoVol);
                    updatedItem.volumeConciliado = Math.max(0, novoVol);
                } else {
                    updatedItem[fieldName] = value;
                }

                return updatedItem;
            }
            return item;
        }));
    };

    const handleDeleteRow = (uid: string) => {
        setProcessedData(prev => prev.filter(item => item._uid !== uid));
        toast.success("Abastecimento removido! Encerrantes recalculados.");
    };

    const toggleDay = (day: string) => {
        setExpandedDays(prev => ({ ...prev, [day]: !prev[day] }));
    };

    const handleDownloadAllClick = () => {
        if (processedData.length > 0) {
            setPumpName("");
            setFileNameClient("");
            setNeedsManualMolde(false);
            setTemplateFile(null);
            setDownloadTarget({ type: 'all' });
            setIsModalOpen(true);
        }
    };

    const handleDownloadSingleDayClick = (dateStr: string, rows: any[]) => {
        setPumpName("");
        setFileNameClient("");
        setNeedsManualMolde(false);
        setTemplateFile(null);
        setDownloadTarget({ type: 'single', dateStr, rows });
        setIsModalOpen(true);
    };

    const confirmDownload = async () => {
        if (!pumpName.trim() || !fileNameClient.trim() || !downloadTarget) {
            toast.error("Preencha o Nome da Bomba e a Identificação do Arquivo!");
            return;
        }

        setIsProcessing(true);
        try {
            let baseTemplateBuffer: ArrayBuffer;

            if (templateFile) {
                baseTemplateBuffer = await templateFile.arrayBuffer();
            } else {
                const response = await fetch('/Molde_Vazio.xlsx');
                if (!response.ok) {
                    setNeedsManualMolde(true);
                    toast.error("Molde automático não encontrado no servidor. Anexe manualmente.");
                    setIsProcessing(false);
                    return;
                }
                baseTemplateBuffer = await response.arrayBuffer();
            }

            const getExcelTimeFraction = (timeStr: string | number | undefined | null) => {
                if (!timeStr || timeStr === '-') return null;
                const str = String(timeStr);
                const timePart = str.split(' ')[1] || str;
                const parts = timePart.split(':');
                if (parts.length >= 2) {
                    const h = Number(parts[0]);
                    const m = Number(parts[1]);
                    return !isNaN(h) && !isNaN(m) ? (h / 24) + (m / 1440) : null;
                }
                return null;
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cleanValue = (val: any) => {
                if (val === null || val === undefined || val === '') return null;
                if (typeof val === 'number') return val;
                const strVal = String(val).trim();
                return strVal !== '' && !isNaN(Number(strVal)) ? Number(strVal) : strVal;
            };

            const generateSingleDayBuffer = async (rowsForDay: any[], dateStr: string) => {
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(baseTemplateBuffer.slice(0));

                if (workbook.calcProperties) workbook.calcProperties.fullCalcOnLoad = true;
                const ws = workbook.worksheets[0];

                const [d, m, a] = dateStr.split('/');
                ws.name = `${d}.${m}.${a}`;

                let medidorSetup = 0;
                if (currentMode === 'transcricao' || currentMode === 'comboio') {
                    medidorSetup = 0;
                } else {
                    const first = rowsForDay.find((rowItem: any) => rowItem.medidorInicial > 0);
                    medidorSetup = first ? first.medidorInicial : 0;
                }
                ws.getCell('D2').value = medidorSetup;

                const chronologicalRows = [...rowsForDay].sort((x, y) => (x.originalTimestamp || 0) - (y.originalTimestamp || 0));

                chronologicalRows.forEach((item: any, index: number) => {
                    const r = index + 3;
                    const row = ws.getRow(r);

                    if (r > 3) {
                        const baseRow = ws.getRow(3);
                        for (let col = 1; col <= 13; col++) {
                            row.getCell(col).style = baseRow.getCell(col).style;
                        }
                    }

                    const medidorCol = (currentMode === 'transcricao' || currentMode === 'comboio')
                        ? Number(item.medidorFinal)
                        : Number(item.raw['Encerrante Final Bruto'] || 0);

                    row.getCell(1).value = pumpName ? String(pumpName).trim() : null;

                    const startFraction = getExcelTimeFraction(item.horaInicio);
                    const cellInicio = row.getCell(2);
                    cellInicio.value = startFraction;
                    if (startFraction !== null) cellInicio.numFmt = 'hh:mm';

                    const endFraction = getExcelTimeFraction(item.horaFim);
                    const cellFim = row.getCell(3);
                    cellFim.value = endFraction;
                    if (endFraction !== null) cellFim.numFmt = 'hh:mm';

                    row.getCell(4).value = medidorCol;
                    row.getCell(6).value = Number(item.medidorInicial);
                    row.getCell(7).value = Number(item.medidorFinal);
                    row.getCell(8).value = Number(item.volumeConciliado);
                    row.getCell(9).value = cleanValue(item.placa);

                    const idVal = Number(item.id);
                    row.getCell(11).value = isNaN(idVal) ? cleanValue(item.id) : idVal;
                    row.getCell(12).value = cleanValue(item.frentista);
                    row.getCell(13).value = (item.odometro && item.odometro !== '-' && item.odometro !== '') ? Number(item.odometro) : null;
                });

                return await workbook.xlsx.writeBuffer();
            };

            const clientCode = fileNameClient.trim().replace(/\s+/g, '');

            if (downloadTarget.type === 'single') {
                const targetDate = downloadTarget.dateStr!;
                const targetRows = downloadTarget.rows!;
                const [dia, mes, ano] = targetDate.split('/');

                const buffer = await generateSingleDayBuffer(targetRows, targetDate);
                const nomeArquivo = `Planilha insercao de abastecimento_S10_${clientCode}_${dia}${mes}${ano}.xlsx`;

                saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomeArquivo);
                toast.success(`Planilha do dia ${targetDate} gerada com sucesso!`);
            } else {
                const zip = new JSZip();
                const arrayDeDias = Object.keys(groupedData);

                for (const dateStr of arrayDeDias) {
                    const [dia, mes, ano] = dateStr.split('/');
                    const bufferPlanilha = await generateSingleDayBuffer(groupedData[dateStr], dateStr);
                    zip.file(`Planilha insercao de abastecimento_S10_${clientCode}_${dia}${mes}${ano}.xlsx`, bufferPlanilha);
                }

                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const d = displayData[0]?.originalTimestamp ? new Date(displayData[0].originalTimestamp) : new Date();
                const diaAt = String(d.getDate()).padStart(2,'0');
                const mesAt = String(d.getMonth()+1).padStart(2,'0');
                const anoAt = d.getFullYear();

                const nomeZip = `Pacote_Abastecimentos_S10_${clientCode}_${diaAt}${mesAt}${anoAt}.zip`;
                saveAs(zipBlob, nomeZip);
                toast.success(`ZIP Gerado! ${arrayDeDias.length} planilhas diárias separadas prontas.`);
            }

            setIsModalOpen(false);
        } catch (error) {
            console.error(error);
            setNeedsManualMolde(true);
            toast.error("Falha ao gerar planilhas. Tente novamente.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleProcessConciliation = async () => {
        if (!wlnFile || !tankFile) {
            toast.error("Por favor, selecione os dois arquivos.");
            return;
        }
        setIsProcessing(true);
        try {
            const wlnRaw = await processWlnFile(wlnFile);
            const tankRaw = await parseTankFile(tankFile);
            if (tankRaw.length === 0) throw new Error("Não foi possível ler dados do arquivo de tanque.");

            const mergedData = reconciliateData(wlnRaw, tankRaw, currentMode!);
            const translatedData = translateCardsToPlates(mergedData);
            setProcessedData(translatedData);

            if (translatedData.length > 0) toast.success(`Conciliação concluída! Placas verificadas.`);
            else toast.warning("Nenhum abastecimento encontrado no cruzamento.");
        } catch (error) {
            const err = error as Error;
            toast.error("Erro na conciliação: " + err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFileSelect = async (file: File) => {
        if (currentMode === 'transcricao' || currentMode === 'comboio') {
            const name = file.name.toLowerCase();
            if (name.endsWith('.wln') || name.endsWith('.txt')) {
                setWlnFile(file);
                toast.info("Arquivo WLN carregado!");
            } else if (name.endsWith('.csv') || name.endsWith('.xlsx')) {
                setTankFile(file);
                toast.info("Arquivo de Tanque carregado!");
            } else toast.warning("Formato desconhecido.");
            return;
        }

        setIsProcessing(true);
        setProcessedData([]);
        setDiagnosticData([]);

        if (currentMode === 'travado' && !startIdInput) {
            toast.error("ID inicial obrigatório.");
            setIsProcessing(false);
            return;
        }

        try {
            const isWlnFile = file.name.toLowerCase().endsWith('.wln');
            if (currentMode === 'wln' || isWlnFile) {
                const data = await processWlnFile(file);

                if (currentMode === 'wln') {
                    const diags = runDiagnostics(data);
                    setDiagnosticData(diags);
                    if (diags.length > 0) toast.success(`Diagnóstico concluído: ${diags.length} análises.`);
                    else toast.warning("Nenhum abastecimento encontrado no arquivo.");
                } else {
                    if (data.length > 0) {
                        const cleanData = processLogFile(data, currentMode || 'normal', { startId: Number(startIdInput) });
                        const translatedData = translateCardsToPlates(cleanData);
                        setProcessedData(translatedData.length > 0 ? translatedData : data);
                        toast.success(`${translatedData.length || data.length} registros processados.`);
                    }
                }
            } else {
                // Aqui podemos manter o Papa parse para arquivos CSV se for outro modo, mas o parser novo XLSX já está dentro do parseTankFile para o nível
                Papa.parse(file, {
                    header: true, skipEmptyLines: true, delimiter: ";", transformHeader: h => h.trim(),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    complete: (res: any) => {
                        const clean = processLogFile(res.data, currentMode || 'normal', { startId: Number(startIdInput) });
                        const translatedData = translateCardsToPlates(clean);
                        setProcessedData(translatedData);
                        toast.success(`${translatedData.length} registros processados.`);
                    },
                    error: (err: Error) => {
                        toast.error("Erro CSV: " + err.message);
                    }
                });
            }
        } catch (error) {
            console.error(error);
            toast.error("Erro ao processar arquivo.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 py-6 px-4 font-sans text-gray-800">
            <Toaster position="top-right" richColors />

            <datalist id="lista-placas">
                {atsPlacas.map((placa, idx) => <option key={idx} value={placa} />)}
            </datalist>

            <div className="max-w-[96%] mx-auto">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">Analisador de Telemetria</h1>
                    <p className="text-gray-500 text-lg">
                        {currentMode ? <span className="inline-flex items-center bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">Modo: {currentMode.toUpperCase()}</span> : 'Selecione o tipo de análise'}
                    </p>
                </div>

                {!currentMode ? (
                    <ModeSelector onSelectMode={setCurrentMode} />
                ) : (
                    <div className="animate-fade-in-up">
                        <button onClick={() => {
                            setCurrentMode(null);
                            setProcessedData([]);
                            setDiagnosticData([]);
                            setStartIdInput("");
                            setWlnFile(null);
                            setTankFile(null);
                            setExpandedDays({});
                        }} className="mb-6 flex items-center text-gray-500 hover:text-blue-600 font-medium">
                            <ArrowLeft className="w-5 h-5 mr-2"/> Voltar
                        </button>

                        <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-100 relative">
                            {currentMode === 'transcricao' || currentMode === 'comboio' ? (
                                <div className="space-y-6">
                                    <div className={`p-4 ${currentMode === 'comboio' ? 'bg-teal-50 border-teal-200 text-teal-800' : 'bg-orange-50 border-orange-200 text-orange-800'} border rounded-xl text-sm mb-6`}>
                                        <strong>{currentMode === 'comboio' ? 'Carregamento de Comboio:' : 'Conciliação Automática:'}</strong> {currentMode === 'comboio' ? 'Filtra e cruza APENAS os abastecimentos do Mangote.' : 'Envie o arquivo da Placa (WLN) e o do Nível (CSV/XLSX) para cruzar os horários.'}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="flex flex-col">
                                            <h3 className="font-bold text-gray-700 mb-3 flex items-center"><Fuel className="w-5 h-5 mr-2 text-blue-500"/> 1. Telemetria (WLN)</h3>
                                            {wlnFile ? (
                                                <div className="h-48 rounded-2xl border-2 border-green-400 bg-green-50 flex flex-col items-center justify-center p-4 shadow-sm transition-all">
                                                    <CheckCircle className="w-10 h-10 text-green-500 mb-3"/>
                                                    <p className="text-green-800 font-bold truncate w-full text-center px-4">{wlnFile.name}</p>
                                                </div>
                                            ) : (
                                                <FileUpload onFileSelect={handleFileSelect} acceptText="Suporta apenas arquivo .wln"/>
                                            )}
                                        </div>

                                        <div className="flex flex-col">
                                            <h3 className="font-bold text-gray-700 mb-3 flex items-center"><Settings className="w-5 h-5 mr-2 text-blue-500"/> 2. Nível Tanque (CSV/XLSX)</h3>
                                            {tankFile ? (
                                                <div className="h-48 rounded-2xl border-2 border-green-400 bg-green-50 flex flex-col items-center justify-center p-4 shadow-sm transition-all">
                                                    <CheckCircle className="w-10 h-10 text-green-500 mb-3"/>
                                                    <p className="text-green-800 font-bold truncate w-full text-center px-4">{tankFile.name}</p>
                                                </div>
                                            ) : (
                                                <FileUpload onFileSelect={handleFileSelect} acceptText="Suporta arquivos .CSV ou .XLSX"/>
                                            )}
                                        </div>
                                    </div>

                                    {wlnFile && tankFile && processedData.length === 0 && !isProcessing && (
                                        <button onClick={handleProcessConciliation} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-blue-200 transition-all active:scale-95">Processar Conciliação</button>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {currentMode === 'energia' && (
                                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm flex items-center gap-3">
                                            <ZapOff className="w-6 h-6 flex-shrink-0"/>
                                            <span><strong>Recuperação de Queda de Energia:</strong> Restaura os litros perdidos garantindo a Malha Fechada do tanque usando o relógio eletrônico.</span>
                                        </div>
                                    )}
                                    {currentMode === 'travado' && (
                                        <div className="mb-8 p-6 bg-purple-50 rounded-2xl border border-purple-100 flex flex-col md:flex-row items-center gap-4">
                                            <div className="w-full md:w-48"><label className="text-xs font-bold text-purple-800 uppercase ml-1">Último ID Válido</label>
                                                <input type="number" className="w-full mt-1 px-4 py-3 rounded-xl border border-purple-200 outline-none" value={startIdInput} onChange={(e) => setStartIdInput(e.target.value)}/></div>
                                        </div>
                                    )}
                                    <FileUpload onFileSelect={handleFileSelect} acceptText="Suporta apenas arquivo .wln" />
                                </>
                            )}

                            {isProcessing && !isModalOpen && (
                                <div className="mt-8 mb-4 p-4 text-center font-bold text-blue-600 bg-blue-50 rounded-xl animate-pulse">
                                    Processando dados, por favor aguarde...
                                </div>
                            )}

                            {currentMode === 'wln' && diagnosticData.length > 0 && (
                                <div className="mt-8 animate-fade-in-up">
                                    <div className="mb-6">
                                        <h2 className="text-2xl font-extrabold text-gray-800">Health Check da Bomba</h2>
                                        <p className="text-gray-500">Relatório de falhas e inconsistências puras na telemetria.</p>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 max-h-[600px] overflow-y-auto pr-2">
                                        {diagnosticData.map((diag) => {
                                            const cardBorder = diag.isOk ? 'border-green-500' : (diag.errors.length > 0 ? 'border-red-500' : 'border-yellow-500');
                                            const iconColor = diag.isOk ? 'bg-green-100 text-green-600' : (diag.errors.length > 0 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600');

                                            return (
                                                <div key={diag.uid} className={`p-5 rounded-2xl border-l-8 shadow-sm bg-white ${cardBorder}`}>
                                                    <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                                                        <div className="flex items-center gap-4">
                                                            <div className={`p-3 rounded-full ${iconColor}`}>
                                                                {diag.isOk ? <CheckCircle className="w-6 h-6" /> : <AlertOctagon className="w-6 h-6" />}
                                                            </div>
                                                            <div>
                                                                <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                                                                    Abastecimento #{diag.id}
                                                                </h3>
                                                                <p className="text-sm text-gray-500 font-medium mt-1">
                                                                    Placa: <span className="text-gray-800">{diag.placa}</span> |
                                                                    Vol: <span className="text-gray-800">{diag.volumeCalculado} L</span> |
                                                                    Início: {diag.dataInicio}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2 mt-3 md:mt-0 flex-wrap">
                                                            {diag.isOk ? (
                                                                <span className="bg-green-100 text-green-800 text-sm px-4 py-1.5 rounded-full font-bold whitespace-nowrap">TUDO OK</span>
                                                            ) : (
                                                                <>
                                                                    {diag.errors.length > 0 && <span className="bg-red-100 text-red-800 text-sm px-4 py-1.5 rounded-full font-bold whitespace-nowrap">{diag.errors.length} ERRO(S)</span>}
                                                                    {diag.warnings.length > 0 && <span className="bg-yellow-100 text-yellow-800 text-sm px-4 py-1.5 rounded-full font-bold whitespace-nowrap">{diag.warnings.length} ALERTA(S)</span>}
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {!diag.isOk && (
                                                        <div className="mt-5 pt-4 border-t border-gray-100 space-y-4">
                                                            <div className="space-y-2">
                                                                {diag.errors.map((err: string, i: number) => (
                                                                    <div key={`err-${i}`} className="flex items-center text-sm text-red-700 bg-red-50 p-3 rounded-xl border border-red-100">
                                                                        <span className="mr-3 text-lg">🔴</span> <span className="font-medium">{err}</span>
                                                                    </div>
                                                                ))}
                                                                {diag.warnings.map((warn: string, i: number) => (
                                                                    <div key={`warn-${i}`} className="flex items-center text-sm text-yellow-700 bg-yellow-50 p-3 rounded-xl border border-yellow-100">
                                                                        <span className="mr-3 text-lg">⚠️</span> <span className="font-medium">{warn}</span>
                                                                    </div>
                                                                ))}
                                                            </div>

                                                            <div className="border border-gray-200 rounded-xl overflow-hidden mt-4 shadow-sm">
                                                                <div className="bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-1">
                                                                    <span>🔍 Raio-X da Telemetria (Contexto)</span>
                                                                </div>
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full text-left bg-white whitespace-nowrap">
                                                                        <thead className="bg-slate-50 text-slate-500 text-xs">
                                                                        <tr>
                                                                            <th className="px-4 py-3">ID</th>
                                                                            <th className="px-4 py-3">Horário</th>
                                                                            <th className="px-4 py-3">Enc. Ini</th>
                                                                            <th className="px-4 py-3">Enc. Fim</th>
                                                                            <th className="px-4 py-3">Vol</th>
                                                                            <th className="px-4 py-3">Tensão</th>
                                                                        </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                        {diag.context.prev && (
                                                                            <tr className="border-b border-gray-100 text-slate-500 text-xs hover:bg-slate-50">
                                                                                <td className="px-4 py-2 font-medium">Anterior</td>
                                                                                <td className="px-4 py-2 font-mono">{diag.context.prev.id}</td>
                                                                                <td className="px-4 py-2">{diag.context.prev.inicio}</td>
                                                                                <td className="px-4 py-2 font-mono">{diag.context.prev.encIni}</td>
                                                                                <td className="px-4 py-2 font-mono">{diag.context.prev.encFim}</td>
                                                                                <td className="px-4 py-2">{diag.context.prev.vol} L</td>
                                                                                <td className="px-4 py-2 font-mono">{diag.context.prev.pwr}</td>
                                                                            </tr>
                                                                        )}

                                                                        <tr className={`border-b border-gray-100 text-xs font-medium ${diag.errors.length > 0 ? 'bg-red-50 text-red-900' : 'bg-yellow-50 text-yellow-900'}`}>
                                                                            <td className="px-4 py-2 font-bold flex items-center gap-1">👉 Atual</td>
                                                                            <td className="px-4 py-2 font-mono font-bold">{diag.context.current.id}</td>
                                                                            <td className="px-4 py-2">{diag.context.current.inicio}</td>
                                                                            <td className="px-4 py-2 font-mono">{diag.context.current.encIni}</td>
                                                                            <td className="px-4 py-2 font-mono">{diag.context.current.encFim}</td>
                                                                            <td className="px-4 py-2">{diag.context.current.vol} L</td>
                                                                            <td className="px-4 py-2 font-bold font-mono">{diag.context.current.pwr}</td>
                                                                        </tr>

                                                                        {diag.context.next && (
                                                                            <tr className="text-slate-500 text-xs hover:bg-slate-50">
                                                                                <td className="px-4 py-2 font-medium">Próxima</td>
                                                                                <td className="px-4 py-2 font-mono">{diag.context.next.id}</td>
                                                                                <td className="px-4 py-2">{diag.context.next.inicio}</td>
                                                                                <td className="px-4 py-2 font-mono">{diag.context.next.encIni}</td>
                                                                                <td className="px-4 py-2 font-mono">{diag.context.next.encFim}</td>
                                                                                <td className="px-4 py-2">{diag.context.next.vol} L</td>
                                                                                <td className="px-4 py-2 font-mono">{diag.context.next.pwr}</td>
                                                                            </tr>
                                                                        )}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {currentMode !== 'wln' && displayData.length > 0 && (
                                <div className="mt-8 animate-fade-in-up space-y-6">

                                    <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Soma de Volume Geral</p>
                                                <p className="text-2xl font-black text-gray-800">{totalVolume.toFixed(1)} L</p>
                                            </div>
                                            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><Fuel className="w-7 h-7"/></div>
                                        </div>
                                        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Saída Total pelo Medidor</p>
                                                <p className="text-2xl font-black text-gray-800">{totalEncerrante.toFixed(1)} L</p>
                                            </div>
                                            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><Calculator className="w-7 h-7"/></div>
                                        </div>
                                        <div className={`p-5 rounded-2xl border shadow-sm flex items-center justify-between transition-colors ${hasDivergence ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                                            <div>
                                                <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${hasDivergence ? 'text-red-500' : 'text-green-600'}`}>
                                                    {hasDivergence ? 'Divergência Detectada' : 'Matemática Fechada'}
                                                </p>
                                                <p className={`text-2xl font-black ${hasDivergence ? 'text-red-700' : 'text-green-700'}`}>
                                                    {hasDivergence ? `${diferencaLitros.toFixed(1)} L de diferença` : '0.0 L'}
                                                </p>
                                            </div>
                                            <div className={`p-3 rounded-xl ${hasDivergence ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                                {hasDivergence ? <AlertOctagon className="w-7 h-7"/> : <CheckCircle className="w-7 h-7"/>}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 bg-green-50 p-4 rounded-xl border border-green-100 gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-green-100 rounded-lg text-green-600"><FileSpreadsheet className="w-6 h-6" /></div>
                                            <div>
                                                <p className="font-bold text-green-900">Logs Multi-Dias Detectados!</p>
                                                <p className="text-sm text-green-700">Baixe os dias individualmente ou exporte o lote inteiro em um pacote ZIP.</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 w-full sm:w-auto">
                                            <button
                                                onClick={handleSyncATS}
                                                disabled={isSyncingAts}
                                                className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-4 py-3 rounded-xl font-bold flex items-center transition-all"
                                            >
                                                {isSyncingAts ? <span className="animate-pulse">Sincronizando...</span> : <><CloudDownload className="w-5 h-5 mr-2" /> ATS Autocomplete</>}
                                            </button>

                                            <button onClick={handleDownloadAllClick} className="bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-xl font-bold flex items-center shadow-lg transition-all active:scale-95">
                                                <FolderArchive className="w-5 h-5 mr-2" /> Baixar Todos os Dias (ZIP)
                                            </button>
                                        </div>
                                    </div>

                                    {Object.keys(groupedData).sort((x, y) => y.localeCompare(x)).map((dateStr) => {
                                        const rowsForDay = groupedData[dateStr];
                                        const isExpanded = !!expandedDays[dateStr];
                                        const volumeDoDia = rowsForDay.reduce((acc, r) => acc + (Number(r.volumeConciliado) || 0), 0);

                                        return (
                                            <div key={dateStr} className="border border-gray-200 rounded-2xl shadow-sm bg-white overflow-hidden transition-all">

                                                <div
                                                    onClick={() => toggleDay(dateStr)}
                                                    className="bg-gray-50/70 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer hover:bg-gray-100/80 transition-colors border-b border-gray-100"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                                        <div>
                                                            <h3 className="font-extrabold text-lg text-gray-800">📅 Dia {dateStr}</h3>
                                                            <p className="text-xs text-gray-500 font-medium mt-0.5">
                                                                {rowsForDay.length} abastecimentos localizados • Vol. Diário: <span className="text-blue-600 font-bold">{volumeDoDia.toFixed(1)} L</span>
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div onClick={(e) => e.stopPropagation()} className="w-full sm:w-auto">
                                                        <button
                                                            onClick={() => handleDownloadSingleDayClick(dateStr, rowsForDay)}
                                                            className="w-full sm:w-auto bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center shadow-sm"
                                                        >
                                                            <Download className="w-4 h-4 mr-1.5 text-gray-500" /> Baixar Apenas este Dia
                                                        </button>
                                                    </div>
                                                </div>

                                                {isExpanded && (
                                                    <div className="overflow-auto max-h-[600px] w-full bg-white animate-in fade-in duration-200">
                                                        <table className="w-full text-sm text-left relative">
                                                            <thead className="bg-gray-50 text-gray-500 font-bold sticky top-0 z-10 shadow-xs border-b border-gray-100">
                                                            <tr>
                                                                <th className="px-4 py-3 whitespace-nowrap">Data</th>
                                                                <th className="px-4 py-3 whitespace-nowrap">Início</th>
                                                                <th className="px-4 py-3 whitespace-nowrap">Fim</th>
                                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600 flex items-center gap-1"><Edit3 className="w-4 h-4"/> ID</th>
                                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600"><Edit3 className="w-4 h-4 inline mr-1"/> Placa</th>
                                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600"><Edit3 className="w-4 h-4 inline mr-1"/> Frentista</th>
                                                                {/* 🚀 CABEÇALHO DO ODÔMETRO */}
                                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600"><Edit3 className="w-4 h-4 inline mr-1"/> Odom.</th>
                                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600"><Edit3 className="w-4 h-4 inline mr-1"/> Vol (L)</th>
                                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600"><Edit3 className="w-4 h-4 inline mr-1"/> Enc. Ini</th>
                                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600"><Edit3 className="w-4 h-4 inline mr-1"/> Enc. Fim</th>
                                                                <th className="px-4 py-3 whitespace-nowrap text-center">Ações</th>
                                                            </tr>
                                                            </thead>
                                                            <tbody>
                                                            {rowsForDay.map((row: any) => (
                                                                <tr key={row._uid} className="border-t border-gray-100 hover:bg-gray-50/50 transition-colors">
                                                                    <td className="px-4 py-3 whitespace-nowrap font-bold text-gray-800">{row.dataStr?.split(' ')[0] || '-'}</td>
                                                                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-700">{row.horaInicio}</td>
                                                                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-700">{row.horaFim}</td>

                                                                    <td className="px-4 py-2">
                                                                        <input
                                                                            type="number"
                                                                            className="border border-blue-200 rounded-lg px-2 py-1.5 w-24 focus:ring-2 focus:ring-blue-500 outline-none font-mono font-bold text-gray-700 bg-white shadow-sm"
                                                                            value={row.id}
                                                                            onChange={(e) => handleRowEdit(row._uid, 'ID', Number(e.target.value))}
                                                                        />
                                                                    </td>
                                                                    <td className="px-4 py-2">
                                                                        <input
                                                                            list="lista-placas"
                                                                            type="text" placeholder="EX: ABC1234"
                                                                            className="border border-blue-200 rounded-lg px-3 py-1.5 w-28 focus:ring-2 focus:ring-blue-500 outline-none uppercase font-bold text-gray-700 bg-white shadow-sm"
                                                                            value={row.placa}
                                                                            onChange={(e) => handleRowEdit(row._uid, 'Placa', e.target.value.toUpperCase())}
                                                                        />
                                                                    </td>
                                                                    <td className="px-4 py-2">
                                                                        <input
                                                                            type="text" placeholder="EX: 12345"
                                                                            className="border border-blue-200 rounded-lg px-3 py-1.5 w-28 focus:ring-2 focus:ring-blue-500 outline-none uppercase font-bold text-gray-700 bg-white shadow-sm"
                                                                            value={row.frentista}
                                                                            onChange={(e) => handleRowEdit(row._uid, 'Frentista', e.target.value.toUpperCase())}
                                                                        />
                                                                    </td>
                                                                    {/* 🚀 INPUT DO ODÔMETRO */}
                                                                    <td className="px-4 py-2">
                                                                        <input
                                                                            type="number"
                                                                            className="border border-blue-200 rounded-lg px-3 py-1.5 w-24 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700 bg-white shadow-sm"
                                                                            value={row.odometro !== '-' ? row.odometro : ''}
                                                                            placeholder="-"
                                                                            onChange={(e) => handleRowEdit(row._uid, 'Odômetro', e.target.value)}
                                                                        />
                                                                    </td>
                                                                    <td className="px-4 py-2">
                                                                        <input
                                                                            type="number"
                                                                            className="border border-blue-200 rounded-lg px-3 py-1.5 w-24 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700 bg-white shadow-sm"
                                                                            value={row.volumeConciliado}
                                                                            onChange={(e) => handleRowEdit(row._uid, 'Volume (L)', Number(e.target.value))}
                                                                        />
                                                                    </td>
                                                                    <td className="px-4 py-2">
                                                                        <input
                                                                            type="number"
                                                                            className="border border-blue-200 rounded-lg px-2 py-1.5 w-28 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-gray-500 bg-white shadow-sm"
                                                                            value={row.medidorInicial}
                                                                            onChange={(e) => handleRowEdit(row._uid, 'EncInicial', Number(e.target.value))}
                                                                        />
                                                                    </td>
                                                                    <td className="px-4 py-2">
                                                                        <input
                                                                            type="number"
                                                                            className="border border-blue-200 rounded-lg px-2 py-1.5 w-28 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-gray-500 bg-white shadow-sm"
                                                                            value={row.medidorFinal}
                                                                            onChange={(e) => handleRowEdit(row._uid, 'EncFinal', Number(e.target.value))}
                                                                        />
                                                                    </td>

                                                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                                                        <button
                                                                            onClick={() => handleDeleteRow(row._uid)}
                                                                            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                                            title="Remover linha e recalcular"
                                                                        >
                                                                            <Trash2 className="w-5 h-5" />
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}


                        </div>
                    </div>
                )}
            </div>
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-gray-100">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-gray-800">
                                {downloadTarget?.type === 'all' ? '📦 Exportar Lote Completo (ZIP)' : `📄 Exportar Dia ${downloadTarget?.dateStr}`}
                            </h3>
                            <button onClick={() => { setIsModalOpen(false); setDownloadTarget(null); }} className="p-1 hover:bg-gray-100 rounded-full text-gray-500"><X className="w-6 h-6" /></button>
                        </div>

                        {needsManualMolde && (
                            <div className={`mb-4 p-4 rounded-xl border transition-colors duration-300 ${templateFile ? 'bg-green-50 border-green-300' : 'bg-orange-50 border-orange-300'}`}>
                                <label className={`block text-sm font-bold mb-2 ${templateFile ? 'text-green-800' : 'text-orange-800'}`}>
                                    {templateFile ? '✅ Molde Anexado' : '⚠️ Anexar Molde'}
                                </label>
                                {!templateFile ? (
                                    <input
                                        type="file" accept=".xlsx"
                                        className="w-full text-sm text-orange-800 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-orange-600 file:text-white hover:file:bg-orange-700 outline-none cursor-pointer"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) setTemplateFile(file);
                                        }}
                                    />
                                ) : (
                                    <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-green-200 shadow-sm animate-fade-in-up">
                                        <span className="text-sm font-medium text-green-700 truncate mr-2" title={templateFile.name}>{templateFile.name}</span>
                                        <button onClick={() => setTemplateFile(null)} className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-bold transition-colors">Trocar</button>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="mb-4 relative">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Nome da Bomba</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Pesquise a bomba no ATS..."
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 outline-none pr-10"
                                    value={pumpName}
                                    onChange={(e) => setPumpName(e.target.value)}
                                    onFocus={() => setIsPumpDropdownOpen(true)}
                                    onBlur={() => setTimeout(() => setIsPumpDropdownOpen(false), 200)}
                                />
                                <div className="absolute right-3 top-3.5 text-gray-400">
                                    <ChevronDown className="w-5 h-5" />
                                </div>
                            </div>

                            {isPumpDropdownOpen && (
                                <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 max-h-56 overflow-y-auto">
                                    {atsBombas.length > 0 ? (
                                        atsBombas
                                            .filter(b => b.toLowerCase().includes(pumpName.toLowerCase()))
                                            .map((bomba, idx) => (
                                                <div
                                                    key={idx}
                                                    className="px-4 py-3 hover:bg-blue-50 cursor-pointer text-sm font-medium text-gray-700 border-b border-gray-50 last:border-0 transition-colors"
                                                    onClick={() => {
                                                        setPumpName(bomba);
                                                        setIsPumpDropdownOpen(false);
                                                    }}
                                                >
                                                    <Fuel className="w-4 h-4 inline mr-2 text-blue-500" />
                                                    {bomba}
                                                </div>
                                            ))
                                    ) : (
                                        <div className="px-4 py-4 text-sm text-gray-500 text-center">
                                            A lista está vazia. Sincronize com o ATS.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="mb-8">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Identificação do Arquivo</label>
                            <input type="text" placeholder="Ex: roca644" className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 outline-none" value={fileNameClient} onChange={(e) => setFileNameClient(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmDownload()} />
                        </div>

                        <div className="flex gap-3">
                            <button onClick={() => { setIsModalOpen(false); setDownloadTarget(null); }} className="flex-1 px-4 py-3 rounded-xl font-semibold text-gray-600 hover:bg-gray-100 transition-colors">Cancelar</button>
                            <button
                                onClick={confirmDownload}
                                disabled={isProcessing}
                                className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg disabled:opacity-50"
                            >
                                {isProcessing ? 'Processando...' : 'Gerar Arquivo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
