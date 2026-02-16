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

    // Novo estado de segurança
    const [templateFile, setTemplateFile] = useState<File | null>(null);
    const [needsManualMolde, setNeedsManualMolde] = useState(false);

    const handleRowEdit = (index: number, field: string, value: string | number) => {
        const newData = [...processedData];
        newData[index] = { ...newData[index], [field]: value };
        setProcessedData(newData);
    };

    const handleDownloadClick = () => {
        if (processedData.length > 0) {
            setPumpName("");
            setFileNameClient("");
            setNeedsManualMolde(false);
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

            // SISTEMA HÍBRIDO: Usa o arquivo manual se anexado, senão tenta puxar do servidor
            if (templateFile) {
                arrayBuffer = await templateFile.arrayBuffer();
            } else {
                const response = await fetch('/Molde_Vazio.xlsx');
                if (!response.ok) {
                    setNeedsManualMolde(true);
                    toast.warning("Molde automático não encontrado no servidor (Erro 404). Por favor, anexe o arquivo manualmente abaixo.");
                    return; // Para a execução e espera o usuário anexar
                }
                arrayBuffer = await response.arrayBuffer();
            }

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(arrayBuffer);
            const ws = workbook.worksheets[0];

            const cleanData = formatForExcel(processedData, currentMode || 'normal');

            let medidorCorrente = 0;
            if (currentMode === 'transcricao') {
                medidorCorrente = 0;
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const first = cleanData.find((d: any) => Number(d.raw['Encerrante Inicial Bruto']) > 0);
                medidorCorrente = first ? Number(first.raw['Encerrante Inicial Bruto']) : 0;
            }

            ws.getCell('D2').value = medidorCorrente;

            const formatTime = (timeStr: string | number | undefined | null) => {
                if (!timeStr || timeStr === '-') return "";
                const str = String(timeStr);
                const timePart = str.split(' ')[1] || str;
                const parts = timePart.split(':');
                if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
                return str;
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cleanData.forEach((item: any, index: number) => {
                const r = index + 3;
                const row = ws.getRow(r);

                let medidorCol = 0;
                if (currentMode === 'transcricao') {
                    medidorCorrente += Math.round((item.volumeConciliado || 0) * 100);
                    medidorCol = medidorCorrente;
                } else {
                    medidorCol = Number(item.raw['Encerrante Final Bruto'] || 0);
                }

                row.getCell(1).value = pumpName.trim();
                row.getCell(2).value = formatTime(item.horaInicio);
                row.getCell(3).value = formatTime(item.horaFim);
                row.getCell(4).value = medidorCol;

                row.getCell(9).value = item.placa;

                const idVal = Number(item.id);
                row.getCell(11).value = isNaN(idVal) ? item.id : idVal;

                row.getCell(12).value = item.frentista;
                row.getCell(13).value = item.odometro !== '' ? Number(item.odometro) : '';

                row.commit();
            });

            const d = cleanData[0]?.originalTimestamp ? new Date(cleanData[0].originalTimestamp) : new Date();
            const dia = String(d.getDate()).padStart(2,'0');
            const mes = String(d.getMonth()+1).padStart(2,'0');
            const ano = d.getFullYear();
            const clientCode = fileNameClient.trim().replace(/\s+/g, '');
            const nomeArquivo = `Planilha insercao de abastecimento_S10_${clientCode}_${dia}${mes}${ano}.xlsx`;

            const buffer = await workbook.xlsx.writeBuffer();
            saveAs(new Blob([buffer]), nomeArquivo);

            toast.success(`Planilha gerada com sucesso!`);
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

                            {processedData.length > 0 && (
                                <div className="mt-8 animate-fade-in-up">
                                    <div className="flex items-center justify-between mb-4 bg-green-50 p-4 rounded-xl border border-green-100">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-green-100 rounded-lg text-green-600"><FileSpreadsheet className="w-6 h-6" /></div>
                                            <div>
                                                <p className="font-bold text-green-900">Pronto para Exportar!</p>
                                                <p className="text-sm text-green-700">Edite as informações necessárias antes de baixar.</p>
                                            </div>
                                        </div>
                                        <button onClick={handleDownloadClick} className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-bold flex items-center shadow-lg transition-all active:scale-95">
                                            <Download className="w-5 h-5 mr-2" /> Baixar Excel
                                        </button>
                                    </div>

                                    {/* CORREÇÃO DO SCROLL: overflow-auto e max-h adicionados corretamente */}
                                    <div className="overflow-auto border border-gray-200 rounded-xl shadow-sm max-h-[600px] w-full bg-white">
                                        <table className="w-full text-sm text-left relative">
                                            <thead className="bg-gray-100 text-gray-600 font-bold sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-4 py-3 whitespace-nowrap">Data</th>
                                                <th className="px-4 py-3 whitespace-nowrap">ID</th>
                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600 flex items-center gap-1"><Edit3 className="w-4 h-4"/> Placa</th>
                                                <th className="px-4 py-3 whitespace-nowrap text-blue-600"><Edit3 className="w-4 h-4 inline mr-1"/> Vol (L)</th>
                                                {/* Adicionado Encerrantes na tela */}
                                                <th className="px-4 py-3 whitespace-nowrap text-gray-400">Enc. Ini</th>
                                                <th className="px-4 py-3 whitespace-nowrap text-gray-400">Enc. Fim</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Frentista</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            {processedData.map((row: any, i: number) => (
                                                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-3 whitespace-nowrap">{row['Data'] || row['Data Inicial']}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap font-mono">{row['ID Operação'] || row['ID Original (Travado)']}</td>
                                                    <td className="px-4 py-2">
                                                        <input
                                                            type="text" placeholder="EX: ABC1234"
                                                            className="border border-blue-200 rounded-lg px-3 py-1.5 w-28 focus:ring-2 focus:ring-blue-500 outline-none uppercase font-bold text-gray-700 bg-white shadow-sm"
                                                            value={row['Veículo (Cartão)'] ?? row['Veículo'] ?? ''}
                                                            onChange={(e) => {
                                                                if (row['Veículo'] !== undefined) handleRowEdit(i, 'Veículo', e.target.value.toUpperCase());
                                                                else handleRowEdit(i, 'Veículo (Cartão)', e.target.value.toUpperCase());
                                                            }}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        <input
                                                            type="number"
                                                            className="border border-blue-200 rounded-lg px-3 py-1.5 w-24 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-700 bg-white shadow-sm"
                                                            value={row['Volume (L)']}
                                                            onChange={(e) => handleRowEdit(i, 'Volume (L)', Number(e.target.value))}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-gray-400">{row['Encerrante Inicial Bruto'] || row['Encerrante Inicial']}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-gray-400">{row['Encerrante Final Bruto'] || row['Encerrante Final']}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap">{row['Frentista']}</td>
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

                                        {/* CAIXA DE EMERGÊNCIA - Aparece só se der Erro 404 */}
                                        {needsManualMolde && (
                                            <div className="mb-4 bg-orange-50 p-4 rounded-xl border border-orange-300">
                                                <label className="block text-sm font-bold text-orange-800 mb-2">
                                                    ⚠️ Anexar Molde Manualmente
                                                </label>
                                                <input
                                                    type="file"
                                                    accept=".xlsx"
                                                    className="w-full text-sm text-orange-800 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-orange-600 file:text-white hover:file:bg-orange-700 outline-none"
                                                    onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
                                                />
                                                <p className="text-xs text-orange-700 mt-2">O arquivo 'Molde_Vazio.xlsx' não foi achado no servidor. Envie-o agora para gerar a planilha.</p>
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