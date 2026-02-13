import { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast, Toaster } from 'sonner';
import { ArrowLeft, Download, FileSpreadsheet, Settings, X, Fuel } from 'lucide-react';

// Importação das funções (Adicionei as novas)
import { processLogFile, processWlnFile, formatForExcel, parseTankFile, reconciliateData } from './utils/processors';

import { ModeSelector } from './components/ModeSelector';
import { FileUpload } from './components/FileUpload';

function App() {
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    const [processedData, setProcessedData] = useState<any[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [startIdInput, setStartIdInput] = useState<string>("");

    // --- ESTADOS NOVOS PARA CONCILIAÇÃO ---
    const [wlnFile, setWlnFile] = useState<File | null>(null);
    const [tankFile, setTankFile] = useState<File | null>(null);

    // ESTADOS PARA O MODAL
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pumpName, setPumpName] = useState("");

// --- MANIPULAÇÃO EXCEL (CLONE EXATO DO ARQUIVO MANUAL) ---
    const createWorkbook = (nomeBombaBruto: string) => {
        const cleanData = formatForExcel(processedData);
        if (cleanData.length === 0) return null;

        const nomeBomba = nomeBombaBruto.trim();

        // Cabeçalhos (Ajustado para 1e-05 conforme seu arquivo manual original)
        const headers = [
            "Bomba", "Hora Inicio", "Hora Fim", "Medidor",
            "Encerrante inicial m³", "Encerrante Inicial", "Encerrante Final",
            "Litros", "Placa", "1e-05", "ID", "Frentista", "Odometro"
        ];

        const sheetData: any[][] = [];
        sheetData.push(headers);

        // --- SETUP LINHA 2 (O SEGREDO ESTÁ AQUI) ---
        // A linha 2 DEVE ter a coluna Bomba vazia e Litros = 0 para o robô da plataforma não bugar
        const medidorInicialDia = cleanData[0].medidorInicial || 0;

        const row2 = [
            "",                 // A: Bomba (DEVE SER VAZIO NA LINHA 2)
            "",                 // B: Hora Inicio
            "",                 // C: Hora Fim
            medidorInicialDia,  // D: Medidor
            "",                 // E: Encerrante m3 (DEVE SER VAZIO NA LINHA 2)
            null,               // F: Encerrante Inicial
            null,               // G: Encerrante Final
            0,                  // H: Litros (DEVE SER ZERO NA LINHA 2)
            "",                 // I: Placa
            "",                 // J: 1e-05
            "",                 // K: ID
            "",                 // L: Frentista
            ""                  // M: Odometro
        ];
        sheetData.push(row2);

        // --- DADOS (LINHA 3 em diante) ---
        cleanData.forEach((item) => {
            const isConciliado = currentMode === 'transcricao' && item.volumeConciliado !== undefined;

            const row = [
                nomeBomba,
                item.horaInicio,
                item.horaFim,
                item.medidorFinal,
                "", // m3 vazio
                isConciliado ? item.raw['Tanque Inicial'] : null,
                isConciliado ? item.raw['Tanque Final'] : null,
                isConciliado ? item.volumeConciliado : null,
                item.placa,
                "",
                item.id,
                item.frentista,
                item.odometro
            ];
            sheetData.push(row);
        });

        const ws = XLSX.utils.aoa_to_sheet(sheetData);

        // INJEÇÃO DE FÓRMULAS
        if (currentMode !== 'transcricao') {
            for (let i = 2; i < sheetData.length; i++) {
                const linhaExcel = i + 1;
                const linhaAnterior = linhaExcel - 1;
                const cellF = XLSX.utils.encode_cell({ r: i, c: 5 }); ws[cellF] = { t: 'n', f: `D${linhaAnterior}` };
                const cellG = XLSX.utils.encode_cell({ r: i, c: 6 }); ws[cellG] = { t: 'n', f: `D${linhaExcel}` };
                const cellH = XLSX.utils.encode_cell({ r: i, c: 7 }); ws[cellH] = { t: 'n', f: `(G${linhaExcel}-F${linhaExcel})*0.01` };
            }
        }

        ws['!cols'] = [{ wch: 45 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 10 }];

        // Nome Aba (Data Exata)
        let nomeDaAba = "Abastecimentos";
        if (processedData.length > 0 && processedData[0].originalTimestamp) {
            const d = new Date(processedData[0].originalTimestamp);
            nomeDaAba = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, nomeDaAba);
        return wb;
    };

    const handleDownloadClick = () => { if (processedData.length > 0) { setPumpName(""); setIsModalOpen(true); } };

    const confirmDownload = () => {
        if (!pumpName.trim()) { toast.error("Nome da bomba obrigatório."); return; }
        const wb = createWorkbook(pumpName);
        if (!wb) return;

        const d = processedData[0]?.originalTimestamp ? new Date(processedData[0].originalTimestamp) : new Date();
        const nomeArquivo = `Planilha S10_${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}.xlsx`;

        XLSX.writeFile(wb, nomeArquivo);
        toast.success(`Planilha gerada!`);
        setIsModalOpen(false);
    };

    // --- PROCESSAR CONCILIAÇÃO ---
    const handleProcessConciliation = async () => {
        if (!wlnFile || !tankFile) {
            toast.error("Por favor, selecione os dois arquivos.");
            return;
        }
        setIsProcessing(true);
        try {
            // 1. Processa WLN
            const wlnRaw = await processWlnFile(wlnFile);

            // 2. Processa Tanque
            const tankRaw = await parseTankFile(tankFile);

            if (tankRaw.length === 0) {
                throw new Error("Não foi possível ler dados do arquivo de tanque. Verifique se é um CSV válido.");
            }

            // 3. Cruza os dados
            const mergedData = reconciliateData(wlnRaw, tankRaw);

            setProcessedData(mergedData);

            if (mergedData.length > 0) {
                toast.success(`Conciliação concluída! ${mergedData.length} abastecimentos identificados.`);
            } else {
                toast.warning("Nenhum abastecimento encontrado no cruzamento de horários.");
            }
        } catch (error: any) {
            console.error(error);
            toast.error("Erro na conciliação: " + error.message);
        }
        setIsProcessing(false);
    };

    // --- LEITURA PADRÃO ---
    const handleFileSelect = async (file: File) => {
        // Se estiver no modo conciliação, guarda o arquivo no state
        if (currentMode === 'transcricao') {
            const name = file.name.toLowerCase();
            if (name.endsWith('.wln') || name.endsWith('.txt')) {
                setWlnFile(file);
                toast.info("Arquivo WLN (Placas) carregado!");
            } else if (name.endsWith('.csv') || name.endsWith('.xlsx')) {
                setTankFile(file);
                toast.info("Arquivo de Tanque (Níveis) carregado!");
            } else {
                toast.warning("Formato desconhecido. Use WLN para telemetria ou CSV para tanque.");
            }
            return;
        }

        // Lógica normal para outros modos
        setIsProcessing(true);
        setProcessedData([]);

        if (currentMode === 'travado' && !startIdInput) {
            toast.error("ID inicial obrigatório."); setIsProcessing(false); return;
        }

        try {
            const isWlnFile = file.name.toLowerCase().endsWith('.wln');
            if (currentMode === 'wln' || isWlnFile) {
                const data = await processWlnFile(file);
                if (data.length > 0) {
                    const cleanData = processLogFile(data, currentMode || 'normal', { startId: Number(startIdInput) });
                    setProcessedData(cleanData.length > 0 ? cleanData : data);
                    toast.success(`${cleanData.length || data.length} registros.`);
                }
            } else {
                Papa.parse(file, {
                    header: true, skipEmptyLines: true, delimiter: ";", transformHeader: h => h.trim(),
                    complete: (res: any) => {
                        const clean = processLogFile(res.data, currentMode || 'normal', { startId: Number(startIdInput) });
                        setProcessedData(clean);
                        toast.success(`${clean.length} registros.`);
                    },
                    error: (err: any) => { toast.error("Erro CSV: " + err.message); setIsProcessing(false); }
                });
            }
        } catch (e) { toast.error("Erro."); }
        setIsProcessing(false);
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

                            {/* --- INTERFACE DE CONCILIAÇÃO --- */}
                            {currentMode === 'transcricao' ? (
                                <div className="space-y-6">
                                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl text-orange-800 text-sm mb-6">
                                        <strong>Conciliação Automática:</strong> Envie o arquivo da Placa (WLN) e o do Nível (CSV) para o sistema cruzar os horários.
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* WLN */}
                                        <div className={`p-6 rounded-2xl border-2 border-dashed transition-all ${wlnFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400'}`}>
                                            <h3 className="font-bold text-gray-700 mb-2 flex items-center"><Fuel className="w-5 h-5 mr-2"/> 1. Telemetria (WLN)</h3>
                                            {wlnFile ? (
                                                <div className="text-green-700 font-medium truncate">{wlnFile.name}</div>
                                            ) : (
                                                <FileUpload onFileSelect={handleFileSelect} />
                                            )}
                                        </div>

                                        {/* TANQUE */}
                                        <div className={`p-6 rounded-2xl border-2 border-dashed transition-all ${tankFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400'}`}>
                                            <h3 className="font-bold text-gray-700 mb-2 flex items-center"><Settings className="w-5 h-5 mr-2"/> 2. Nível Tanque (CSV)</h3>
                                            {tankFile ? (
                                                <div className="text-green-700 font-medium truncate">{tankFile.name}</div>
                                            ) : (
                                                <FileUpload onFileSelect={handleFileSelect} />
                                            )}
                                        </div>
                                    </div>

                                    {wlnFile && tankFile && processedData.length === 0 && (
                                        <button
                                            onClick={handleProcessConciliation}
                                            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-blue-200 transition-all active:scale-95"
                                        >
                                            Processar Conciliação
                                        </button>
                                    )}
                                </div>
                            ) : (
                                // --- INTERFACE NORMAL ---
                                <>
                                    {currentMode === 'travado' && (
                                        <div className="mb-8 p-6 bg-purple-50 rounded-2xl border border-purple-100 flex flex-col md:flex-row items-center gap-4">
                                            <div className="w-full md:w-48"><label className="text-xs font-bold text-purple-800 uppercase ml-1">Último ID Válido</label><input type="number" className="w-full mt-1 px-4 py-3 rounded-xl border border-purple-200 outline-none" value={startIdInput} onChange={(e) => setStartIdInput(e.target.value)} /></div>
                                        </div>
                                    )}
                                    <FileUpload onFileSelect={handleFileSelect} />
                                </>
                            )}

                            {isProcessing && <div className="mt-8 text-center text-blue-600 animate-pulse">Cruzando dados...</div>}

                            {processedData.length > 0 && (
                                <div className="mt-8 animate-fade-in-up">
                                    <div className="flex items-center justify-between mb-4 bg-green-50 p-4 rounded-xl border border-green-100">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-green-100 rounded-lg text-green-600"><FileSpreadsheet className="w-6 h-6" /></div>
                                            <div><p className="font-bold text-green-900">Sucesso!</p><p className="text-sm text-green-700">{processedData.length} registros.</p></div>
                                        </div>
                                        <button onClick={handleDownloadClick} className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-bold flex items-center shadow-lg transition-all active:scale-95">
                                            <Download className="w-5 h-5 mr-2" /> Baixar Excel
                                        </button>
                                    </div>
                                    <div className="overflow-x-auto border border-gray-100 rounded-xl max-h-96">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-gray-50 text-gray-500 font-medium sticky top-0">
                                            <tr>{Object.keys(processedData[0]).map(h => (h !== 'raw' && <th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>))}</tr>
                                            </thead>
                                            <tbody>
                                            {processedData.slice(0, 10).map((row, i) => (
                                                <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                                                    {Object.entries(row).map(([k, val]: any, idx) => (
                                                        k !== 'raw' && <td key={idx} className="px-4 py-3 whitespace-nowrap">{typeof val === 'number' ? val.toFixed(2) : val}</td>
                                                    ))}
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
                                        <div className="flex justify-between items-center mb-4"><h3 className="text-xl font-bold text-gray-800">Identificar Cliente</h3><button onClick={() => setIsModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-full text-gray-500"><X className="w-6 h-6" /></button></div>
                                        <div className="mb-6"><label className="block text-sm font-semibold text-gray-700 mb-2">Nome da Bomba</label><input type="text" autoFocus placeholder="Ex: Bomba 01 - Matriz" className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 outline-none" value={pumpName} onChange={(e) => setPumpName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmDownload()} /></div>
                                        <div className="flex gap-3"><button onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-3 rounded-xl font-semibold text-gray-600 hover:bg-gray-100">Cancelar</button><button onClick={confirmDownload} className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg">Gerar Arquivo</button></div>
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