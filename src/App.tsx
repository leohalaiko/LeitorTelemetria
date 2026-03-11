import { useState } from 'react';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, Download, FileSpreadsheet, Settings, X, Fuel, Edit3, CheckCircle, AlertOctagon, Trash2, ZapOff, Calculator, CloudDownload, ChevronDown } from 'lucide-react';

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

    // ==========================================
    // 🚀 MOTOR DE TRADUÇÃO AUTOMÁTICA (Cartão -> Placa)
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
            // Chamamos o nosso PRÓPRIO servidor de forma segura
            const response = await fetch('/api/ats');
            if (!response.ok) throw new Error("Falha na API interna");

            const { bombas, cartoes } = await response.json();

            // 🚀 FILTRO ESTRITO DA BOMBA
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
                if (fieldName === 'Placa') {
                    if (item['Veículo'] !== undefined) return { ...item, ['Veículo']: value };
                    return { ...item, ['Veículo (Cartão)']: value };
                }
                return { ...item, [fieldName]: value };
            }
            return item;
        }));
    };

    const handleDeleteRow = (uid: string) => {
        setProcessedData(prev => prev.filter(item => item._uid !== uid));
        toast.success("Abastecimento removido! Encerrantes recalculados.");
    };

    const handleDownloadClick = () => {
        if (processedData.length > 0) {
            setPumpName("");
            setFileNameClient("");
            setNeedsManualMolde(false);
            setTemplateFile(null);
            setIsModalOpen(true);
        }
    };

    const confirmDownload = async () => {
        if (!pumpName.trim() || !fileNameClient.trim()) {
            toast.error("Preencha o Nome da Bomba e o Código do Cliente!");
            return;
        }

        try {
            let arrayBuffer: ArrayBuffer;

            if (templateFile) {
                arrayBuffer = await templateFile.arrayBuffer();
            } else {
                const response = await fetch(`/Molde_Vazio.xlsx?v=${Date.now()}`);
                if (!response.ok) {
                    setNeedsManualMolde(true);
                    toast.warning("Molde automático não encontrado no servidor. Por favor, anexe o arquivo manualmente.");
                    return;
                }
                arrayBuffer = await response.arrayBuffer();
            }

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(arrayBuffer);

            if (workbook.calcProperties) {
                workbook.calcProperties.fullCalcOnLoad = true;
            }

            const ws = workbook.worksheets[0];

            const d = displayData[0]?.originalTimestamp ? new Date(displayData[0].originalTimestamp) : new Date();
            const dia = String(d.getDate()).padStart(2,'0');
            const mes = String(d.getMonth()+1).padStart(2,'0');
            const ano = d.getFullYear();

            ws.name = `${dia}.${mes}.${ano}`;

            let medidorSetup = 0;
            if (currentMode === 'transcricao' || currentMode === 'comboio') {
                medidorSetup = 0;
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const first = displayData.find((d: any) => d.medidorInicial > 0);
                medidorSetup = first ? first.medidorInicial : 0;
            }
            ws.getCell('D2').value = medidorSetup;

            const getExcelTimeFraction = (timeStr: string | number | undefined | null) => {
                if (!timeStr || timeStr === '-') return null;
                const str = String(timeStr);
                const timePart = str.split(' ')[1] || str;
                const parts = timePart.split(':');
                if (parts.length >= 2) {
                    const h = Number(parts[0]);
                    const m = Number(parts[1]);
                    if (!isNaN(h) && !isNaN(m)) {
                        return (h / 24) + (m / 1440);
                    }
                }
                return null;
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cleanValue = (val: any) => {
                if (val === null || val === undefined || val === '') return null;
                if (typeof val === 'number') return val;
                const strVal = String(val).trim();
                if (strVal !== '' && !isNaN(Number(strVal))) {
                    return Number(strVal);
                }
                return strVal;
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            displayData.forEach((item: any, index: number) => {
                const r = index + 3;
                const row = ws.getRow(r);

                if (r > 3) {
                    const baseRow = ws.getRow(3);
                    for (let col = 1; col <= 13; col++) {
                        row.getCell(col).style = baseRow.getCell(col).style;
                    }
                }

                let medidorCol = 0;
                if (currentMode === 'transcricao' || currentMode === 'comboio') {
                    medidorCol = Number(item.medidorFinal);
                } else {
                    medidorCol = Number(item.raw['Encerrante Final Bruto'] || 0);
                }

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

            const clientCode = fileNameClient.trim().replace(/\s+/g, '');
            const nomeArquivo = `Planilha insercao de abastecimento_S10_${clientCode}_${dia}${mes}${ano}.xlsx`;

            const buffer = await workbook.xlsx.writeBuffer();

            const excelMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            saveAs(new Blob([buffer], { type: excelMimeType }), nomeArquivo);

            toast.success(`Planilha gerada com Sucesso!`);
            setIsModalOpen(false);

        } catch (error) {
            console.error(error);
            setNeedsManualMolde(true);
            toast.error("Falha de processamento. Anexe o molde manualmente.");
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
                        toast.success(`${translatedData.length || data.length} registros processados e cruzados.`);
                    }
                }

            } else {
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
        <div className="min-h-screen bg-gray-50 py-12 px-4 font-sans text-gray-800">
            <Toaster position="top-right" richColors />

            <datalist id="lista-placas">
                {atsPlacas.map((placa, idx) => <option key={idx} value={placa} />)}
            </datalist>

            <div className="max-w-5xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">Analisador de Telemetria</h1>
                    <p className="text-gray-500 text-lg">
                        {currentMode ? <span className="inline-flex items-center bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">Modo: {currentMode.toUpperCase()}</span> : 'Selecione o tipo de análise'}
                    </p>
                </div>

                {!currentMode ? (
                    <ModeSelector onSelectMode={setCurrentMode} />
                ) : (
                    <div className="animate-fade-in-up">
                        <button onClick={() => { setCurrentMode(null); setProcessedData([]); setDiagnosticData([]); setStartIdInput(""); setWlnFile(null); setTankFile(null); }} className="mb-6 flex items-center text-gray-500 hover:text-blue-600 font-medium">
                            <ArrowLeft className="w-5 h-5 mr-2" /> Voltar
                        </button>

                        <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-100 relative">

                            {currentMode === 'transcricao' || currentMode === 'comboio' ? (
                                <div className="space-y-6">
                                    <div className={`p-4 ${currentMode === 'comboio' ? 'bg-teal-50 border-teal-200 text-teal-800' : 'bg-orange-50 border-orange-200 text-orange-800'} border rounded-xl text-sm mb-6`}>
                                        <strong>{currentMode === 'comboio' ? 'Carregamento de Comboio:' : 'Conciliação Automática:'}</strong> {currentMode === 'comboio' ? 'Filtra e cruza APENAS os abastecimentos do Mangote.' : 'Envie o arquivo da Placa (WLN) e o do Nível (CSV) para cruzar os horários.'}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className={`p-6 rounded-2xl border-2 border-dashed transition-all ${wlnFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400'}`}>
                                            <h3 className="font-bold text-gray-700 mb-2 flex items-center"><Fuel className="w-5 h-5 mr-2"/> 1. Telemetria (WLN)</h3>
                                            {wlnFile ? <div className="text-green-700 font-medium truncate">{wlnFile.name}</div> : <FileUpload onFileSelect={handleFileSelect} />}
                                        </div>
                                        <div className={`p-6 rounded-2xl border-2 border-dashed transition-all ${tankFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400'}`}>
                                            <h3 className="font-bold text-gray-700 mb-2 flex items-center"><Settings className="w-5 h-5 mr-2"/> 2. Nível Tanque (CSV)</h3>
                                            {tankFile ? <div className="text-green-700 font-medium truncate">{tankFile.name}</div> : <FileUpload onFileSelect={handleFileSelect} />}
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
                                            <ZapOff className="w-6 h-6 flex-shrink-0" />
                                            <span><strong>Recuperação de Queda de Energia:</strong> Restaura os litros perdidos garantindo a Malha Fechada do tanque usando o relógio eletrônico.</span>
                                        </div>
                                    )}
                                    {currentMode === 'travado' && (
                                        <div className="mb-8 p-6 bg-purple-50 rounded-2xl border border-purple-100 flex flex-col md:flex-row items-center gap-4">
                                            <div className="w-full md:w-48"><label className="text-xs font-bold text-purple-800 uppercase ml-1">Último ID Válido</label><input type="number" className="w-full mt-1 px-4 py-3 rounded-xl border border-purple-200 outline-none" value={startIdInput} onChange={(e) => setStartIdInput(e.target.value)} /></div>
                                        </div>
                                    )}
                                    <FileUpload onFileSelect={handleFileSelect} />
                                </>
                            )}

                            {isProcessing && (
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
                                                                            <th className="px-4 py-2 font-semibold">Posição</th>
                                                                            <th className="px-4 py-2 font-semibold">ID</th>
                                                                            <th className="px-4 py-2 font-semibold">Início</th>
                                                                            <th className="px-4 py-2 font-semibold">Enc. Inicial</th>
                                                                            <th className="px-4 py-2 font-semibold">Enc. Final</th>
                                                                            <th className="px-4 py-2 font-semibold">Volume</th>
                                                                            <th className="px-4 py-2 font-semibold">Energia</th>
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
                                <div className="mt-8 animate-fade-in-up">

                                    <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Soma dos Volumes</p>
                                                <p className="text-2xl font-black text-gray-800">{totalVolume.toFixed(1)} L</p>
                                            </div>
                                            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><Fuel className="w-7 h-7"/></div>
                                        </div>

                                        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1" title="Diferença entre o primeiro Encerrante Inicial e o último Encerrante Final da lista.">Saída pelo Medidor</p>
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
                                                <p className="font-bold text-green-900">Pronto para Exportar!</p>
                                                <p className="text-sm text-green-700">Edite os campos, delete falhas ou baixe o Excel.</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 w-full sm:w-auto">
                                            <button
                                                onClick={handleSyncATS}
                                                disabled={isSyncingAts}
                                                className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-4 py-3 rounded-xl font-bold flex items-center transition-all disabled:opacity-50"
                                            >
                                                {isSyncingAts ? (
                                                    <span className="animate-pulse">Sincronizando...</span>
                                                ) : (
                                                    <><CloudDownload className="w-5 h-5 mr-2" /> ATS Autocomplete</>
                                                )}
                                            </button>

                                            <button onClick={handleDownloadClick} className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-bold flex items-center shadow-lg transition-all active:scale-95">
                                                <Download className="w-5 h-5 mr-2" /> Baixar Excel
                                            </button>
                                        </div>
                                    </div>

                                    <div className="overflow-auto border border-gray-200 rounded-xl shadow-sm max-h-[600px] w-full bg-white">
                                        <table className="w-full text-sm text-left relative">
                                            <thead className="bg-gray-100 text-gray-600 font-bold sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-4 py-3 whitespace-nowrap">Data</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Início</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Fim</th>
                                                <th className="px-4 py-3 whitespace-nowrap">ID</th>
                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600 flex items-center gap-1"><Edit3 className="w-4 h-4"/> Placa</th>
                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600"><Edit3 className="w-4 h-4 inline mr-1"/> Vol (L)</th>
                                                <th className="px-4 py-3 whitespace-nowrap text-gray-400">Enc. Inicial</th>
                                                <th className="px-4 py-3 whitespace-nowrap text-gray-400">Enc. Final</th>
                                                <th className="px-4 py-3 whitespace-nowrap text-center">Ações</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            {displayData.map((row: any) => (
                                                <tr key={row._uid} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-3 whitespace-nowrap font-bold text-gray-800">{row.dataStr?.split(' ')[0] || '-'}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-700">{row.horaInicio}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-700">{row.horaFim}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap font-mono">{row.id}</td>
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
                                                            type="number"
                                                            className="border border-blue-200 rounded-lg px-3 py-1.5 w-24 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700 bg-white shadow-sm"
                                                            value={row.volumeConciliado}
                                                            onChange={(e) => handleRowEdit(row._uid, 'Volume (L)', Number(e.target.value))}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 font-mono">{row.medidorInicial}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 font-mono">{row.medidorFinal}</td>
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
                                </div>
                            )}

                            {isModalOpen && (
                                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-gray-100">
                                        <div className="flex justify-between items-center mb-6">
                                            <h3 className="text-xl font-bold text-gray-800">Informações da Base</h3>
                                            <button onClick={() => setIsModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-full text-gray-500"><X className="w-6 h-6" /></button>
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
                                                <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 max-h-56 overflow-y-auto animate-in fade-in slide-in-from-top-2">
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
                                                            A lista está vazia. Clique no botão <b>"ATS Autocomplete"</b> fora deste menu para buscar os dados.
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="mb-8">
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Código do Cliente</label>
                                            <input type="text" placeholder="Ex: roca644" className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 outline-none" value={fileNameClient} onChange={(e) => setFileNameClient(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmDownload()} />
                                        </div>

                                        <div className="flex gap-3">
                                            <button onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-3 rounded-xl font-semibold text-gray-600 hover:bg-gray-100 transition-colors">Cancelar</button>
                                            <button onClick={confirmDownload} className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg transition-transform active:scale-95">Gerar Arquivo</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;