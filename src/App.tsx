import { useState } from 'react';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, Download, FileSpreadsheet, Settings, X, Fuel, Edit3 } from 'lucide-react';

import { processLogFile, processWlnFile, formatForExcel, parseTankFile, reconciliateData } from './utils/processors';
import { ModeSelector } from './components/ModeSelector';
import { FileUpload } from './components/FileUpload';

function App() {
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [processedData, setProcessedData] = useState<any[]>([]);

    const [isProcessing, setIsProcessing] = useState(false);
    const [startIdInput, setStartIdInput] = useState<string>("");

    const [wlnFile, setWlnFile] = useState<File | null>(null);
    const [tankFile, setTankFile] = useState<File | null>(null);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pumpName, setPumpName] = useState("");
    const [fileNameClient, setFileNameClient] = useState("");

    const [templateFile, setTemplateFile] = useState<File | null>(null);
    const [needsManualMolde, setNeedsManualMolde] = useState(false);

    const displayData = formatForExcel(processedData, currentMode || 'normal');

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
                // Puxando o seu arquivo Molde_Vazio2.xlsx (ou Molde_Vazio.xlsx se você voltou o nome)
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
            const ws = workbook.worksheets[0];

            const d = displayData[0]?.originalTimestamp ? new Date(displayData[0].originalTimestamp) : new Date();
            const dia = String(d.getDate()).padStart(2,'0');
            const mes = String(d.getMonth()+1).padStart(2,'0');
            const ano = d.getFullYear();

            ws.name = `${dia}.${mes}.${ano}`;

            let medidorSetup = 0;
            if (currentMode === 'transcricao') {
                medidorSetup = 0;
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const first = displayData.find((d: any) => d.medidorInicial > 0);
                medidorSetup = first ? first.medidorInicial : 0;
            }
            ws.getCell('D2').value = medidorSetup;

            const formatTime = (timeStr: string | number | undefined | null) => {
                if (!timeStr || timeStr === '-') return "";
                const str = String(timeStr);
                const timePart = str.split(' ')[1] || str;
                const parts = timePart.split(':');
                if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
                return str;
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            displayData.forEach((item: any, index: number) => {
                const r = index + 3;
                const row = ws.getRow(r);

                // --- PINCEL DE FORMATAÇÃO AUTOMÁTICO ---
                // Se a linha for maior que 3, clona o estilo da linha 3 (fontes, cores, vermelho da placa, etc)
                if (r > 3) {
                    const baseRow = ws.getRow(3);
                    for (let col = 1; col <= 13; col++) { // São 13 colunas na nossa planilha
                        row.getCell(col).style = baseRow.getCell(col).style;
                    }
                }

                let medidorCol = 0;
                if (currentMode === 'transcricao') {
                    medidorCol = Number(item.medidorFinal);
                } else {
                    medidorCol = Number(item.raw['Encerrante Final Bruto'] || 0);
                }

                row.getCell(1).value = String(pumpName).trim();
                row.getCell(2).value = formatTime(item.horaInicio);
                row.getCell(3).value = formatTime(item.horaFim);
                row.getCell(4).value = medidorCol;

                row.getCell(6).value = Number(item.medidorInicial);
                row.getCell(7).value = Number(item.medidorFinal);
                row.getCell(8).value = Number(item.volumeConciliado);

                row.getCell(9).value = item.placa ? String(item.placa).trim() : '';

                const idVal = Number(item.id);
                row.getCell(11).value = isNaN(idVal) ? item.id : idVal;

                row.getCell(12).value = item.frentista ? String(item.frentista).trim() : '';
                row.getCell(13).value = item.odometro !== '' ? Number(item.odometro) : '';

                row.commit();
            });

            const clientCode = fileNameClient.trim().replace(/\s+/g, '');
            const nomeArquivo = `Planilha insercao de abastecimento_S10_${clientCode}_${dia}${mes}${ano}.xlsx`;

            const buffer = await workbook.xlsx.writeBuffer();
            saveAs(new Blob([buffer]), nomeArquivo);

            toast.success(`Planilha gerada com a formatação perfeita!`);
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

            const mergedData = reconciliateData(wlnRaw, tankRaw);
            setProcessedData(mergedData);
            if (mergedData.length > 0) toast.success(`Conciliação concluída! Edite as placas se necessário.`);
            else toast.warning("Nenhum abastecimento encontrado no cruzamento.");
        } catch (error) {
            const err = error as Error;
            toast.error("Erro na conciliação: " + err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFileSelect = async (file: File) => {
        if (currentMode === 'transcricao') {
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

        if (currentMode === 'travado' && !startIdInput) {
            toast.error("ID inicial obrigatório.");
            setIsProcessing(false);
            return;
        }

        try {
            const isWlnFile = file.name.toLowerCase().endsWith('.wln');
            if (currentMode === 'wln' || isWlnFile) {
                const data = await processWlnFile(file);
                if (data.length > 0) {
                    const cleanData = processLogFile(data, currentMode || 'normal', { startId: Number(startIdInput) });
                    setProcessedData(cleanData.length > 0 ? cleanData : data);
                    toast.success(`${cleanData.length || data.length} registros processados.`);
                }
            } else {
                Papa.parse(file, {
                    header: true, skipEmptyLines: true, delimiter: ";", transformHeader: h => h.trim(),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    complete: (res: any) => {
                        const clean = processLogFile(res.data, currentMode || 'normal', { startId: Number(startIdInput) });
                        setProcessedData(clean);
                        toast.success(`${clean.length} registros processados.`);
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
                        <button onClick={() => { setCurrentMode(null); setProcessedData([]); setStartIdInput(""); setWlnFile(null); setTankFile(null); }} className="mb-6 flex items-center text-gray-500 hover:text-blue-600 font-medium">
                            <ArrowLeft className="w-5 h-5 mr-2" /> Voltar
                        </button>

                        <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-100 relative">

                            {currentMode === 'transcricao' ? (
                                <div className="space-y-6">
                                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl text-orange-800 text-sm mb-6">
                                        <strong>Conciliação Automática:</strong> Envie o arquivo da Placa (WLN) e o do Nível (CSV) para cruzar os horários.
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
                                        <button onClick={handleProcessConciliation} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-blue-200 transition-all active:scale-95">
                                            Processar Conciliação
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <>
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

                            {displayData.length > 0 && (
                                <div className="mt-8 animate-fade-in-up">
                                    <div className="flex items-center justify-between mb-4 bg-green-50 p-4 rounded-xl border border-green-100">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-green-100 rounded-lg text-green-600"><FileSpreadsheet className="w-6 h-6" /></div>
                                            <div>
                                                <p className="font-bold text-green-900">Pronto para Exportar!</p>
                                                <p className="text-sm text-green-700">O que você alterar na tabela já reflete nos encerrantes!</p>
                                            </div>
                                        </div>
                                        <button onClick={handleDownloadClick} className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-bold flex items-center shadow-lg transition-all active:scale-95">
                                            <Download className="w-5 h-5 mr-2" /> Baixar Excel
                                        </button>
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
                                                <th className="px-4 py-3 whitespace-nowrap">Frentista</th>
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
                                                    <td className="px-4 py-3 whitespace-nowrap">{row.frentista}</td>
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
                                                    {templateFile ? '✅ Molde Anexado com Sucesso' : '⚠️ Anexar Molde Manualmente'}
                                                </label>

                                                {!templateFile ? (
                                                    <>
                                                        <input
                                                            type="file"
                                                            accept=".xlsx"
                                                            className="w-full text-sm text-orange-800 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-orange-600 file:text-white hover:file:bg-orange-700 outline-none cursor-pointer"
                                                            onChange={(e) => {
                                                                const file = e.target.files?.[0];
                                                                if (file) {
                                                                    setTemplateFile(file);
                                                                    toast.success(`Arquivo "${file.name}" carregado!`);
                                                                }
                                                            }}
                                                        />
                                                        <p className="text-xs text-orange-700 mt-2 leading-tight">O arquivo automático não foi achado no servidor. Envie o seu molde agora para gerar a planilha.</p>
                                                    </>
                                                ) : (
                                                    <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-green-200 shadow-sm animate-fade-in-up">
                                                        <span className="text-sm font-medium text-green-700 truncate mr-2" title={templateFile.name}>
                                                            {templateFile.name}
                                                        </span>
                                                        <button
                                                            onClick={() => setTemplateFile(null)}
                                                            className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-bold transition-colors"
                                                        >
                                                            Trocar
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="mb-4">
                                            <label className="block text-sm font-semibold text-gray-700 mb-2">Nome da Bomba</label>
                                            <input type="text" autoFocus placeholder="Ex: Bomba SMARTANK 641..." className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 outline-none" value={pumpName} onChange={(e) => setPumpName(e.target.value)} />
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